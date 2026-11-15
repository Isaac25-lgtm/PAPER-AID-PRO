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
const DiscoverPage = lazy(() => import("./pages/Discover"));
const CatalogPage = lazy(() => import("./pages/Catalog"));
const PaperPage = lazy(() => import("./pages/PaperDetail"));
const LibraryPage = lazy(() => import("./pages/Library"));
const DocumentsPage = lazy(() => import("./pages/Documents"));
const EditorPage = lazy(() => import("./pages/Editor"));
const ResearchPage = lazy(() => import("./pages/Research"));
const DeepResearchPage = lazy(() => import("./pages/DeepResearch"));
const CitationToolsPage = lazy(() => import("./pages/CitationTools"));
const AccountPage = lazy(() => import("./pages/Account"));
const DashboardPage = lazy(() => import("./pages/Dashboard"));
const AdminPage = lazy(() => import("./pages/Admin"));

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
