const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('/tmp/sa-key-deploy.json')) });
const db = admin.firestore();
const { v4: uuidv4 } = require('uuid');

async function seedRules() {
  const emailToUid = {};
  const usersSnap = await db.collection('users').get();
  usersSnap.forEach(d => { emailToUid[d.data().email] = d.id; });

  const heather = emailToUid['heather@shiekhshoes.com'];
  const mike    = emailToUid['mike@shiekhshoes.com'];
  const richard = emailToUid['richard@shiekhshoes.com'];
  const alex    = emailToUid['alex@shiekhshoes.com'];
  const alana   = emailToUid['alana@shiekhshoes.org'];

  const RULES = [
    { name: "Heather — Women's Footwear 45-Day Zero Sales", owner: heather,
      filters: [
        { field: 'department', operator: 'equals', value: 'Footwear', case_sensitive: true, logic: 'AND' },
        { field: 'gender', operator: 'equals', value: 'Womens', case_sensitive: true, logic: 'AND' }
      ]},
    { name: "Heather — Girls' Footwear 45-Day Zero Sales", owner: heather,
      filters: [
        { field: 'department', operator: 'equals', value: 'Footwear', case_sensitive: true, logic: 'AND' },
        { field: 'gender', operator: 'equals', value: 'Girls', case_sensitive: true, logic: 'AND' }
      ]},
    { name: "Heather — Women's Clothing 45-Day Zero Sales", owner: heather,
      filters: [
        { field: 'department', operator: 'equals', value: 'Clothing', case_sensitive: true, logic: 'AND' },
        { field: 'gender', operator: 'equals', value: 'Womens', case_sensitive: true, logic: 'AND' }
      ]},
    { name: "Alex — Men's Footwear 45-Day Zero Sales", owner: alex,
      filters: [
        { field: 'department', operator: 'equals', value: 'Footwear', case_sensitive: true, logic: 'AND' },
        { field: 'gender', operator: 'equals', value: 'Mens', case_sensitive: true, logic: 'AND' }
      ]},
    { name: "Alex — Boys' Footwear 45-Day Zero Sales", owner: alex,
      filters: [
        { field: 'department', operator: 'equals', value: 'Footwear', case_sensitive: true, logic: 'AND' },
        { field: 'gender', operator: 'equals', value: 'Boys', case_sensitive: true, logic: 'AND' }
      ]},
    { name: "Alex — Toddler Footwear 45-Day Zero Sales", owner: alex,
      filters: [
        { field: 'department', operator: 'equals', value: 'Footwear', case_sensitive: true, logic: 'AND' },
        { field: 'gender', operator: 'equals', value: 'Toddler', case_sensitive: true, logic: 'AND' }
      ]},
    { name: "Richard — Men's Clothing 45-Day Zero Sales", owner: richard,
      filters: [
        { field: 'department', operator: 'equals', value: 'Clothing', case_sensitive: true, logic: 'AND' },
        { field: 'gender', operator: 'equals', value: 'Mens', case_sensitive: true, logic: 'AND' }
      ]},
    { name: "Mike — Accessories 45-Day Zero Sales", owner: mike,
      filters: [
        { field: 'department', operator: 'equals', value: 'Accessories', case_sensitive: true, logic: 'AND' }
      ]},
    { name: "Alana — MLTD Footwear 45-Day Zero Sales", owner: alana,
      filters: [
        { field: 'site_owner', operator: 'equals', value: 'mltd', case_sensitive: false, logic: 'AND' },
        { field: 'department', operator: 'equals', value: 'Footwear', case_sensitive: true, logic: 'AND' }
      ]},
    { name: "Alana — MLTD Clothing 45-Day Zero Sales", owner: alana,
      filters: [
        { field: 'site_owner', operator: 'equals', value: 'mltd', case_sensitive: false, logic: 'AND' },
        { field: 'department', operator: 'equals', value: 'Clothing', case_sensitive: true, logic: 'AND' }
      ]},
    { name: "Alana — MLTD Accessories 45-Day Zero Sales", owner: alana,
      filters: [
        { field: 'site_owner', operator: 'equals', value: 'mltd', case_sensitive: false, logic: 'AND' },
        { field: 'department', operator: 'equals', value: 'Accessories', case_sensitive: true, logic: 'AND' }
      ]}
  ];

  const TRIGGER = [
    { field: 'product_age_days', operator: 'greater_than', value: 45, logic: 'AND' },
    { field: 'str_pct', operator: 'less_than', value: 1, logic: 'AND' }
  ];
  const STEPS = [{
    step_number: 1, day_threshold: 45,
    action_type: 'markdown_pct', markdown_scope: 'store_only',
    value: 20, apply_99_rounding: true
  }];

  for (const rule of RULES) {
    if (!rule.owner) {
      console.log(`SKIPPED (owner not found): ${rule.name}`);
      continue;
    }
    const ruleId = uuidv4();
    await db.collection('cadence_rules').doc(ruleId).set({
      rule_id: ruleId, rule_name: rule.name,
      version: 1, is_active: true, priority: 10,
      owner_buyer_id: rule.owner,
      target_filters: rule.filters,
      trigger_conditions: TRIGGER,
      markdown_steps: STEPS,
      created_by: 'seed',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`CREATED: ${rule.name}`);
  }

  console.log('\n✅ 11 cadence rules seeded.');
  process.exit(0);
}
seedRules().catch(e => { console.error(e); process.exit(1); });
