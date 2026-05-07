/**
 * Active registry authority — shared lib lift from adminUsers.ts.
 * Mirrors lib/brandRegistry.ts pattern. Used by:
 *   - admin user portfolio validator (adminUsers.ts)
 *   - future engine consumers (Track 2+)
 */
import admin from "firebase-admin";

export interface ActiveRegistryAuthority {
  brand: Set<string>;
  department: Set<string>;
  site: Set<string>;
  class: Set<string>;
  age_group: Set<string>;
  gender: Set<string>;
}

export async function loadRegistryAuthority(): Promise<ActiveRegistryAuthority> {
  const fs = admin.firestore();
  const [brandSnap, deptSnap, siteSnap, classDoc, ageDoc, genderDoc] = await Promise.all([
    fs.collection("brand_registry").where("is_active", "==", true).get(),
    fs.collection("department_registry").where("is_active", "==", true).get(),
    fs.collection("site_registry").where("is_active", "==", true).get(),
    fs.collection("attribute_registry").doc("class").get(),
    fs.collection("attribute_registry").doc("age_group").get(),
    fs.collection("attribute_registry").doc("gender").get(),
  ]);
  const classOpts = ((classDoc.data() || {}).dropdown_options || []) as string[];
  const ageOpts = ((ageDoc.data() || {}).dropdown_options || []) as string[];
  const genderOpts = ((genderDoc.data() || {}).dropdown_options || []) as string[];
  return {
    brand: new Set(brandSnap.docs.map((d) => d.id)),
    department: new Set(deptSnap.docs.map((d) => d.id)),
    site: new Set(siteSnap.docs.map((d) => d.id)),
    class: new Set(classOpts),
    age_group: new Set(ageOpts),
    gender: new Set(genderOpts),
  };
}
