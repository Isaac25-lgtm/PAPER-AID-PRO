/**
 * AI RESEARCH HUB — PHASE 8B: ADMIN CITATION STYLES CATALOG DASHBOARD
 */

import { verifyAdminSession } from "@/lib/auth/admin-guard";
import { redirect } from "next/navigation";
import { CslCatalogManager } from "@/lib/citations/csl/updater/catalog-storage";
import { CitationsAdminClient } from "./citations-admin-client";

export const metadata = {
  title: "CSL Citation Styles Management | Admin",
  description: "Monitor and synchronize official academic citation styles catalog revisions.",
};

export default async function CitationsAdminPage() {
  const auth = await verifyAdminSession();
  if (!auth.authorized) {
    redirect("/?error=unauthorized");
  }

  // Load baseline or active revision server-side
  const activeRevision = await CslCatalogManager.initializeBaselineCatalog();
  const revisions = await CslCatalogManager.getAdapter().listRevisions();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Citation Style Language (CSL) Catalog Management
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Monitor official upstream CSL styles, validate new or modified style definitions, and control catalog promotions and rollbacks without application redeployment.
        </p>
      </div>

      <CitationsAdminClient
        initialActiveRevision={activeRevision}
        initialRevisions={revisions}
      />
    </div>
  );
}
