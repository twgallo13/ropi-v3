/**
 * TALLY-125 Fix 2 + Fix 3 — Attribute Registry Reconciliation
 *
 * Combined seed script for PO-authorized corrections.
 * Source of truth: Google Sheet "Product Attributes for Ropi"
 *
 * Fix 2:  material_fabric, cut_type, league, sports_team — populate dropdown_options
 * Fix 3a: is_fast_fashion — display_group "Category Flags" → "Fast Fashion"
 * Fix 3b: heel_type, platform_height, shoe_height_map — set field_type + dropdown_options
 * Fix 3c: heel_height — set dropdown_options (field_type already "dropdown")
 * Fix 3d: toe_shape — deactivate (not in Google Sheet)
 *
 * Usage:
 *   NODE_PATH=scripts/seed/node_modules node scripts/tally-125-fix23-attribute-reconciliation.js --dry-run
 *   NODE_PATH=scripts/seed/node_modules node scripts/tally-125-fix23-attribute-reconciliation.js --live
 */

var admin = require("firebase-admin");
var key = JSON.parse(process.env.GCP_SA_KEY_DEV);
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(key),
    projectId: "ropi-aoss-dev",
  });
}
var db = admin.firestore();
var DRY = process.argv[2] !== "--live";

// ─── Fix 2: Broken dropdown field definitions ───────────────────────────────

var MATERIAL_FABRIC_OPTIONS = [
  "Acrylic","Canvas","Cotton","Cotton-Blend","Cotton-Rich","Crocodile","Dacron","Denim","Down",
  "Egyptian-Cotton","Fabric","Fabric-And-Leather","Faux-Fur","Fleece","Fur","Gore-Tex","Kevlar",
  "Kidskin","Lambskin","Leather","Linen","Linen-Blend","Lizard","Lurex","Lycra","Lycra Blend",
  "Mercerized-Cotton","Mesh","Merino-Wool","Microfiber","Microsuede","Mohair","Nappa-Leather",
  "Neoprene","Nubuck","Nylon","Ostrich","Patent-Leather","Prima-Cotton","Plain Weave","Plastic",
  "Pleather","Polartec-Fleece","Poly-Cotton","Poly-Rayon","Polyester","Polyester-Blend",
  "Polypropylene","Polyurethane","Pony","Rayon","Rayon-Blend","Rubber","Satin","Sequin",
  "Shearling","Sheepskin","Sherpa","Shetland","Silk","Silk-Blend","Snakeskin","Spandex","Straw",
  "Suede","Synthetic","Tencel","Thinsulate","Ultrasuede","Urethane","Velcro","Velvet","Vinyl",
  "Viscose","Viscose-Rayon","Watersnake","Wool","Wool-Blend","Worsted-Wool"
];

var CUT_TYPE_OPTIONS = ["Low", "Mid", "High"];

var LEAGUE_OPTIONS = ["MLB", "NBA", "NCAA", "NFL", "NHL"];

