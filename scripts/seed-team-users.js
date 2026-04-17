const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('/tmp/sa-key-deploy.json')) });
const db = admin.firestore();
const auth = admin.auth();

const TEAM = [
  // Buyers
  { email: 'heather@shiekhshoes.com', display_name: 'Heather', role: 'buyer',
    departments: ['Footwear','Clothing','Accessories'], gender_scope: ['Womens','Girls'] },
  { email: 'mike@shiekhshoes.com', display_name: 'Mike', role: 'head_buyer',
    departments: ['Accessories'], gender_scope: null },
  { email: 'richard@shiekhshoes.com', display_name: 'Richard', role: 'buyer',
    departments: ['Clothing'], gender_scope: ['Mens','Boys'] },
  { email: 'alex@shiekhshoes.com', display_name: 'Alex', role: 'buyer',
    departments: ['Footwear'], gender_scope: ['Mens','Boys','Girls','Toddler'] },
  { email: 'alana@shiekhshoes.org', display_name: 'Alana', role: 'buyer',
    departments: ['Footwear','Clothing','Accessories'], gender_scope: null, site_scope: ['mltd'] },
  // Product Ops
  { email: 'anahi@shiekhshoes.org', display_name: 'Anahi', role: 'product_ops',
    departments: null, gender_scope: null },
  { email: 'vanessabautista@shiekhshoes.org', display_name: 'Vanessa', role: 'product_ops',
    departments: null, gender_scope: null },
  // MAP Analyst
  { email: 'mykhailo@shiekhshoes.org', display_name: 'Mykhailo', role: 'map_analyst',
    departments: null, gender_scope: null },
  // Admin
  { email: 'theo@shiekh.com', display_name: 'Theo', role: 'admin',
    departments: null, gender_scope: null },
  // Owner
  { email: 'shiekh@shiekhshoes.com', display_name: 'Shiekh', role: 'owner',
    departments: null, gender_scope: null }
];

(async () => {
  for (const user of TEAM) {
    let authUser;
    try {
      authUser = await auth.getUserByEmail(user.email);
      console.log(`EXISTS: ${user.email} (${authUser.uid})`);
    } catch {
      const tempPassword = `${user.display_name}@RopiV3`;
      authUser = await auth.createUser({
        email: user.email,
        password: tempPassword,
        displayName: user.display_name
      });
      console.log(`CREATED: ${user.email} (${authUser.uid})`);
    }

    await auth.setCustomUserClaims(authUser.uid, { role: user.role });

    await db.collection('users').doc(authUser.uid).set({
      uid: authUser.uid,
      email: user.email,
      display_name: user.display_name,
      role: user.role,
      departments: user.departments || null,
      gender_scope: user.gender_scope || null,
      site_scope: user.site_scope || null,
      requires_review: false,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`  → users/${authUser.uid} (role: ${user.role})`);
  }
  console.log('\n✅ All team users seeded. Temp password: {Name}@RopiV3');
  process.exit(0);
})();
