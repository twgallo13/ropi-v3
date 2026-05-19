"use strict";

const { parse } = require("csv-parse/sync");

const CANONICAL_TAXONOMY_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRFxrDw7Db1BbVsG3U4VQ_-Y-axnHVy3Vi1PXK45__qniEaM_dM3leOHlvOBvCrlU6eBvEaUobAdwWw/pub?gid=762634304&single=true&output=csv";
const SHEET_NAME = "Attribute Dropdown Options with Headers";
const SHEET_GID = "762634304";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stableKey(parts) {
  return parts.map((p) => clean(p)).join("||");
}

function sortStrings(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

async function fetchCanonicalTaxonomy(url = CANONICAL_TAXONOMY_URL) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Canonical taxonomy fetch failed: HTTP ${res.status}`);
  }

  const csv = await res.text();
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  const deduped = new Map();

  for (const record of records) {
    const row = {
      department: clean(record["Department"]),
      class: clean(record["Class"]),
      category: clean(record["Category"]),
      sub_category: clean(record["Sub-Category"]),
      combined_taxonomy: clean(record["Combined Taxonomy"]),
    };

    if (
      !row.department &&
      !row.class &&
      !row.category &&
      !row.sub_category &&
      !row.combined_taxonomy
    ) {
      continue;
    }

    if (!row.combined_taxonomy) {
      row.combined_taxonomy = [
        row.department,
        row.class,
        row.category,
        row.sub_category,
      ]
        .filter(Boolean)
        .join(" > ");
    }

    deduped.set(
      stableKey([
        row.department,
        row.class,
        row.category,
        row.sub_category,
        row.combined_taxonomy,
      ]),
      row
    );
  }

  const rows = [...deduped.values()];
  const departments = sortStrings(new Set(rows.map((r) => r.department).filter(Boolean)));
  const classes = sortStrings(new Set(rows.map((r) => r.class).filter(Boolean)));
  const categories = sortStrings(new Set(rows.map((r) => r.category).filter(Boolean)));
  const sub_categories = sortStrings(new Set(rows.map((r) => r.sub_category).filter(Boolean)));
  const combined_taxonomies = sortStrings(
    new Set(rows.map((r) => r.combined_taxonomy).filter(Boolean))
  );

  const byTriplet = {};
  for (const row of rows) {
    const triplet = stableKey([row.department, row.class, row.category]);
    if (!byTriplet[triplet]) byTriplet[triplet] = [];
    if (row.sub_category && !byTriplet[triplet].includes(row.sub_category)) {
      byTriplet[triplet].push(row.sub_category);
    }
  }
  for (const key of Object.keys(byTriplet)) {
    byTriplet[key].sort((a, b) => a.localeCompare(b));
  }

  return {
    source: {
      url,
      sheet_name: SHEET_NAME,
      gid: SHEET_GID,
    },
    rows,
    departments,
    classes,
    categories,
    sub_categories,
    combined_taxonomies,
    by_triplet: byTriplet,
    counts: {
      rows: rows.length,
      departments: departments.length,
      classes: classes.length,
      categories: categories.length,
      sub_categories: sub_categories.length,
      combined_taxonomies: combined_taxonomies.length,
    },
  };
}

module.exports = {
  CANONICAL_TAXONOMY_URL,
  SHEET_NAME,
  SHEET_GID,
  fetchCanonicalTaxonomy,
  stableKey,
  clean,
};