var SPORTS_TEAM_OPTIONS = [
  "Arizona Cardinals","Atlanta Falcons","Baltimore Ravens","Buffalo Bills","Carolina Panthers",
  "Chicago Bears","Cincinnati Bengals","Cleveland Browns","Dallas Cowboys","Denver Broncos",
  "Detroit Lions","Green Bay Packers","Houston Texans","Indianapolis Colts","Jacksonville Jaguars",
  "Kansas City Chiefs","Las Vegas Raiders","Los Angeles Chargers","Los Angeles Rams","Miami Dolphins",
  "Minnesota Vikings","New England Patriots","New Orleans Saints","New York Giants","New York Jets",
  "Oakland Raiders","Philadelphia Eagles","Pittsburgh Steelers","San Francisco 49ers","Seattle Seahawks",
  "Tampa Bay Buccaneers","Washington Redskins",
  "Arizona Diamondbacks","Atlanta Braves","Baltimore Orioles","Boston Red Sox","Chicago Cubs",
  "Chicago White Sox","Cincinnati Reds","Cleveland Indians","Colorado Rockies","Detroit Tigers",
  "Houston Astros","Kansas City Royals","Los Angeles Angels","Los Angeles Dodgers","Miami Marlins",
  "Milwaukee Brewers","Minnesota Twins","New York Mets","New York Yankees","Oakland Athletics",
  "Philadelphia Phillies","Pittsburgh Pirates","San Diego Padres","San Francisco Giants",
  "Seattle Mariners","St. Louis Cardinals","Tampa Bay Rays","Texas Rangers","Toronto Blue Jays",
  "Washington Nationals",
  "Atlanta Hawks","Boston Celtics","Brooklyn Nets","Charlotte Hornets","Chicago Bulls",
  "Cleveland Cavaliers","Dallas Mavericks","Denver Nuggets","Detroit Pistons","Golden State Warriors",
  "Houston Rockets","Indiana Pacers","Los Angeles Clippers","Los Angeles Lakers","Miami Heat",
  "Milwaukee Bucks","Minnesota Timberwolves","Memphis Grizzlies","New Orleans Pelicans",
  "New York Knicks","Oklahoma City Thunder","Orlando Magic","Philadelphia 76ers","Phoenix Suns",
  "Portland Trail Blazers","San Antonio Spurs","San Diego Clippers","Toronto Raptors","Washington Wizards",
  "Anaheim Ducks","Arizona Coyotes","Boston Bruins","Buffalo Sabres","Calgary Flames",
  "Carolina Hurricanes","Chicago Blackhawks","Colorado Avalanche","Columbus Blue Jackets",
  "Dallas Stars","Detroit Red Wings","Edmonton Oilers","Los Angeles Kings",
  "Minnesota Wild","Montreal Canadiens","Nashville Predators","New Jersey Devils","New York Islanders",
  "New York Rangers","Ottawa Senators","Philadelphia Flyers","Pittsburgh Penguins","San Jose Sharks",
  "St. Louis Blues","Tampa Bay Lightning","Toronto Maple Leafs","Vancouver Canucks",
  "Vegas Golden Knights","Washington Capitals","Winnipeg Jets",
  "USC Trojans","North Carolina Tar Heels"
];

// ─── Fix 3b: Drawer dependent fields ────────────────────────────────────────

var HEEL_TYPE_OPTIONS = [
  "Block Heel","Cone Heel","Flat","Kitten Heel","Stiletto","Wedge Heel","Platform"
];

var PLATFORM_HEIGHT_OPTIONS = [
  "Flat",
  'Low 0-1"',
  "Medium 1-2'",
  'High 2-3"',
  'Ultra High 3-4"'
];

var SHOE_HEIGHT_MAP_OPTIONS = [
  "above-the-knee","ankle-high","high-top","knee-high","low-top","mid-calf","mid-top","thigh-high"
];

// ─── Fix 3c: heel_height ────────────────────────────────────────────────────

var HEEL_HEIGHT_OPTIONS = [
  '1-2"','2-3"','3-4"','5+"'
];

// ─── Mutations ──────────────────────────────────────────────────────────────

var UPDATES = [
  // Fix 2
  {
    doc_id: "material_fabric",
    fix: "Fix 2",
    updates: { field_type: "multi_select", dropdown_options: MATERIAL_FABRIC_OPTIONS },
    reason: "Sheet says multi_select with 79 options; was text with no options"
  },
  {
    doc_id: "cut_type",
    fix: "Fix 2",
    updates: { dropdown_options: CUT_TYPE_OPTIONS },
    reason: "Sheet says dropdown with Low/Mid/High; had no options"
  },
  {
    doc_id: "league",
    fix: "Fix 2",
    updates: { dropdown_options: LEAGUE_OPTIONS },
    reason: "Sheet says dropdown with 5 leagues; had no options"
  },
  {
    doc_id: "sports_team",
    fix: "Fix 2",
    updates: { dropdown_options: SPORTS_TEAM_OPTIONS },
    reason: "Sheet says dropdown with 123 teams; had no options"
  },
  // Fix 3a
  {
    doc_id: "is_fast_fashion",
    fix: "Fix 3a",
    updates: { display_group: "Fast Fashion" },
    reason: 'display_group was "Category Flags"; drawer code expects "Fast Fashion"'
  },
  // Fix 3b
  {
    doc_id: "heel_type",
    fix: "Fix 3b",
    updates: { field_type: "dropdown", dropdown_options: HEEL_TYPE_OPTIONS },
    reason: "field_type was undefined; sheet says dropdown with 7 options"
  },
  {
    doc_id: "platform_height",
    fix: "Fix 3b",
    updates: { field_type: "dropdown", dropdown_options: PLATFORM_HEIGHT_OPTIONS },
    reason: "field_type was undefined; sheet says dropdown with 5 options"
  },
  {
    doc_id: "shoe_height_map",
    fix: "Fix 3b",
    updates: { field_type: "dropdown", dropdown_options: SHOE_HEIGHT_MAP_OPTIONS },
    reason: "field_type was undefined; sheet says dropdown with 8 options"
  },
  // Fix 3c
  {
    doc_id: "heel_height",
    fix: "Fix 3c",
    updates: { dropdown_options: HEEL_HEIGHT_OPTIONS },
    reason: "Already dropdown; sheet options column has 4 range values"
  }
];

