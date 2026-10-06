# Taxonomy planning workbook v1.4

- Version: **v1.4**
- Date: **2026-10-06**
- Dataset SHA-256: `64c10b840f2cc4af76dc243d793f5f71e5f40222b55188792a5c1dfb14263cf4`
- **Planning data only; not app configuration. Implementation remains HOLD.**
- [Notion 3F — Cleaned taxonomy and draft map review](https://app.notion.com/p/3f145ee1ec5a8138b609fb85f7f751a4) explains the workbook and verification.
- [ROPI Recovery — START HERE](https://app.notion.com/p/3f045ee1ec5a81738d2aedf1b1c314ef) governs current status and next actions. The Notion blueprint governs approvals; committing these documents does not authorize implementation.

This folder is the permanent repository location for the review workbook and its CSV exports. `ROPI_Taxonomy_Maps_Draft_v1.4.xlsx` is a byte-for-byte copy of the verified v1.4 workbook, including the corrected 3A reference link. No taxonomy or map values were changed for publication.

The dataset hash above identifies the reviewed planning dataset; it is not the XLSX file hash. Workbook SHA-256: `dde766ac45ca78394154be31674d30464084294bcb85b97b2b07481851c36724`.

## Tab exports

Each CSV contains the tab header and every data row, in workbook order, using UTF-8 and standard CSV quoting. Blank cells remain blank. Workbook formulas that refer to other cells are resolved to their values in CSVs; the original formulas remain unchanged in the XLSX. CSVs are derived review copies, not a second mapping authority or runtime seed files.

| Workbook tab | CSV | Data rows |
|---|---|---:|
| Read me | [read-me.csv](read-me.csv) | 22 |
| Cleaned list | [hierarchy.csv](hierarchy.csv) | 270 |
| Import map | [import-map.csv](import-map.csv) | 814 |
| Website fill map | [website-fill-map.csv](website-fill-map.csv) | 270 |
| PO coverage decisions | [po-coverage-decisions.csv](po-coverage-decisions.csv) | 76 |
| Uncertain rows | [uncertain-rows.csv](uncertain-rows.csv) | 643 |
| Old source | [old-source.csv](old-source.csv) | 814 |
| Cleanup trace | [cleanup-trace.csv](cleanup-trace.csv) | 312 |
| Sources | [sources.csv](sources.csv) | 11 |
| PO added paths | [po-added-paths.csv](po-added-paths.csv) | 13 |

## Review boundaries

The hierarchy has 270 paths. The 814 import-map rows comprise 33 PO-approved mappings, 144 supported drafts, 594 review rows, and 43 rows explicitly decided unmapped pending broad-label policy. All 76 list-coverage decision rows stay outside the product-detail work pile.

The 270 website-fill rows comprise 12 previously PO-approved outputs, 209 supported drafts, and 49 review rows. Of the thirteen added paths, twelve have draft website targets; Shoe Charms (T264) has no selected legacy target and remains under review.

Map changes never automatically refill existing products. Human corrections, primary detail and overrides remain protected under the governing blueprint. Draft map relations do not constitute approval by outside websites or reports.
