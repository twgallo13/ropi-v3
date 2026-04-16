"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const importFullProduct_1 = __importDefault(require("./routes/importFullProduct"));
const products_1 = __importDefault(require("./routes/products"));
const attributeRegistry_1 = __importDefault(require("./routes/attributeRegistry"));
// ── Firebase Admin Init ──
firebase_admin_1.default.initializeApp({
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: true }));
app.use(express_1.default.json());
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
// ── Product Routes ──
app.use("/api/v1/products", products_1.default);
// ── Attribute Registry ──
app.use("/api/v1/attribute_registry", attributeRegistry_1.default);
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