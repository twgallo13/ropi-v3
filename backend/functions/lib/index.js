"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const importFullProduct_1 = __importDefault(require("./routes/importFullProduct"));
const importWeeklyOperations_1 = __importDefault(require("./routes/importWeeklyOperations"));
const products_1 = __importDefault(require("./routes/products"));
const attributeRegistry_1 = __importDefault(require("./routes/attributeRegistry"));
const buyerReview_1 = __importDefault(require("./routes/buyerReview"));
const buyerActions_1 = __importDefault(require("./routes/buyerActions"));
const exports_1 = __importDefault(require("./routes/exports"));
const mapImport_1 = __importDefault(require("./routes/mapImport"));
const mapReview_1 = __importDefault(require("./routes/mapReview"));
const pricingExport_1 = __importDefault(require("./routes/pricingExport"));
const cadenceRules_1 = __importDefault(require("./routes/cadenceRules"));
const cadenceReview_1 = __importDefault(require("./routes/cadenceReview"));
const promptTemplates_1 = __importDefault(require("./routes/promptTemplates"));
const aiContent_1 = __importDefault(require("./routes/aiContent"));
const launches_1 = __importDefault(require("./routes/launches"));
const adminSmartRules_1 = __importDefault(require("./routes/adminSmartRules"));
const users_1 = __importDefault(require("./routes/users"));
const pricingDiscrepancy_1 = __importDefault(require("./routes/pricingDiscrepancy"));
const siteVerificationImport_1 = __importDefault(require("./routes/siteVerificationImport"));
const siteVerificationReview_1 = __importDefault(require("./routes/siteVerificationReview"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const executive_1 = __importDefault(require("./routes/executive"));
const advisory_1 = __importDefault(require("./routes/advisory"));
const tours_1 = __importDefault(require("./routes/tours"));
const adminUsers_1 = __importDefault(require("./routes/adminUsers"));
const adminSettings_1 = __importDefault(require("./routes/adminSettings"));
// ── Firebase Admin Init ──
firebase_admin_1.default.initializeApp({
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: true }));
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ limit: '50mb', extended: true }));
// ── Health Check (Section 17.0) ──
app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({
        status: "ok",
        environment: process.env.NODE_ENV || "development",
        project: process.env.FIREBASE_PROJECT_ID || "ropi-aoss-dev",
        timestamp: new Date().toISOString(),
    });
});
// ── Import Routes ──
app.use("/api/v1/imports/full-product", importFullProduct_1.default);
app.use("/api/v1/imports/weekly-operations", importWeeklyOperations_1.default);
// ── Product Routes ──
app.use("/api/v1/products", products_1.default);
// ── Attribute Registry ──
app.use("/api/v1/attribute_registry", attributeRegistry_1.default);
// ── Buyer Review + Actions ──
app.use("/api/v1/buyer-review", buyerReview_1.default);
app.use("/api/v1/buyer-actions", buyerActions_1.default);
// ── Export Routes ──
app.use("/api/v1/exports", exports_1.default);
app.use("/api/v1/exports/pricing", pricingExport_1.default);
// ── MAP Policy Import + Review (Step 2.1) ──
app.use("/api/v1/imports/map-policy", mapImport_1.default);
app.use("/api/v1/map-review", mapReview_1.default);
// ── Cadence (Step 2.2) ──
app.use("/api/v1/cadence-rules", cadenceRules_1.default);
app.use("/api/v1", cadenceReview_1.default);
// ── AI Content Pipeline (Step 2.3) ──
app.use("/api/v1/admin/prompt-templates", promptTemplates_1.default);
app.use("/api/v1/products", aiContent_1.default);
// ── Launch Calendar (Step 2.4) ──
app.use("/api/v1/launches", launches_1.default);
// ── Smart Rules Admin (Step 3.1) ──
app.use("/api/v1/admin/smart-rules", adminSmartRules_1.default);
// ── Step 2.5 ──
app.use("/api/v1/users", users_1.default);
app.use("/api/v1/pricing/discrepancy", pricingDiscrepancy_1.default);
app.use("/api/v1/imports/site-verification", siteVerificationImport_1.default);
app.use("/api/v1/site-verification", siteVerificationReview_1.default);
app.use("/api/v1/notifications", notifications_1.default);
app.use("/api/v1/dashboard", dashboard_1.default);
// ── Step 3.2 — Executive ──
app.use("/api/v1/executive", executive_1.default);
// ── Step 3.4 — AI Weekly Advisory ──
app.use("/api/v1/advisory", advisory_1.default);
// ── Step 3.5 — Guided Tours ──
app.use("/api/v1/tours", tours_1.default);
// ── Step 4.2 — Admin Control Center ──
app.use("/api/v1/admin/users", adminUsers_1.default);
app.use("/api/v1/admin", adminSettings_1.default);
// ── Root ──
app.get("/", (_req, res) => {
    res.status(200).json({
        service: "ropi-aoss-api",
        version: "3.0.0",
    });
});
// ── Start ──
const PORT = parseInt(process.env.PORT || "8080", 10);
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀  ropi-aoss-api listening on port ${PORT}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map