"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAdditionalImageUrls = parseAdditionalImageUrls;
/**
 * Parse additional_image_url CSV string into an array of trimmed URL strings.
 *
 * Per Phase 4.4 spec §9.2:
 *   • null / undefined / empty string → []
 *   • String → split on comma, trim each, filter out empty strings
 *   • No URL format validation (presence-only per §2.3)
 */
function parseAdditionalImageUrls(raw) {
    if (!raw || typeof raw !== "string")
        return [];
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
//# sourceMappingURL=parseAdditionalImageUrls.js.map