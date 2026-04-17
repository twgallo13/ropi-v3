import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import importFullProductRouter from "./routes/importFullProduct";
import importWeeklyOperationsRouter from "./routes/importWeeklyOperations";
import productsRouter from "./routes/products";
import attributeRegistryRouter from "./routes/attributeRegistry";
import buyerReviewRouter from "./routes/buyerReview";
import buyerActionsRouter from "./routes/buyerActions";
import exportsRouter from "./routes/exports";
import mapImportRouter from "./routes/mapImport";
import mapReviewRouter from "./routes/mapReview";
import pricingExportRouter from "./routes/pricingExport";
import cadenceRulesRouter from "./routes/cadenceRules";
import cadenceReviewRouter from "./routes/cadenceReview";
import promptTemplatesRouter from "./routes/promptTemplates";
import aiContentRouter from "./routes/aiContent";
import launchesRouter from "./routes/launches";
import adminSmartRulesRouter from "./routes/adminSmartRules";
import usersRouter from "./routes/users";
import pricingDiscrepancyRouter from "./routes/pricingDiscrepancy";
import siteVerificationImportRouter from "./routes/siteVerificationImport";
import siteVerificationReviewRouter from "./routes/siteVerificationReview";
import notificationsRouter from "./routes/notifications";
import dashboardRouter from "./routes/dashboard";
import executiveRouter from "./routes/executive";
// ── Firebase Admin Init ──
admin.initializeApp({
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
app.use("/api/v1/imports/full-product", importFullProductRouter);
app.use("/api/v1/imports/weekly-operations", importWeeklyOperationsRouter);

// ── Product Routes ──
app.use("/api/v1/products", productsRouter);

// ── Attribute Registry ──
app.use("/api/v1/attribute_registry", attributeRegistryRouter);

// ── Buyer Review + Actions ──
app.use("/api/v1/buyer-review", buyerReviewRouter);
app.use("/api/v1/buyer-actions", buyerActionsRouter);

// ── Export Routes ──
app.use("/api/v1/exports", exportsRouter);
app.use("/api/v1/exports/pricing", pricingExportRouter);

// ── MAP Policy Import + Review (Step 2.1) ──
app.use("/api/v1/imports/map-policy", mapImportRouter);
app.use("/api/v1/map-review", mapReviewRouter);

// ── Cadence (Step 2.2) ──
app.use("/api/v1/cadence-rules", cadenceRulesRouter);
app.use("/api/v1", cadenceReviewRouter);

// ── AI Content Pipeline (Step 2.3) ──
app.use("/api/v1/admin/prompt-templates", promptTemplatesRouter);
app.use("/api/v1/products", aiContentRouter);

// ── Launch Calendar (Step 2.4) ──
app.use("/api/v1/launches", launchesRouter);

// ── Smart Rules Admin (Step 3.1) ──
app.use("/api/v1/admin/smart-rules", adminSmartRulesRouter);

// ── Step 2.5 ──
app.use("/api/v1/users", usersRouter);
app.use("/api/v1/pricing/discrepancy", pricingDiscrepancyRouter);
app.use("/api/v1/imports/site-verification", siteVerificationImportRouter);
app.use("/api/v1/site-verification", siteVerificationReviewRouter);
app.use("/api/v1/notifications", notificationsRouter);
app.use("/api/v1/dashboard", dashboardRouter);

// ── Step 3.2 — Executive ──
app.use("/api/v1/executive", executiveRouter);

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

export default app;
