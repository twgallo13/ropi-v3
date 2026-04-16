"use strict";
/**
 * MPN ↔ Firestore Document ID sanitization.
 * Firestore document IDs cannot contain forward slashes.
 * The original MPN is preserved in products/{docId}.mpn.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mpnToDocId = mpnToDocId;
exports.docIdToMpn = docIdToMpn;
function mpnToDocId(mpn) {
    return mpn.replace(/\//g, "__");
}
function docIdToMpn(docId) {
    return docId.replace(/__/g, "/");
}
//# sourceMappingURL=mpnUtils.js.map