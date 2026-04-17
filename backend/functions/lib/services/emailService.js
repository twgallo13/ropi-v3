"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdminSetting = getAdminSetting;
exports.getEmailTransport = getEmailTransport;
exports.sendEmail = sendEmail;
/**
 * emailService — Step 4.2 Amendment A
 * Shared transport factory supporting SendGrid (via nodemailer-sendgrid)
 * or Custom SMTP. Provider selection is read from admin_settings.email_provider.
 *
 * SMTP password is sensitive — loaded from the SMTP_PASSWORD env var only,
 * never from Firestore. Same for SendGrid API key (SENDGRID_API_KEY).
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const nodemailer_1 = __importDefault(require("nodemailer"));
// @ts-expect-error — nodemailer-sendgrid ships without TS types
const nodemailer_sendgrid_1 = __importDefault(require("nodemailer-sendgrid"));
const db = () => firebase_admin_1.default.firestore();
async function getAdminSetting(key, fallback) {
    try {
        const snap = await db().collection("admin_settings").doc(key).get();
        if (!snap.exists)
            return fallback;
        const v = snap.data()?.value;
        return v === undefined ? fallback : v;
    }
    catch {
        return fallback;
    }
}
async function getEmailTransport() {
    const provider = (await getAdminSetting("email_provider", "sendgrid")) || "sendgrid";
    if (provider === "sendgrid") {
        const apiKey = process.env.SENDGRID_API_KEY || "";
        if (!apiKey) {
            throw new Error("SendGrid selected but SENDGRID_API_KEY env var is not set.");
        }
        return nodemailer_1.default.createTransport((0, nodemailer_sendgrid_1.default)({ apiKey }));
    }
    // Custom SMTP
    const host = await getAdminSetting("smtp_host");
    const port = (await getAdminSetting("smtp_port", 587)) || 587;
    const user = await getAdminSetting("smtp_username");
    const pass = process.env.SMTP_PASSWORD || "";
    if (!host || !user) {
        throw new Error("Custom SMTP selected but smtp_host / smtp_username are not configured.");
    }
    if (!pass) {
        throw new Error("Custom SMTP selected but SMTP_PASSWORD env var is not set.");
    }
    return nodemailer_1.default.createTransport({
        host,
        port: Number(port),
        secure: Number(port) === 465,
        auth: { user, pass },
    });
}
async function sendEmail(opts) {
    const fromAddress = (await getAdminSetting("smtp_from_address", "noreply@shiekhshoes.com")) || "noreply@shiekhshoes.com";
    const fromName = (await getAdminSetting("smtp_from_name", "ROPI Operations")) ||
        "ROPI Operations";
    const transport = await getEmailTransport();
    await transport.sendMail({
        from: opts.from || `"${fromName}" <${fromAddress}>`,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
    });
}
//# sourceMappingURL=emailService.js.map