var DEACTIVATIONS = [
  // Fix 3d
  {
    doc_id: "toe_shape",
    fix: "Fix 3d",
    reason: "PO removal — not in Google Sheet source of truth"
  }
];

async function run() {
  var mode = DRY ? "DRY-RUN" : "LIVE-RUN";
  console.log("=== TALLY-125 Fix 2+3 Attribute Reconciliation — " + mode + " ===\n");

  // Validation
  console.log("--- Validation ---");
  console.log("material_fabric options: " + MATERIAL_FABRIC_OPTIONS.length + " (expect 79)");
  console.log("sports_team options: " + SPORTS_TEAM_OPTIONS.length + " (expect 123)");
  console.log("heel_type options: " + HEEL_TYPE_OPTIONS.length + " (expect 7)");
  console.log("platform_height options: " + PLATFORM_HEIGHT_OPTIONS.length + " (expect 5)");
  console.log("shoe_height_map options: " + SHOE_HEIGHT_MAP_OPTIONS.length + " (expect 8)");
  console.log("heel_height options: " + HEEL_HEIGHT_OPTIONS.length + " (expect 4)");
  console.log("");

  var auditEvents = 0;

  // ─── Field updates ────────────────────────────────────────────────────────
  for (var i = 0; i < UPDATES.length; i++) {
    var spec = UPDATES[i];
    var ref = db.collection("attribute_registry").doc(spec.doc_id);
    var doc = await ref.get();

    console.log("--- " + spec.fix + ": " + spec.doc_id + " ---");
    if (!doc.exists) {
      console.log("  ERROR: doc does not exist — skipping");
      continue;
    }
    var before = doc.data();
    // Show changed fields only
    for (var key in spec.updates) {
      var oldVal = before[key];
      var newVal = spec.updates[key];
      if (Array.isArray(newVal)) {
        console.log("  " + key + ": " + (Array.isArray(oldVal) ? oldVal.length + " items" : JSON.stringify(oldVal)) + " → " + newVal.length + " items");
      } else {
        console.log("  " + key + ": " + JSON.stringify(oldVal) + " → " + JSON.stringify(newVal));
      }
    }
    console.log("  reason: " + spec.reason);

    if (!DRY) {
      var writePayload = Object.assign({}, spec.updates, {
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      await ref.update(writePayload);
      console.log("  [WRITTEN]");

      // Audit log
      await db.collection("audit_log").add({
        event_type: "attribute_registry.field_reconciliation",
        doc_id: spec.doc_id,
        fix: spec.fix,
        changes: spec.updates,
        reason: spec.reason,
        round: 5,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      auditEvents++;
      console.log("  [AUDIT LOGGED]");
    }
    console.log("");
  }

  // ─── Deactivations ────────────────────────────────────────────────────────
  for (var j = 0; j < DEACTIVATIONS.length; j++) {
    var deact = DEACTIVATIONS[j];
    var dRef = db.collection("attribute_registry").doc(deact.doc_id);
    var dDoc = await dRef.get();

    console.log("--- " + deact.fix + ": DEACTIVATE " + deact.doc_id + " ---");
    if (!dDoc.exists) {
      console.log("  ERROR: doc does not exist — skipping");
      continue;
    }
    var dBefore = dDoc.data();
    console.log("  active: " + dBefore.active + " → false");
    console.log("  reason: " + deact.reason);

    if (!DRY) {
      await dRef.update({
        active: false,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log("  [WRITTEN]");

      await db.collection("audit_log").add({
        event_type: "attribute_registry.deactivated",
        doc_id: deact.doc_id,
        reason: deact.reason,
        round: 5,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      auditEvents++;
      console.log("  [AUDIT LOGGED]");
    }
    console.log("");
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("=== Summary ===");
  console.log("Field updates: " + UPDATES.length);
  console.log("Deactivations: " + DEACTIVATIONS.length);
  console.log("Total mutations: " + (UPDATES.length + DEACTIVATIONS.length));
  if (!DRY) {
    console.log("Audit events written: " + auditEvents);
  } else {
    console.log("[DRY-RUN] No writes made.");
  }

  process.exit(0);
}

run();
