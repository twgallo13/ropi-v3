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
import PromptTemplatesAdminPage from "./pages/PromptTemplatesAdminPage";
import AIContentReviewPage from "./pages/AIContentReviewPage";
import LaunchAdminListPage from "./pages/LaunchAdminListPage";
import LaunchAdminDetailPage from "./pages/LaunchAdminDetailPage";
import PublicLaunchCalendarPage from "./pages/PublicLaunchCalendarPage";
import SmartRulesAdminPage from "./pages/SmartRulesAdminPage";
import SmartRuleBuilderPage from "./pages/SmartRuleBuilderPage";
import DashboardPage from "./pages/DashboardPage";
import PricingDiscrepancyPage from "./pages/PricingDiscrepancyPage";
import SiteVerificationReviewPage from "./pages/SiteVerificationReviewPage";
import NotificationSettingsPage from "./pages/NotificationSettingsPage";
import ExecutiveDashboardPage from "./pages/ExecutiveDashboardPage";
import NeglectedInventoryPage from "./pages/NeglectedInventoryPage";
import ChannelDisparityPage from "./pages/ChannelDisparityPage";
import BuyerPerformancePage from "./pages/BuyerPerformancePage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Public Launch Calendar — NO auth required */}
          <Route path="/launches" element={<PublicLaunchCalendarPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route path="/queue/completion" element={<CompletionQueuePage />} />
              <Route path="/import-hub" element={<ImportHubPage />} />
              <Route path="/buyer-review" element={<BuyerReviewPage />} />
              <Route path="/cadence-review" element={<CadenceReviewPage />} />
              <Route path="/cadence-unassigned" element={<CadenceUnassignedPage />} />
              <Route path="/admin/cadence-rules" element={<CadenceRulesAdminPage />} />
              <Route path="/admin/prompt-templates" element={<PromptTemplatesAdminPage />} />
              <Route path="/admin/smart-rules" element={<SmartRulesAdminPage />} />
              <Route path="/admin/smart-rules/new" element={<SmartRuleBuilderPage />} />
              <Route path="/admin/smart-rules/:ruleId" element={<SmartRuleBuilderPage />} />
              <Route path="/map-conflict-review" element={<MapConflictReviewPage />} />
              <Route path="/map-removal-review" element={<MapRemovalReviewPage />} />
              <Route path="/export-center" element={<ExportCenterPage />} />
              <Route path="/launch-admin" element={<LaunchAdminListPage />} />
              <Route path="/launch-admin/:launchId" element={<LaunchAdminDetailPage />} />
              <Route path="/products/:mpn" element={<ProductDetailPage />} />
              <Route path="/products/:mpn/review" element={<AIContentReviewPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/pricing-discrepancy" element={<PricingDiscrepancyPage />} />
              <Route path="/site-verification" element={<SiteVerificationReviewPage />} />
              <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
              <Route path="/executive" element={<ExecutiveDashboardPage />} />
              <Route path="/neglected-inventory" element={<NeglectedInventoryPage />} />
              <Route path="/channel-disparity" element={<ChannelDisparityPage />} />
              <Route path="/buyer-performance" element={<BuyerPerformancePage />} />
              <Route path="/buyer-performance/:buyer_uid" element={<BuyerPerformancePage />} />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
