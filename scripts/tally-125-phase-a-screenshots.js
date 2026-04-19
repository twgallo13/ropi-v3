#!/usr/bin/env node
/**
 * TALLY-125 Phase A — Capture 8 acceptance screenshots via Puppeteer.
 *
 * 1-2: Normal render — Active Websites (multi_select) + Site Owner (dropdown)
 *      showing display_name labels, submitting site_key values
 * 3-4: Fetch-fail — /site-registry blocked → red border, disabled
 * 5-6: Empty-registry — /site-registry returns empty → amber border, disabled
 * 7-8: Orphaned-value — product has unknown site_key → "(inactive)" label
 * 9-10: Regression — two non-site attribute fields rendering unchanged
 *
 * Usage: NODE_PATH=scripts/seed/node_modules node scripts/tally-125-phase-a-screenshots.js
 */
"use strict";

const puppeteer = require("puppeteer");
const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

const KEY_ENV = process.env.GCP_SA_KEY_DEV;
if (!KEY_ENV) { console.error("GCP_SA_KEY_DEV not set"); process.exit(1); }

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(KEY_ENV)),
  projectId: "ropi-aoss-dev",
});
const db = admin.firestore();

const API_KEY = "AIzaSyCWxHKfmKzIh3PLXimA1DAEObwUinE2gIU";
const APP_URL = "https://ropi-aoss-dev.web.app";
const TEST_MPN = "4A1H13";
const OUT_DIR = path.join(__dirname, "..", "evidence", "tally-125-phase-a");

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("Setting up screenshot capture...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // ── Create test user with known password and sign in via form ──
  const testEmail = "tally125-screenshot@ropi.dev";
  const testPassword = "T125Screenshot!2026";
  const testUid = "tally125-ss-bot";
  
  try {
    await admin.auth().getUser(testUid);
    await admin.auth().updateUser(testUid, { email: testEmail, password: testPassword });
  } catch {
    try {
      await admin.auth().createUser({ uid: testUid, email: testEmail, password: testPassword });
    } catch {
      // Email might be taken by different uid — delete by email first
      try {
        const existing = await admin.auth().getUserByEmail(testEmail);
        await admin.auth().deleteUser(existing.uid);
      } catch {}
      await admin.auth().createUser({ uid: testUid, email: testEmail, password: testPassword });
    }
  }
  await db.collection("users").doc(testUid).set(
    { email: testEmail, role: "admin", display_name: "TALLY-125 Bot" },
    { merge: true }
  );
  console.log("✅ Test user ready");

  // Navigate to login page
  await page.goto(`${APP_URL}/login`, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(2000);
  
  // Fill login form
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.type('input[type="email"]', testEmail);
  await page.type('input[type="password"]', testPassword);
  
  // Submit
  await page.click('button[type="submit"]');
  
  // Wait for redirect
  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
  await sleep(3000);
  console.log("✅ Logged in, current URL:", page.url());

  // ── Screenshot 1-2: Normal render ──
  console.log("\n📸 Capturing normal render...");
  await page.goto(`${APP_URL}/products/${TEST_MPN}`, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000); // Let registry-driven dropdowns load
  
  // Find and screenshot the Active Websites multi-select (Visibility group)
  // and Site Owner dropdown (Other group)
  // First, take a full-page screenshot for context
  await page.screenshot({ path: path.join(OUT_DIR, "01-normal-full-page.png"), fullPage: true });
  console.log("  01-normal-full-page.png");
  
  // Try to find specific sections
  const visibilitySection = await findSectionByHeading(page, "Visibility");
  if (visibilitySection) {
    await visibilitySection.screenshot({ path: path.join(OUT_DIR, "02-normal-active-websites.png") });
    console.log("  02-normal-active-websites.png (Active Websites multi-select)");
  } else {
    console.log("  ⚠️  Could not find Visibility section — full page captured");
  }

  const otherSection = await findSectionByHeading(page, "Other");
  if (otherSection) {
    await otherSection.screenshot({ path: path.join(OUT_DIR, "03-normal-site-owner.png") });
    console.log("  03-normal-site-owner.png (Site Owner dropdown)");
  } else {
    console.log("  ⚠️  Could not find Other section — full page captured");
  }

  // ── Unregister service worker so Puppeteer request interception works ──
  console.log("\n🔧 Unregistering service worker for interception scenarios...");
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const r of registrations) await r.unregister();
  });
  await sleep(1000);

  // ── Screenshot 3-4: Fetch-fail (use fresh page to avoid interception state leakage) ──
  console.log("\n📸 Capturing fetch-fail (block /site-registry)...");
  {
    const ffPage = await browser.newPage();
    await ffPage.setViewport({ width: 1440, height: 900 });
    // Bypass service worker via CDP so Puppeteer request interception works
    const ffCdp = await ffPage.createCDPSession();
    await ffCdp.send("Network.enable");
    await ffCdp.send("Network.setBypassServiceWorker", { bypass: true });
    await ffPage.setRequestInterception(true);
    ffPage.on("request", (req) => {
      if (req.url().includes("/site-registry")) {
        console.log("    [INTERCEPT] Aborting:", req.url());
        req.abort("failed");
      } else {
        req.continue();
      }
    });
    // Inject auth cookies/storage from the logged-in page
    const cookies = await page.cookies();
    await ffPage.setCookie(...cookies);
    const lsData = await page.evaluate(() => JSON.stringify(localStorage));
    await ffPage.goto(`${APP_URL}/login`, { waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
    await ffPage.evaluate((data) => {
      const items = JSON.parse(data);
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    }, lsData);
    await ffPage.goto(`${APP_URL}/products/${TEST_MPN}`, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(4000);

    await ffPage.screenshot({ path: path.join(OUT_DIR, "04-fetch-fail-full.png"), fullPage: true });
    console.log("  04-fetch-fail-full.png");

    const visFetchFail = await findSectionByHeading(ffPage, "Visibility");
    if (visFetchFail) {
      await visFetchFail.screenshot({ path: path.join(OUT_DIR, "05-fetch-fail-active-websites.png") });
      console.log("  05-fetch-fail-active-websites.png");
    }
    const otherFetchFail = await findSectionByHeading(ffPage, "Other");
    if (otherFetchFail) {
      await otherFetchFail.screenshot({ path: path.join(OUT_DIR, "06-fetch-fail-site-owner.png") });
      console.log("  06-fetch-fail-site-owner.png");
    }
    await ffPage.close();
  }

  // ── Screenshot 5-6: Empty-registry (fresh page) ──
  console.log("\n📸 Capturing empty-registry (intercept /site-registry → empty)...");
  {
    const emPage = await browser.newPage();
    await emPage.setViewport({ width: 1440, height: 900 });
    // Bypass service worker via CDP so Puppeteer request interception works
    const emCdp = await emPage.createCDPSession();
    await emCdp.send("Network.enable");
    await emCdp.send("Network.setBypassServiceWorker", { bypass: true });
    await emPage.setRequestInterception(true);
    emPage.on("request", (req) => {
      if (req.url().includes("/site-registry")) {
        if (req.method() === "OPTIONS") {
          // Answer CORS preflight properly
          req.respond({
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
              "Access-Control-Allow-Headers": "Authorization, Content-Type",
            },
          });
        } else {
          console.log("    [INTERCEPT] Responding empty:", req.url());
          req.respond({
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
            body: JSON.stringify({ sites: [] }),
          });
        }
      } else {
        req.continue();
      }
    });
    const cookies = await page.cookies();
    await emPage.setCookie(...cookies);
    const lsData = await page.evaluate(() => JSON.stringify(localStorage));
    await emPage.goto(`${APP_URL}/login`, { waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
    await emPage.evaluate((data) => {
      const items = JSON.parse(data);
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    }, lsData);
    await emPage.goto(`${APP_URL}/products/${TEST_MPN}`, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(4000);

    await emPage.screenshot({ path: path.join(OUT_DIR, "07-empty-registry-full.png"), fullPage: true });
    console.log("  07-empty-registry-full.png");

    const visEmpty = await findSectionByHeading(emPage, "Visibility");
    if (visEmpty) {
      await visEmpty.screenshot({ path: path.join(OUT_DIR, "08-empty-registry-active-websites.png") });
      console.log("  08-empty-registry-active-websites.png");
    }
    const otherEmpty = await findSectionByHeading(emPage, "Other");
    if (otherEmpty) {
      await otherEmpty.screenshot({ path: path.join(OUT_DIR, "09-empty-registry-site-owner.png") });
      console.log("  09-empty-registry-site-owner.png");
    }
    await emPage.close();
  }

  // ── Screenshot 7-8: Orphaned value ──
  console.log("\n📸 Capturing orphaned-value (set fake site_owner temporarily)...");
  // Temporarily set a fake site_owner on the test product
  const productRef = db.collection("products").doc(TEST_MPN);
  const origSnap = await productRef.get();
  const origSiteOwner = origSnap.data()?.site_owner;
  
  // Also set a fake attribute_values.website
  const websiteRef = db.collection("products").doc(TEST_MPN).collection("attribute_values").doc("website");
  const origWebsite = await websiteRef.get();
  const origWebsiteData = origWebsite.exists ? origWebsite.data() : null;
  
  await productRef.update({ site_owner: "fake_test_site" });
  await websiteRef.set({ value: "fake_test_site", updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  
  await page.goto(`${APP_URL}/products/${TEST_MPN}`, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  await page.screenshot({ path: path.join(OUT_DIR, "10-orphaned-value-full.png"), fullPage: true });
  console.log("  10-orphaned-value-full.png");

  const visOrphan = await findSectionByHeading(page, "Visibility");
  if (visOrphan) {
    await visOrphan.screenshot({ path: path.join(OUT_DIR, "11-orphaned-active-websites.png") });
    console.log("  11-orphaned-active-websites.png");
  }
  const otherOrphan = await findSectionByHeading(page, "Other");
  if (otherOrphan) {
    await otherOrphan.screenshot({ path: path.join(OUT_DIR, "12-orphaned-site-owner.png") });
    console.log("  12-orphaned-site-owner.png");
  }

  // Revert the fake data
  await productRef.update({ site_owner: origSiteOwner });
  if (origWebsiteData) {
    await websiteRef.set(origWebsiteData);
  } else {
    await websiteRef.delete();
  }
  console.log("  ✅ Reverted test product data");

  // ── Screenshot 9-10: Regression — two non-site fields ──
  console.log("\n📸 Capturing regression — non-site attribute fields...");
  await page.goto(`${APP_URL}/products/${TEST_MPN}`, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  // Capture full page — non-site fields will be visible in the attribute grid
  await page.screenshot({ path: path.join(OUT_DIR, "13-regression-full-page.png"), fullPage: true });
  console.log("  13-regression-full-page.png (shows all attribute fields including non-site)");

  // Try to find specific non-site sections
  for (const groupName of ["Categorization", "Core Information", "Dimensions"]) {
    const section = await findSectionByHeading(page, groupName);
    if (section) {
      const safeName = groupName.toLowerCase().replace(/\s+/g, "-");
      await section.screenshot({ path: path.join(OUT_DIR, `14-regression-${safeName}.png`) });
      console.log(`  14-regression-${safeName}.png`);
      break; // Just need one group with non-site fields
    }
  }

  await browser.close();
  
  // List all captured files
  console.log("\n=== Screenshot files ===");
  const files = fs.readdirSync(OUT_DIR).sort();
  files.forEach(f => console.log(`  ${f} (${(fs.statSync(path.join(OUT_DIR, f)).size / 1024).toFixed(1)} KB)`));
  console.log(`\nTotal: ${files.length} screenshots in ${OUT_DIR}`);
  console.log("\nDone.");
}

async function findSectionByHeading(page, headingText) {
  const sections = await page.$$("h4");
  for (const h4 of sections) {
    const text = await page.evaluate((el) => el.textContent, h4);
    if (text && text.trim().toUpperCase().includes(headingText.toUpperCase())) {
      // Return the parent div that contains the heading + its fields
      const parent = await page.evaluate((el) => {
        const p = el.closest("div");
        return p ? true : false;
      }, h4);
      if (parent) {
        return await h4.evaluateHandle((el) => el.parentElement);
      }
    }
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
