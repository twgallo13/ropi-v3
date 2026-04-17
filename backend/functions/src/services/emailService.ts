/**
 * emailService — Step 4.2 Amendment A
 * Shared transport factory supporting SendGrid (via nodemailer-sendgrid)
 * or Custom SMTP. Provider selection is read from admin_settings.email_provider.
 *
 * SMTP password is sensitive — loaded from the SMTP_PASSWORD env var only,
 * never from Firestore. Same for SendGrid API key (SENDGRID_API_KEY).
 */
import admin from "firebase-admin";
import nodemailer from "nodemailer";
// @ts-expect-error — nodemailer-sendgrid ships without TS types
import sgTransport from "nodemailer-sendgrid";

const db = () => admin.firestore();

export async function getAdminSetting<T = any>(
  key: string,
  fallback?: T
): Promise<T | undefined> {
  try {
    const snap = await db().collection("admin_settings").doc(key).get();
    if (!snap.exists) return fallback;
    const v = snap.data()?.value;
    return v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export async function getEmailTransport(): Promise<nodemailer.Transporter> {
  const provider =
    (await getAdminSetting<string>("email_provider", "sendgrid")) || "sendgrid";

  if (provider === "sendgrid") {
    const apiKey = process.env.SENDGRID_API_KEY || "";
    if (!apiKey) {
      throw new Error(
        "SendGrid selected but SENDGRID_API_KEY env var is not set."
      );
    }
    return nodemailer.createTransport(sgTransport({ apiKey }));
  }

  // Custom SMTP
  const host = await getAdminSetting<string>("smtp_host");
  const port = (await getAdminSetting<number>("smtp_port", 587)) || 587;
  const user = await getAdminSetting<string>("smtp_username");
  const pass = process.env.SMTP_PASSWORD || "";
  if (!host || !user) {
    throw new Error(
      "Custom SMTP selected but smtp_host / smtp_username are not configured."
    );
  }
  if (!pass) {
    throw new Error(
      "Custom SMTP selected but SMTP_PASSWORD env var is not set."
    );
  }
  return nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
  });
}

export interface SendEmailOpts {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail(opts: SendEmailOpts): Promise<void> {
  const fromAddress =
    (await getAdminSetting<string>(
      "smtp_from_address",
      "noreply@shiekhshoes.com"
    )) || "noreply@shiekhshoes.com";
  const fromName =
    (await getAdminSetting<string>("smtp_from_name", "ROPI Operations")) ||
    "ROPI Operations";
  const transport = await getEmailTransport();
  await transport.sendMail({
    from: opts.from || `"${fromName}" <${fromAddress}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
