import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";

import { GuidanceProvider } from "./components/Guidance";
import { Layout, RequireAuth } from "./components/Layout";
import { Spinner } from "./components/ui";
import { HomePage } from "./pages/Home";
import { LoginPage, RegisterPage, ResetPasswordPage } from "./pages/Auth";
import { NotFoundPage, PrivacyPage } from "./pages/Static";

// Heavier screens are code-split so the landing page stays fast.
const DiscoverPage = lazy(() => import("./pages/Discover"));
const CatalogPage = lazy(() => import("./pages/Catalog"));
const PaperPage = lazy(() => import("./pages/PaperDetail"));
const LibraryPage = lazy(() => import("./pages/Library"));
const DocumentsPage = lazy(() => import("./pages/Documents"));
const EditorPage = lazy(() => import("./pages/Editor"));
const ResearchPage = lazy(() => import("./pages/Research"));
const CitationToolsPage = lazy(() => import("./pages/CitationTools"));
const AccountPage = lazy(() => import("./pages/Account"));
const DashboardPage = lazy(() => import("./pages/Dashboard"));
const AdminPage = lazy(() => import("./pages/Admin"));

export function App() {
  return (
    <GuidanceProvider>
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="discover" element={<DiscoverPage />} />
          <Route path="papers" element={<CatalogPage />} />
          <Route path="papers/:id" element={<PaperPage />} />
          <Route path="tools/citations" element={<CitationToolsPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
          <Route path="library" element={<RequireAuth><LibraryPage /></RequireAuth>} />
          <Route path="documents" element={<RequireAuth><DocumentsPage /></RequireAuth>} />
          <Route path="research" element={<RequireAuth><ResearchPage /></RequireAuth>} />
          <Route path="account" element={<RequireAuth><AccountPage /></RequireAuth>} />
          <Route path="admin" element={<RequireAuth admin><AdminPage /></RequireAuth>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="documents/:id" element={<RequireAuth><EditorPage /></RequireAuth>} />
      </Routes>
    </Suspense>
    </GuidanceProvider>
  );
}
