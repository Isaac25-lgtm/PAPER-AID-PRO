import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router";

import { GuidanceProvider } from "./components/Guidance";
import { Layout, RequireAuth } from "./components/Layout";
import { Spinner } from "./components/ui";
import { HomePage } from "./pages/Home";
import { LoginPage, RegisterPage, ResetPasswordPage } from "./pages/Auth";
import { AINoticePage, NotFoundPage, PrivacyPage, TermsPage } from "./pages/Static";
import { useAuth } from "./lib/auth";

// Heavier screens are code-split so the landing page stays fast.
const load = {
  discover: () => import("./pages/Discover"),
  catalog: () => import("./pages/Catalog"),
  paper: () => import("./pages/PaperDetail"),
  library: () => import("./pages/Library"),
  documents: () => import("./pages/Documents"),
  editor: () => import("./pages/Editor"),
  research: () => import("./pages/Research"),
  deepResearch: () => import("./pages/DeepResearch"),
  citations: () => import("./pages/CitationTools"),
  account: () => import("./pages/Account"),
  dashboard: () => import("./pages/Dashboard"),
  admin: () => import("./pages/Admin"),
};
const DiscoverPage = lazy(load.discover);
const CatalogPage = lazy(load.catalog);
const PaperPage = lazy(load.paper);
const LibraryPage = lazy(load.library);
const DocumentsPage = lazy(load.documents);
const EditorPage = lazy(load.editor);
const ResearchPage = lazy(load.research);
const DeepResearchPage = lazy(load.deepResearch);
const CitationToolsPage = lazy(load.citations);
const AccountPage = lazy(load.account);
const DashboardPage = lazy(load.dashboard);
const AdminPage = lazy(load.admin);

/**
 * The screen a page load opens on starts downloading at once, alongside sign-in, instead of after it: a reload or a
 * shared link to a draft no longer waits for the two one after the other (production run, 25 November 2026).
 */
const FIRST_SCREEN: [RegExp, () => Promise<unknown>][] = [
  [/^\/documents\/[^/]+/, load.editor],
  [/^\/documents\/?$/, load.documents],
  [/^\/research\/deep/, load.deepResearch],
  [/^\/research/, load.research],
  [/^\/discover/, load.discover],
  [/^\/papers\/?$/, load.catalog],
  [/^\/papers\/[^/]+/, load.paper],
  [/^\/library/, load.library],
  [/^\/dashboard/, load.dashboard],
  [/^\/tools\/citations/, load.citations],
];
if (typeof window !== "undefined") {
  FIRST_SCREEN.find(([pattern]) => pattern.test(window.location.pathname))?.[1]().catch(() => undefined);
}

/** Signed-in people land in their workspace; everyone else sees the landing page. */
function IndexPage() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" replace />;
  return <HomePage />;
}

/**
 * One editor instance per document: its save queue, version, title, content and palette all belong to that document.
 * Without the key, moving from draft A to draft B reused A's instance, and A's pending edits could be saved into B.
 */
function EditorRoute() {
  const { id = "" } = useParams();
  return <EditorPage key={id} />;
}

export function App() {
  return (
    <GuidanceProvider>
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<IndexPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="discover" element={<DiscoverPage />} />
          <Route path="papers" element={<CatalogPage />} />
          <Route path="papers/:id" element={<PaperPage />} />
          <Route path="tools/citations" element={<CitationToolsPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="terms" element={<TermsPage />} />
          <Route path="ai-notice" element={<AINoticePage />} />
          <Route path="dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
          <Route path="library" element={<RequireAuth><LibraryPage /></RequireAuth>} />
          <Route path="documents" element={<RequireAuth><DocumentsPage /></RequireAuth>} />
          <Route path="research" element={<RequireAuth><ResearchPage /></RequireAuth>} />
          <Route path="research/deep" element={<RequireAuth><DeepResearchPage /></RequireAuth>} />
          <Route path="account" element={<RequireAuth><AccountPage /></RequireAuth>} />
          <Route path="admin" element={<RequireAuth admin><AdminPage /></RequireAuth>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="documents/:id" element={<RequireAuth><EditorRoute /></RequireAuth>} />
      </Routes>
    </Suspense>
    </GuidanceProvider>
  );
}
