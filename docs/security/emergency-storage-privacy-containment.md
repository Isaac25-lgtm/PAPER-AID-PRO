# AI RESEARCH HUB — EMERGENCY STORAGE PRIVACY CONTAINMENT RUNBOOK

**Target Service**: Supabase Storage (`research-papers` bucket)  
**Security Classification**: CONFIDENTIAL / SECURITY OPERATIONAL RUNBOOK  
**Objective**: Transition the `research-papers` storage bucket from PUBLIC to PRIVATE without breaking authorized PDF access, leaking private manuscripts, or causing service downtime.

---

## 1. Context & Vulnerability Summary

### 1.1 The Vulnerability
During Phase 4B security audits, live CDN probing confirmed that the Supabase Storage bucket `research-papers` is currently configured as **PUBLIC**. 

Direct HTTP requests to:
```
https://enbunglssqrjugyffysh.supabase.co/storage/v1/object/public/research-papers/<paperId>/original.pdf
```
return `HTTP 206/200 Partial Content` and stream raw PDF bytes directly through Cloudflare edge caching, bypassing Next.js middleware, NextAuth authentication, and application-level access controls.

### 1.2 Current Application Mitigation (Phase 4B)
- `src/lib/storage.ts` has been modified so `getPaperPdfUrl` and `uploadPaperPdf` strictly return the application proxy route `/api/papers/${paperId}/pdf`.
- Raw public CDN URLs are never generated or exposed to client browsers in application bundles or API responses.
- However, as long as the remote bucket is public, anyone with a direct URL can fetch objects from the CDN.

---

## 2. Existing Object Inventory & Affected URL Patterns

### 2.1 Stored Manuscript Inventory
The database currently tracks 13 administrator benchmark/test fixtures with stored manuscripts:

| Paper ID | Manuscript Title | Canonical Storage Path |
|---|---|---|
| `cmumgtiix0000vr445cn8ry7o` | Kim et al. (BUSI Breast Cancer) | `cmumgtiix0000vr445cn8ry7o/original.pdf` |
| `cmunotrr10000vrusnqyv61ut` | Lymph node TB radiomics | `cmunotrr10000vrusnqyv61ut/original.pdf` |
| `cmunwc3ev001xvrusq53yvo9b` | Su et al. (ARU-Net Segmentation) | `cmunwc3ev001xvrusq53yvo9b/original.pdf` |
| `cmunwm6m2004ivrusrlr89j95` | Breast Ultrasound CNN | `cmunwm6m2004ivrusrlr89j95/original.pdf` |
| `cmunwvfkr006uvrus0m3ky4wn` | Zakareya et al. (Breast Cancer CAD) | `cmunwvfkr006uvrus0m3ky4wn/original.pdf` |
| `cmunx4c1b009pvrusz5785bw3` | Cervical spondylotic myelopathy | `cmunx4c1b009pvrusz5785bw3/original.pdf` |
| `cmunxiwf900blvruskrclq381` | Skin tumors | `cmunxiwf900blvruskrclq381/original.pdf` |
| `cmunxw9il00dnvrus7w9mqij9` | Li et al. (BI-RADS 4) | `cmunxw9il00dnvrus7w9mqij9/original.pdf` |
| `cmuwcdg910000vrss3yjvxncw` | Practical Quantum Error Mitigation | `cmuwcdg910000vrss3yjvxncw/original.pdf` |
| `cmuwceqie0035vrss654u0nvy` | piCRISPR | `cmuwceqie0035vrss654u0nvy/original.pdf` |
| `cmuwcfd5h004vvrss925t6jo2` | SelfCheckGPT | `cmuwcfd5h004vvrss925t6jo2/original.pdf` |
| `cmuwcfyqc006ovrss8qyhxa1u` | PointPillars Table 1 | `cmuwcfyqc006ovrss8qyhxa1u/original.pdf` |
| `cmuwcgoeq008nvrssu7qwcat7` | Whole-slide lung cancer | `cmuwcgoeq008nvrssu7qwcat7/original.pdf` |

### 2.2 Affected URL Pattern
Direct unauthenticated public pattern:
`https://<supabase-project-id>.supabase.co/storage/v1/object/public/research-papers/<paperId>/original.pdf`

---

## 3. Operational Step-by-Step Procedure: Switching to PRIVATE

> [!WARNING]
> DO NOT execute this step without explicit operational authorization.  
> This runbook is strictly prepared for authorized maintenance windows.

### Step 1: Pre-Flight Verification & Deployment Prerequisite
1. **Application Deployment Prerequisite**:
   - The production environment MUST be running local commit `9f81bd4bf95b3cf08f64e8941796e4ed38f10611` (or later).
   - The currently deployed commit on `origin/main` (`9a8156d`) contains the legacy UNPROTECTED PDF route with `Cache-Control: public`. Switching the bucket while `9a8156d` is deployed will either break PDF streaming (if service role key is absent) or continue serving public-cached PDFs to anonymous requesters.
