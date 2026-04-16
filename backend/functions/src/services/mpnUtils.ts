/**
 * MPN ↔ Firestore Document ID sanitization.
 * Firestore document IDs cannot contain forward slashes.
 * The original MPN is preserved in products/{docId}.mpn.
 */

export function mpnToDocId(mpn: string): string {
  return mpn.replace(/\//g, "__");
}

export function docIdToMpn(docId: string): string {
  return docId.replace(/__/g, "/");
}
