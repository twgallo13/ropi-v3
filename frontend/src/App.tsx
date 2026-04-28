import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import RequireAuth from "./components/RequireAuth";
import Layout from "./components/Layout";
import CommandBar from "./components/CommandBar";
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
import AdvisoryPage from "./pages/AdvisoryPage";
import AdminSettingsPage from "./pages/AdminSettingsPage";
import MorePage from "./pages/MorePage";
import ProductListPage from "./pages/ProductListPage";
import AdminOverviewPage from "./pages/AdminOverviewPage";
import PricingGuardrailsPage from "./pages/PricingGuardrailsPage";
import ExportProfilesPage from "./pages/ExportProfilesPage";
import PermissionsPage from "./pages/PermissionsPage";
import { ComponentDemoPage } from "./pages/ComponentDemoPage";
import { SettingsToastHost, RoleGate } from "./components/admin";

/**
 * TALLY-SETTINGS-UX Phase 3 / B.1 / PR 1 — Defect D1 fix.
 * Static <Navigate to="/admin/ai-automation/smart-rules/:ruleId" /> would forward
 * the literal `:ruleId` string. This component reads the dynamic segment via
 * useParams() and forwards the actual ID.
 */
function SmartRuleRedirect() {
  const { ruleId } = useParams<{ ruleId: string }>();
  return <Navigate to={`/admin/ai-automation/smart-rules/${ruleId}`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <BrowserRouter>
          <AppInner />
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  );
}

function AppInner() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const location = useLocation();

  // Ctrl+K / Cmd+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Save work state on every navigation (pathname + search)
  useEffect(() => {
    const skip = ["/dashboard", "/login", "/"];
    if (!skip.includes(location.pathname)) {
      // lazy require to avoid circular init
      import("./hooks/useWorkState").then((m) =>
        m.saveWorkState(location.pathname, location.search)
      );
    }
  }, [location.pathname, location.search]);

  return (
    <>
      <SettingsToastHost />
      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} />
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
            <Route path="/admin/cadence-rules" element={<Navigate to="/admin/pipeline/cadence" replace />} />
            <Route path="/admin/prompt-templates" element={<Navigate to="/admin/ai-automation/prompt-templates" replace />} />
            <Route path="/admin/smart-rules" element={<Navigate to="/admin/ai-automation/smart-rules" replace />} />
            <Route path="/admin/smart-rules/new" element={<Navigate to="/admin/ai-automation/smart-rules/new" replace />} />
            <Route path="/admin/smart-rules/:ruleId" element={<SmartRuleRedirect />} />
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
            <Route path="/advisory" element={<AdvisoryPage />} />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
            <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
            <Route path="/admin/overview" element={<AdminOverviewPage />} />
            <Route path="/admin/pricing-guardrails" element={<Navigate to="/admin/infrastructure/pricing-guardrails" replace />} />
            <Route path="/admin/export-profiles" element={<Navigate to="/admin/pipeline/export-profiles" replace />} />
            <Route path="/admin/permissions" element={<Navigate to="/admin/governance/permissions" replace />} />
            {/* TALLY-SETTINGS-UX Phase 3 / B.1 / PR 1 — new canonical mounts (existing components at new URLs) */}
            <Route path="/admin/ai-automation/smart-rules" element={<SmartRulesAdminPage />} />
            <Route path="/admin/ai-automation/smart-rules/new" element={<SmartRuleBuilderPage />} />
            <Route path="/admin/ai-automation/smart-rules/:ruleId" element={<SmartRuleBuilderPage />} />
            <Route path="/admin/ai-automation/prompt-templates" element={<PromptTemplatesAdminPage />} />
            <Route path="/admin/pipeline/cadence" element={<CadenceRulesAdminPage />} />
            <Route path="/admin/pipeline/export-profiles" element={<ExportProfilesPage />} />
            <Route path="/admin/infrastructure/pricing-guardrails" element={<PricingGuardrailsPage />} />
            <Route path="/admin/governance/permissions" element={<PermissionsPage />} />
            <Route
              path="/admin/component-demo"
              element={
                <RoleGate>
                  <ComponentDemoPage />
                </RoleGate>
              }
            />
            <Route path="/products" element={<ProductListPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </>
  );
}
