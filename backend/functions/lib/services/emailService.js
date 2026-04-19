"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdminSetting = getAdminSetting;
exports.sendEmail = sendEmail;
/**
 * emailService — Step 4.2 Amendment B
 * Supports SendGrid (via @sendgrid/mail) or Custom SMTP (via nodemailer).
 * Provider selection is read from admin_settings.email_provider.
 *
 * SMTP password is sensitive — loaded from the SMTP_PASSWORD env var only,
 * never from Firestore. Same for SendGrid API key (SENDGRID_API_KEY).
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const mail_1 = __importDefault(require("@sendgrid/mail"));
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
async function sendEmail(opts) {
    const fromAddress = (await getAdminSetting("smtp_from_address", "theo@shiekhshoes.org")) || "theo@shiekhshoes.org";
    const fromName = (await getAdminSetting("smtp_from_name", "ROPI Operations")) ||
        "ROPI Operations";
    const provider = (await getAdminSetting("email_provider", "sendgrid")) || "sendgrid";
    if (provider === "sendgrid") {
        const apiKey = process.env.SENDGRID_API_KEY || "";
        if (!apiKey) {
            throw new Error("SendGrid selected but SENDGRID_API_KEY env var is not set.");
        }
        mail_1.default.setApiKey(apiKey);
        const from = opts.from || { name: fromName, email: fromAddress };
        try {
            await mail_1.default.send({
                to: opts.to,
                from,
                subject: opts.subject,
                html: opts.html,
            });
        }
        catch (err) {
            const body = err?.response?.body;
            const msg = body?.errors?.[0]?.message || err.message || String(err);
            throw new Error(`SendGrid send failed: ${msg}`);
        }
        return;
    }
    // Custom SMTP (nodemailer)
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
    const transport = nodemailer_1.default.createTransport({
        host,
        port: Number(port),
        secure: Number(port) === 465,
        auth: { user, pass },
    });
    await transport.sendMail({
        from: opts.from || `"${fromName}" <${fromAddress}>`,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
    });
}
//# sourceMappingURL=emailService.js.map