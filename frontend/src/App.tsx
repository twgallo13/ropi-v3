import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import RequireAuth from "./components/RequireAuth";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import CompletionQueuePage from "./pages/CompletionQueuePage";
import ProductDetailPage from "./pages/ProductDetailPage";
import BuyerReviewPage from "./pages/BuyerReviewPage";
import ExportCenterPage from "./pages/ExportCenterPage";
import ImportHubPage from "./pages/ImportHubPage";
import MapConflictReviewPage from "./pages/MapConflictReviewPage";
import MapRemovalReviewPage from "./pages/MapRemovalReviewPage";
import CadenceReviewPage from "./pages/CadenceReviewPage";
import CadenceUnassignedPage from "./pages/CadenceUnassignedPage";
import CadenceRulesAdminPage from "./pages/CadenceRulesAdminPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route path="/queue/completion" element={<CompletionQueuePage />} />
              <Route path="/import-hub" element={<ImportHubPage />} />
              <Route path="/buyer-review" element={<BuyerReviewPage />} />
              <Route path="/cadence-review" element={<CadenceReviewPage />} />
              <Route path="/cadence-unassigned" element={<CadenceUnassignedPage />} />
              <Route path="/admin/cadence-rules" element={<CadenceRulesAdminPage />} />
              <Route path="/map-conflict-review" element={<MapConflictReviewPage />} />
              <Route path="/map-removal-review" element={<MapRemovalReviewPage />} />
              <Route path="/export-center" element={<ExportCenterPage />} />
              <Route path="/products/:mpn" element={<ProductDetailPage />} />
              <Route path="/" element={<Navigate to="/queue/completion" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
