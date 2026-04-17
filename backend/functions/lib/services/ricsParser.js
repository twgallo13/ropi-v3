"use strict";
/**
 * ricsParser.ts — Import Intelligence Layer
 *
 * Pure-function helpers for the Full Product Import:
 *   - parseRicsCategory       — rules-based RICS Category hierarchy parser
 *   - normalizeGender         — raw group/gender token → canonical value
 *   - formatRicsShortDesc     — ALL CAPS RICS short desc → Title Case
 *   - getNikeIndustryMpn      — "HV5060 800" → "HV5060-800" for Nike/Jordan
 *   - normalizeColor          — RICS color abbreviations → consumer-facing
 *   - mapFullProductRow       — 50-column RO export → canonical attribute set
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NUMERIC_ATTRIBUTES = exports.BOOLEAN_ATTRIBUTES = exports.FULL_PRODUCT_ROW_MAP = void 0;
exports.parseRicsCategory = parseRicsCategory;
exports.normalizeGender = normalizeGender;
exports.formatRicsShortDesc = formatRicsShortDesc;
exports.getNikeIndustryMpn = getNikeIndustryMpn;
exports.resolveProductName = resolveProductName;
exports.normalizeColor = normalizeColor;
exports.coerceValue = coerceValue;
exports.mapFullProductRow = mapFullProductRow;
const FOOTWEAR_DEPT_ALIASES = new Set([
    "footwear",
    "shiekh branded fw",
    "shiekh branded",
]);
const GENDER_FIRST_SEGMENTS = new Set([
    "mens",
    "men's",
    "womens",
    "women's",
    "kids",
]);
function parseRicsCategory(ricsCategory) {
    if (!ricsCategory)
        return {};
    const segments = ricsCategory
        .split("||")
        .map((s) => s.trim())
        .filter(Boolean);
    if (segments.length === 0)
        return {};
    const seg0 = segments[0].toLowerCase();
    const result = {};
    // ── Apparel ──
    if (seg0 === "apparel") {
        result.department = "Clothing";
        result.gender = normalizeGender(segments[1] || "");
        result.class = segments[2] || undefined;
        result.category = segments[3] || undefined;
        return result;
    }
    // ── Accessories ──
    if (seg0 === "accessories") {
        result.department = "Accessories";
        if (segments[1]) {
            const maybe = normalizeGender(segments[1]);
            if (maybe !== segments[1])
                result.gender = maybe;
        }
        result.class = segments[2] || undefined;
        result.category = segments[3] || undefined;
        return result;
    }
    // ── Kids Footwear ──
    if (seg0 === "kids") {
        result.gender = "Kids";
        result.age_group_detail = segments[1] || undefined;
        const deptIdx = segments.findIndex((s, i) => i >= 2 && FOOTWEAR_DEPT_ALIASES.has(s.toLowerCase()));
        if (deptIdx >= 0) {
            result.department = "Footwear";
            result.class = segments[deptIdx + 1] || undefined;
            result.category = segments[deptIdx + 2] || undefined;
        }
        else {
            result.class = segments[2] || undefined;
            result.category = segments[3] || undefined;
        }
        return result;
    }
    // ── Mens / Womens Footwear ──
    if (GENDER_FIRST_SEGMENTS.has(seg0)) {
        result.gender = normalizeGender(segments[0]);
        const seg1 = (segments[1] || "").toLowerCase();
        result.department = FOOTWEAR_DEPT_ALIASES.has(seg1)
            ? "Footwear"
            : segments[1] || undefined;
        result.class = segments[2] || undefined;
        result.category = segments[3] || undefined;
        return result;
    }
    // ── Fallback ──
    result.department = segments[0];
    return result;
}
function normalizeGender(raw) {
    if (!raw)
        return "";
    const map = {
        "men's": "Mens",
        mens: "Mens",
        men: "Mens",
        "women's": "Womens",
        womens: "Womens",
        women: "Womens",
        kids: "Kids",
        boys: "Boys",
        girls: "Girls",
        unisex: "Unisex",
        toddler: "Toddler",
        "grade school": "Kids",
        infant: "Toddler",
    };
    return map[raw.toLowerCase().trim()] || raw;
}
// ─── Name helpers ────────────────────────────────────────────────────────
function formatRicsShortDesc(raw) {
    if (!raw)
        return "";
    return raw
        .split(/\s+/)
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
        .join(" ")
        .trim();
}
function getNikeIndustryMpn(mpn, brand) {
    if (!mpn || !brand)
        return null;
    const b = brand.toLowerCase();
    if (!b.includes("nike") && !b.includes("jordan"))
        return null;
    // Replace trailing " 800" with "-800"
    return mpn.replace(/\s+(\w+)$/, "-$1");
}
/**
 * Decides whether the imported Name is a real operator/buyer name, or a
 * fallback copy of the RICS Short Description. Returns the chosen final
 * name and a source marker.
 */
