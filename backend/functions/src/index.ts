import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import importFullProductRouter from "./routes/importFullProduct";
import importWeeklyOperationsRouter from "./routes/importWeeklyOperations";
import productsRouter from "./routes/products";
import attributeRegistryRouter from "./routes/attributeRegistry";
import buyerReviewRouter from "./routes/buyerReview";
import buyerActionsRouter from "./routes/buyerActions";

// ── Firebase Admin Init ──
admin.initializeApp({
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

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
