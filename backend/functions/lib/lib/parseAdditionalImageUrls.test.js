"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for parseAdditionalImageUrls.
 *
 * Run: cd backend/functions && npx tsc && node lib/lib/parseAdditionalImageUrls.test.js
 * Or:  cd backend/functions && npx ts-node src/lib/parseAdditionalImageUrls.test.ts
 */
const parseAdditionalImageUrls_1 = require("./parseAdditionalImageUrls");
let passed = 0;
let failed = 0;
function assert(label, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        console.log(`  ✓ ${label}`);
        passed++;
    }
    else {
        console.error(`  ✗ ${label}`);
        console.error(`    expected: ${e}`);
        console.error(`    actual:   ${a}`);
        failed++;
    }
}
console.log("parseAdditionalImageUrls()");
// Null / undefined / empty
assert("null → []", (0, parseAdditionalImageUrls_1.parseAdditionalImageUrls)(null), []);
assert("undefined → []", (0, parseAdditionalImageUrls_1.parseAdditionalImageUrls)(undefined), []);
assert("empty string → []", (0, parseAdditionalImageUrls_1.parseAdditionalImageUrls)(""), []);
// Single URL
assert("single URL", (0, parseAdditionalImageUrls_1.parseAdditionalImageUrls)("https://example.com/img1.jpg"), ["https://example.com/img1.jpg"]);
// Multi URL
assert("multi URL", (0, parseAdditionalImageUrls_1.parseAdditionalImageUrls)("https://example.com/a.jpg,https://example.com/b.jpg,https://example.com/c.jpg"), [
    "https://example.com/a.jpg",
    "https://example.com/b.jpg",
    "https://example.com/c.jpg",
]);
// Trailing comma
assert("trailing comma", (0, parseAdditionalImageUrls_1.parseAdditionalImageUrls)("https://example.com/a.jpg,https://example.com/b.jpg,"), ["https://example.com/a.jpg", "https://example.com/b.jpg"]);
// Internal double commas
assert("internal double commas", (0, parseAdditionalImageUrls_1.parseAdditionalImageUrls)("https://example.com/a.jpg,,https://example.com/b.jpg"), ["https://example.com/a.jpg", "https://example.com/b.jpg"]);
// Whitespace around commas
assert("whitespace around commas", (0, parseAdditionalImageUrls_1.parseAdditionalImageUrls)("  https://example.com/a.jpg , https://example.com/b.jpg  "), ["https://example.com/a.jpg", "https://example.com/b.jpg"]);
// Whitespace-only string
assert("whitespace-only → []", (0, parseAdditionalImageUrls_1.parseAdditionalImageUrls)("   "), []);
// Leading comma
assert("leading comma", (0, parseAdditionalImageUrls_1.parseAdditionalImageUrls)(",https://example.com/a.jpg"), ["https://example.com/a.jpg"]);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0)
    process.exit(1);
//# sourceMappingURL=parseAdditionalImageUrls.test.js.map