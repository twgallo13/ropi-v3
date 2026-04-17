"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyNewLaunch = notifyNewLaunch;
exports.notifyDateChanged = notifyDateChanged;
exports.notifyNewComment = notifyNewComment;
/**
 * launchNotifier — Step 2.4 Part 3.
 *
 * SMTP notifications for launch events via SendGrid dynamic templates.
 *
 * Three triggers:
 *   1. notifyNewLaunch       — when a launch_record is published
 *   2. notifyDateChanged     — when launch_date changes on a Published record
 *                              (throttled to one email per launch per smtp_throttle_hours)
 *   3. notifyNewComment      — when a new comment is added to a launch
 *
 * Safe to run without SendGrid configured: if SENDGRID_API_KEY is missing
 * the notifier logs the intended send and returns without throwing.
 */
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const db = () => firebase_admin_1.default.firestore();
const SENDGRID_NEW_LAUNCH_TEMPLATE_ID = process.env.SENDGRID_NEW_LAUNCH_TEMPLATE_ID || "";
const SENDGRID_DATE_CHANGED_TEMPLATE_ID = process.env.SENDGRID_DATE_CHANGED_TEMPLATE_ID || "";
const SENDGRID_NEW_COMMENT_TEMPLATE_ID = process.env.SENDGRID_NEW_COMMENT_TEMPLATE_ID || "";
const FROM_EMAIL = process.env.LAUNCH_NOTIFIER_FROM || "launches@shiekh.com";
async function getSubscribers(preferenceKey) {
    const snap = await db().collection("launch_subscribers").get();
    const subs = [];
    snap.forEach((d) => {
        const data = d.data();
        const prefs = data.notification_preferences || {};
        // Default = true when preference not explicitly set
        const enabled = prefs[preferenceKey] !== false;
        if (enabled && data.email)
            subs.push(data);
    });
    return subs;
}
async function sendGridSend(payload) {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
        console.log("[launchNotifier] SENDGRID_API_KEY not set — skipping send", {
            to_count: payload.to.length,
            template: payload.templateId,
        });
        return { sent: false, reason: "SENDGRID_API_KEY not configured" };
    }
    if (!payload.templateId) {
        console.log("[launchNotifier] Template ID not set — skipping send");
        return { sent: false, reason: "template id not configured" };
    }
    if (payload.to.length === 0) {
        return { sent: false, reason: "no subscribers" };
    }
    try {
        const body = {
            from: { email: FROM_EMAIL, name: "Shiekh Launches" },
            personalizations: payload.to.map((email) => ({
                to: [{ email }],
                dynamic_template_data: payload.dynamicTemplateData,
            })),
            template_id: payload.templateId,
        };
        const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errText = await res.text();
            console.error("[launchNotifier] SendGrid error:", res.status, errText);
            return { sent: false, reason: `sendgrid ${res.status}` };
        }
        return { sent: true };
    }
    catch (err) {
        console.error("[launchNotifier] send failed:", err.message);
        return { sent: false, reason: err.message };
    }
}
async function notifyNewLaunch(launch) {
    const subscribers = await getSubscribers("new_launch");
    await sendGridSend({
        to: subscribers.map((s) => s.email),
        templateId: SENDGRID_NEW_LAUNCH_TEMPLATE_ID,
        dynamicTemplateData: {
            product_name: launch.product_name,
            brand: launch.brand,
            launch_date: launch.launch_date,
            image_url: launch.image_1_url,
        },
    });
}
async function getThrottleHours() {
    const doc = await db()
        .collection("admin_settings")
        .doc("smtp_throttle_hours")
        .get();
    if (!doc.exists)
        return 24;
    const val = doc.data()?.value;
    return typeof val === "number" ? val : 24;
}
async function notifyDateChanged(launch, oldDate) {
    const throttleHours = await getThrottleHours();
    const lastNotified = launch.date_change_last_notified_at;
    if (lastNotified?.toMillis) {
        const hoursAgo = (Date.now() - lastNotified.toMillis()) / 3600000;
        if (hoursAgo < throttleHours) {
            console.log(`[launchNotifier] Date change notification throttled for ${launch.launch_id}`);
            return;
        }
    }
    const subscribers = await getSubscribers("date_changed");
    const result = await sendGridSend({
        to: subscribers.map((s) => s.email),
        templateId: SENDGRID_DATE_CHANGED_TEMPLATE_ID,
        dynamicTemplateData: {
            product_name: launch.product_name,
            old_date: oldDate,
            new_date: launch.launch_date,
        },
    });
    if (result.sent) {
        await db()
            .collection("launch_records")
            .doc(launch.launch_id)
            .update({
            date_change_last_notified_at: firebase_admin_1.default.firestore.FieldValue.serverTimestamp(),
        });
    }
}
async function notifyNewComment(launch, commentText, authorName) {
    const subscribers = await getSubscribers("new_comment");
    await sendGridSend({
        to: subscribers.map((s) => s.email),
        templateId: SENDGRID_NEW_COMMENT_TEMPLATE_ID,
        dynamicTemplateData: {
            product_name: launch.product_name,
            comment_preview: (commentText || "").substring(0, 200),
            author_name: authorName,
        },
    });
}
//# sourceMappingURL=launchNotifier.js.map