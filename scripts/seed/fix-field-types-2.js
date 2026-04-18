const admin = require('firebase-admin');
const { initApp } = require('./utils');
initApp();
const db = admin.firestore();

(async () => {
  const updates = [
    // Fast Fashion — must be boolean/toggle not text
    {
      id: 'is_fast_fashion',
      field_type: 'toggle',
      display_label: 'Fast Fashion',
      destination_tab: 'product_attributes',
      display_group: 'Fast Fashion',
      tab_group_order: 3
    },
    // Product Is Active — remove from all tabs, system-managed only
    {
      id: 'product_is_active',
      destination_tab: null,
      display_group: null,
      is_editable: false,
      is_required: false,
      required_for_completion: false
    },
    // Media Status — remove from tabs, system indicator only
    {
      id: 'media_status',
      destination_tab: null,
      display_group: null,
      is_editable: false,
      is_required: false,
      required_for_completion: false
    },
    // Image Status — same
    {
      id: 'image_status',
      destination_tab: null,
      display_group: null,
      is_editable: false,
      is_required: false,
      required_for_completion: false
    },
    // Website — confirm multi_select
    {
      id: 'website',
      field_type: 'multi_select',
      display_label: 'Active Websites',
      dropdown_options: ['Shiekh', 'Karmaloop', 'MLTD', 'Sangre Mia'],
      destination_tab: 'core_information',
      display_group: 'Visibility',
      is_required: true,
      required_for_completion: true
    },
    // Collection Name — expanded dropdown
    {
      id: 'collection_name',
      field_type: 'dropdown',
      display_label: 'Collection Name',
      dropdown_options: [
        'Air Jordan', 'Nike SB', 'Nike Air Max', 'Nike Air Force 1',
        'Yeezy', 'Adidas Originals', 'Adidas Ultraboost',
        'New Balance 990', 'New Balance 550',
        'UGG Classic', 'UGG Ultra Mini',
        'Timberland 6-Inch', 'Timberland Premium',
        'Converse Chuck Taylor', 'Converse Run Star',
        'Vans Old Skool', 'Vans Sk8-Hi',
        'Birkenstock Boston', 'Birkenstock Arizona',
        'Crocs Classic', 'Hey Dude Wally',
        'Puma Suede', 'Reebok Classic',
        'FILA Disruptor', 'Skechers D\'Lites',
        'Steve Madden Irenee',
        'Other'
      ]
    },
    // League — fix label casing
    { id: 'league', display_label: 'League' },
    // Fix any remaining snake_case labels
    { id: 'sports_team', display_label: 'Sports Team' },
    { id: 'is_hype',     display_label: 'HYPE' },
  ];

  for (const update of updates) {
    const { id, ...fields } = update;
    const ref = db.collection('attribute_registry').doc(id);
    if ((await ref.get()).exists) {
      await ref.set(fields, { merge: true });
      console.log(`✅ Updated: ${id}`);
    } else {
      console.log(`ℹ️  Not found: ${id}`);
    }
  }

  console.log('\nDone.');
  process.exit(0);
})();