2. **Server-Side Credentials**:
   - In `.env` (and production server environment secrets), verify that `SUPABASE_SECRET_KEY` (the newer `sb_secret_...` format, or legacy `SUPABASE_SERVICE_ROLE_KEY`) is explicitly configured.
   - Recommended provisioning: Configure strictly for the **Production** environment in Vercel (`Settings > Environment Variables`) unless another environment explicitly requires manuscript storage access.
   - **CRITICAL**: The anonymous key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) **CANNOT** read from a private bucket. Falling back to the anon key on a private bucket will cause all server downloads to fail with `403 Forbidden` / `404 Not Found`.
   - Verify `src/lib/storage.ts` initializes privileged clients using `SUPABASE_SECRET_KEY`.
   - Test server-side download using an isolated script before flipping the bucket switch.

### Step 2: Toggle Bucket from PUBLIC to PRIVATE
Execute in Supabase Management Console:
1. Log in to the Supabase Dashboard: `https://supabase.com/dashboard/project/enbunglssqrjugyffysh`.
2. Navigate to **Storage** > **Buckets**.
3. Locate `research-papers`.
4. Click the three dots (`...`) or Settings for `research-papers`.
5. Toggle **Public bucket** to **OFF** (Private).
6. Click **Save bucket configuration**.

*(Alternative via SQL Editor if storage schema permissions permit)*:
```sql
UPDATE storage.buckets
SET public = false
WHERE id = 'research-papers';
```

### Step 3: Verification of Denial (Anonymous Direct Request)
Send an unauthenticated cURL request to verify that direct CDN access is now blocked:
```bash
curl -I https://enbunglssqrjugyffysh.supabase.co/storage/v1/object/public/research-papers/cmumgtiix0000vr445cn8ry7o/original.pdf
```
**Expected Response**:
`HTTP/1.1 400 Bad Request` or `HTTP/1.1 404 Not Found`  
Payload: `{"statusCode": 404, "message": "Bucket not found or not public"}`.

### Step 4: Verification of Authorized Download
1. Sign in to AI Research Hub as Administrator (`admin@researchhub.ai`).
2. Request the protected proxy route:
   ```
   GET http://localhost:3000/api/papers/cmumgtiix0000vr445cn8ry7o/pdf
   ```
3. **Expected Response**:
   `HTTP/1.1 200 OK`  
   `Content-Type: application/pdf`  
   `Cache-Control: private, no-cache, no-store, must-revalidate`  
   Streams full binary PDF bytes seamlessly.

### Step 5: Verification of Non-Admin and Anonymous Rejection
1. As an anonymous user, request:
   ```
   GET http://localhost:3000/api/papers/cmumgtiix0000vr445cn8ry7o/pdf
   ```
   **Expected Response**: `HTTP/1.1 401 Unauthorized`.
2. As a standard authenticated researcher (role `USER`), request:
   ```
   GET http://localhost:3000/api/papers/cmumgtiix0000vr445cn8ry7o/pdf
   ```
   **Expected Response**: `HTTP/1.1 404 Not Found` (hides resource existence to prevent enumeration).

---

## 4. Existing CDN Cache Considerations & Cache Invalidation

Even after changing a bucket to PRIVATE in Supabase, intermediate CDN nodes (Cloudflare edge nodes) may retain cached responses for objects that were previously fetched under the public configuration.

### Invalidation Strategies:
1. **Purge Cloudflare Cache via Supabase Console**:
   If supported in project storage settings, click **Purge cache** for the `research-papers` bucket.
2. **Deterministic Namespace Rotation (Phase 4C Migration)**:
   During the Phase 4C user-library migration, all manuscripts will be moved to new, user-namespaced paths:
   ```
   research-papers/users/<userId>/uploads/<paperId>.pdf
   ```
   Because the file paths are completely new, old CDN cache keys are automatically invalidated.
3. **Strict No-Store Proxy Headers**:
   All responses from `/api/papers/[id]/pdf` include:
   `Cache-Control: private, no-cache, no-store, must-revalidate`
   `Pragma: no-cache`
   This guarantees that no browser or intermediate proxy caches the streamed PDF bytes.

---

## 5. Rollback & Emergency Recovery (Without Re-Exposing Private Documents)

If after toggling to PRIVATE, legitimate server-side streaming encounters `403 Forbidden` from Supabase:

> [!CAUTION]
> **NEVER TOGGLE THE BUCKET BACK TO PUBLIC** as an emergency fix. Doing so immediately re-exposes all user documents to the world.

### Safe Troubleshooting Steps:
1. **Check Secret Key Configuration**:
   Ensure `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) is defined in hosting secrets and `.env`:
   ```ts
   const secretKey =
     process.env.SUPABASE_SECRET_KEY ||
     process.env.SUPABASE_SERVICE_ROLE_KEY;
   ```
2. **Verify Storage RLS Policies**:
   In Supabase Dashboard -> Storage -> Policies -> `objects`:
   Ensure the `service_role` has full read/write access:
   ```sql
   CREATE POLICY "Allow Service Role Full Access"
   ON storage.objects
   FOR ALL
   TO service_role
   USING (bucket_id = 'research-papers');
   ```
3. Test using an isolated Node script:
   ```ts
   const { data, error } = await supabase.storage.from("research-papers").download("cmumgtiix.../original.pdf");
   ```
   Once confirmed, server proxying will stream to authorized users with zero downtime.
