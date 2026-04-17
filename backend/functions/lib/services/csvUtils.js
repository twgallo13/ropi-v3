"use strict";
/**
 * CSV parsing utilities shared across import routes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractHeaders = extractHeaders;
/**
 * Safely extract a flat string[] of column headers from csv-parse output.
 * Handles both array-of-arrays (columns: false) and array-of-objects (columns: true).
 */
function extractHeaders(parsed) {
    if (!parsed || parsed.length === 0)
        return [];
    const first = parsed[0];
    if (Array.isArray(first)) {
        // csv-parse returned array-of-arrays — first row is the header row
        return first.flat().map(String);
    }
    // csv-parse returned array-of-objects — keys are the headers
    return Object.keys(first).map(String);
}
//# sourceMappingURL=csvUtils.js.map