function resolveProductName(rawName, ricsShortDesc) {
    const name = (rawName || "").trim();
    const rics = (ricsShortDesc || "").trim();
    const uuidish = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!name || uuidish.test(name)) {
        if (rics)
            return { name: formatRicsShortDesc(rics), source: "rics_short_desc" };
        return { name: "", source: "empty" };
    }
    // If CSV Name is byte-identical to RICS short desc, treat as fallback too
    if (rics && name.toLowerCase() === rics.toLowerCase()) {
        return { name: formatRicsShortDesc(rics), source: "rics_short_desc" };
    }
    return { name, source: "csv_name" };
}
// ─── Color normalization ─────────────────────────────────────────────────
const COLOR_NORMALIZATIONS = {
    blk: "Black",
    wht: "White",
    rd: "Red",
    brn: "Brown",
    gry: "Grey",
    pnk: "Pink",
    yllw: "Yellow",
    orng: "Orange",
    prpl: "Purple",
    grn: "Green",
    nvy: "Navy",
    slvr: "Silver",
    gld: "Gold",
    tnl: "Tonal",
    mlti: "Multi",
    "univ blue": "University Blue",
    "univ red": "University Red",
    lt: "Light",
    dk: "Dark",
    med: "Medium",
};
function normalizeColor(ricsColor) {
    if (!ricsColor)
        return "";
    const trimmed = ricsColor.trim();
    // Try full-phrase matches first ("univ blue")
    const lower = trimmed.toLowerCase();
    if (COLOR_NORMALIZATIONS[lower])
        return COLOR_NORMALIZATIONS[lower];
    return trimmed
        .split(/[\s/\-]+/)
        .map((w) => {
        if (!w)
            return w;
        const n = COLOR_NORMALIZATIONS[w.toLowerCase()];
        return n || w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
        .join(" ");
}
// ─── Full column mapping ─────────────────────────────────────────────────
/**
 * Canonical column → attribute key mapping for the RO export.
 * Every column John's production file produces is represented here.
 */
exports.FULL_PRODUCT_ROW_MAP = {
    "RO Status": "ro_status",
    MPN: "mpn",
    SKU: "sku",
    "Last Received": "last_received_at",
    "First Received": "first_received_at",
    Brand: "brand",
    Name: "name",
    "Age Group": "age_group",
    Group: "gender_raw",
    Department: "department_raw",
    Class: "class",
    Category: "category",
    "Primary Color": "primary_color",
    "Descriptive Color": "descriptive_color",
    TaxClass: "tax_class",
    Keywords: "keywords",
    "Style ID": "style_id",
    Fit: "fit",
    "Material Fabric": "material_fabric",
    MAP: "is_map_protected",
    Promo: "promo_status",
    HYPE: "is_hype",
    "Sports Team": "sports_team",
    League: "league",
    Description: "description",
    "Media Status": "media_status",
    FastFashion: "is_fast_fashion",
    "New Collection": "is_new_collection",
    "Launch Date": "launch_date",
    "Hide Image Until Date": "hide_image_until_date",
    "RICS Color": "rics_color",
    "RICS Short Description": "rics_short_desc",
    "RICS Long Desc": "rics_long_desc",
    "RICS Category": "rics_category",
    "Store Inv": "inventory_store",
    "Warehouse Inv": "inventory_warehouse",
    "WHS inv": "inventory_whs",
    Website: "site_owner",
    Height: "height",
    Width: "width",
    Length: "length",
    Weight: "weight",
    "Product.Sole Material.Name": "sole_material",
    "Product.Cut Type.Name": "cut_type",
    "Heel Height": "heel_height",
    "Heel Type": "heel_type",
    "Web Regular Price": "scom",
    "Web Sale Price": "scom_sale",
    "Retail Price": "rics_retail",
    "Retail Sale Price": "rics_offer",
};
exports.BOOLEAN_ATTRIBUTES = new Set([
    "is_map_protected",
    "is_hype",
    "is_fast_fashion",
    "is_new_collection",
]);
exports.NUMERIC_ATTRIBUTES = new Set([
    "inventory_store",
    "inventory_warehouse",
    "inventory_whs",
    "height",
    "width",
    "length",
    "weight",
    "heel_height",
    "scom",
    "scom_sale",
    "rics_retail",
    "rics_offer",
]);
function coerceValue(key, raw) {
    const v = (raw ?? "").toString().trim();
    if (v === "")
        return "";
    if (exports.BOOLEAN_ATTRIBUTES.has(key)) {
        const low = v.toLowerCase();
        if (["yes", "true", "1", "y"].includes(low))
            return true;
        if (["no", "false", "0", "n"].includes(low))
            return false;
        return v; // unexpected token — keep raw
    }
    if (exports.NUMERIC_ATTRIBUTES.has(key)) {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return v;
}
/**
 * Applies the complete column map + RICS parser to a CSV row, returning
 * the set of canonical attributes to write. The caller is responsible for
 * Human-Verified skipping and Firestore writes.
 */
function mapFullProductRow(row) {
    const attributes = {};
    for (const [csvCol, key] of Object.entries(exports.FULL_PRODUCT_ROW_MAP)) {
        if (Object.prototype.hasOwnProperty.call(row, csvCol)) {
            attributes[key] = coerceValue(key, row[csvCol] || "");
        }
    }
    // Gender: normalize from CSV Group
    if (attributes.gender_raw) {
        attributes.gender = normalizeGender(String(attributes.gender_raw));
    }
    // Department: CSV Department → canonical field
    if (attributes.department_raw) {
        attributes.department = String(attributes.department_raw).trim();
    }
    // RICS parser fills any gaps
    const ricsParsed = parseRicsCategory(String(attributes.rics_category || ""));
    for (const ricsKey of ["gender", "department", "class", "category", "age_group_detail"]) {
        const current = attributes[ricsKey];
        if ((current === undefined || current === "" || current === null) && ricsParsed[ricsKey]) {
            attributes[ricsKey] = ricsParsed[ricsKey];
        }
    }
    // Color normalization (fill descriptive_color if blank)
    if ((!attributes.descriptive_color || attributes.descriptive_color === "") && attributes.rics_color) {
        attributes.descriptive_color = normalizeColor(String(attributes.rics_color));
    }
    // Name resolution
    const { name, source } = resolveProductName(String(attributes.name || ""), String(attributes.rics_short_desc || ""));
    attributes.name = name;
    // Nike industry MPN
    const industryMpn = getNikeIndustryMpn(String(attributes.mpn || ""), String(attributes.brand || ""));
    if (industryMpn)
        attributes.rics_industry_mpn = industryMpn;
    // Top-level stamps for Firestore query performance
    const top_level = {};
    for (const k of [
        "department",
        "gender",
        "class",
        "category",
        "age_group_detail",
        "brand",
        "mpn",
        "sku",
        "name",
        "rics_industry_mpn",
    ]) {
        if (attributes[k] !== undefined && attributes[k] !== "")
            top_level[k] = attributes[k];
    }
    return {
        attributes,
        top_level,
        name_source: source,
        rics_parsed: ricsParsed,
        rics_industry_mpn: industryMpn,
    };
}
//# sourceMappingURL=ricsParser.js.map