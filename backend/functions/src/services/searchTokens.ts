/**
 * search_tokens builder
 *
 * Firestore has no LIKE / CONTAINS operator, so to make text search work
 * with database-side filtering we stamp every product document with a
 * `search_tokens` array. Queries then use `array-contains` against that
 * array instead of in-memory string matching.
 *
 * For each input string we add:
 *   • the full lowercased value
 *   • each whitespace/dash/underscore/slash/dot-delimited word
 *   • every prefix from length 2 up to 20 characters
 *
 * Prefix tokens enable type-ahead matching ("ad" → "adidas", "hq7" →
 * "hq7468"). Capping at 20 keeps the array bounded.
 */

export interface SearchTokenInput {
  mpn?: string | null;
  name?: string | null;
  brand?: string | null;
  sku?: string | null;
  department?: string | null;
}

export function buildSearchTokens(product: SearchTokenInput): string[] {
  const tokens = new Set<string>();

  const addTokens = (value?: string | null) => {
    if (!value) return;
    const lower = String(value).toLowerCase().trim();
    if (!lower) return;
    tokens.add(lower);
    lower.split(/[\s\-_/.]+/).forEach((word) => {
      if (word.length >= 2) tokens.add(word);
    });
    for (let i = 2; i <= Math.min(lower.length, 20); i++) {
      tokens.add(lower.slice(0, i));
    }
  };

  addTokens(product.mpn);
  addTokens(product.name);
  addTokens(product.brand);
  addTokens(product.sku);
  addTokens(product.department);

  return Array.from(tokens);
}
