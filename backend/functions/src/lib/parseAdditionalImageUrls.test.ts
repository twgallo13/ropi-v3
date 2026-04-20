/**
 * Unit tests for parseAdditionalImageUrls.
 *
 * Run: cd backend/functions && npx tsc && node lib/lib/parseAdditionalImageUrls.test.js
 * Or:  cd backend/functions && npx ts-node src/lib/parseAdditionalImageUrls.test.ts
 */
import { parseAdditionalImageUrls } from "./parseAdditionalImageUrls";

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
    failed++;
  }
}

console.log("parseAdditionalImageUrls()");

// Null / undefined / empty
assert("null → []", parseAdditionalImageUrls(null), []);
assert("undefined → []", parseAdditionalImageUrls(undefined), []);
assert("empty string → []", parseAdditionalImageUrls(""), []);

// Single URL
assert(
  "single URL",
  parseAdditionalImageUrls("https://example.com/img1.jpg"),
  ["https://example.com/img1.jpg"],
);

// Multi URL
assert(
  "multi URL",
  parseAdditionalImageUrls(
    "https://example.com/a.jpg,https://example.com/b.jpg,https://example.com/c.jpg",
  ),
  [
    "https://example.com/a.jpg",
    "https://example.com/b.jpg",
    "https://example.com/c.jpg",
  ],
);

// Trailing comma
assert(
  "trailing comma",
  parseAdditionalImageUrls("https://example.com/a.jpg,https://example.com/b.jpg,"),
  ["https://example.com/a.jpg", "https://example.com/b.jpg"],
);

// Internal double commas
assert(
  "internal double commas",
  parseAdditionalImageUrls("https://example.com/a.jpg,,https://example.com/b.jpg"),
  ["https://example.com/a.jpg", "https://example.com/b.jpg"],
);

// Whitespace around commas
assert(
  "whitespace around commas",
  parseAdditionalImageUrls("  https://example.com/a.jpg , https://example.com/b.jpg  "),
  ["https://example.com/a.jpg", "https://example.com/b.jpg"],
);

// Whitespace-only string
assert("whitespace-only → []", parseAdditionalImageUrls("   "), []);

// Leading comma
assert(
  "leading comma",
  parseAdditionalImageUrls(",https://example.com/a.jpg"),
  ["https://example.com/a.jpg"],
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
