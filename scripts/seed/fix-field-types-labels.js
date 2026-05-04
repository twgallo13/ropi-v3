const admin = require('firebase-admin');
const { initApp } = require('./utils');
initApp();
const db = admin.firestore();

(async () => {
  const updates = [
    // Website — multi-select from site_registry
    {
      id: 'website',
      field_type: 'multi_select',
      display_label: 'Active Websites',
      dropdown_options: ['Shiekh', 'Karmaloop', 'MLTD', 'Sangre Mia']
    },
    // Collection Name — select dropdown
    {
      id: 'collection_name',
      field_type: 'dropdown',
      display_label: 'Collection Name',
      dropdown_options: [
        'Air Jordan', 'Yeezy', 'New Balance 990',
        'UGG Classic', 'Timberland 6-Inch',
        'Nike Air Force 1', 'Adidas Originals',
        'Converse Chuck Taylor', 'Vans Old Skool',
        'Other'
      ]
    },
    // Label cleanups — snake_case → human readable
    { id: 'material_fabric',    display_label: 'Material / Fabric' },
    { id: 'cut_type',           display_label: 'Cut Type' },
    { id: 'closure_type',       display_label: 'Closure Type' },
    { id: 'heel_height',        display_label: 'Heel Height' },
    { id: 'heel_type',          display_label: 'Heel Type' },
    { id: 'toe_shape',          display_label: 'Toe Shape' },
    { id: 'shoe_height_map',    display_label: 'Shoe Height' },
    { id: 'platform_height',    display_label: 'Platform Height' },
    { id: 'sports_team',        display_label: 'Sports Team' },
    { id: 'is_fast_fashion',    display_label: 'Fast Fashion' },
    { id: 'age_group',          display_label: 'Age Group' },
    { id: 'primary_color',      display_label: 'Primary Color' },
    { id: 'descriptive_color',  display_label: 'Descriptive Color' },
    { id: 'is_hype',            display_label: 'HYPE' },
    { id: 'sku',                display_label: 'SKU' },
    { id: 'style_id',           display_label: 'Style ID' },
    { id: 'tax_class',          display_label: 'Tax Class' },
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

  // ── Remove product_is_active, media_status, image_status from editable tabs ──
  for (const field of ['product_is_active', 'media_status', 'image_status']) {
    await db.collection('attribute_registry').doc(field).set({
      destination_tab: null,
      display_group: null,
      is_editable: false,
      is_required: false
    }, { merge: true });
    console.log(`✅ Removed from tabs: ${field}`);
  }

  // ── Launch & Media group consolidation ──
  const LAUNCH_MEDIA_GROUP = [
    { key: 'map',                    group: 'Launch Bundle', order: 1, tab_group_order: 1 },
    { key: 'is_hype',                group: 'Launch Bundle', order: 2, tab_group_order: 1 },
    { key: 'launch_date',            group: 'Launch Bundle', order: 3, tab_group_order: 1 },
    { key: 'standard_shipping_override', group: 'Launch Bundle', order: 4, tab_group_order: 1 },
    { key: 'expedited_shipping_override', group: 'Launch Bundle', order: 5, tab_group_order: 1 },
    { key: 'drawing_fcfs',           group: 'Launch Configuration', order: 1, tab_group_order: 2 },
    { key: 'hide_image_until_date',  group: 'Launch Configuration', order: 2, tab_group_order: 2 },
  ];

  for (const entry of LAUNCH_MEDIA_GROUP) {
    await db.collection('attribute_registry').doc(entry.key).set({
      destination_tab: 'launch_media',
      display_group: entry.group,
      display_order: entry.order,
      tab_group_order: entry.tab_group_order
    }, { merge: true });
    console.log(`✅ Launch/Media layout: ${entry.key} → ${entry.group}`);
  }

  // ── Fast Fashion depends_on + required_for_completion (TALLY-3.8-C C2) ──
  const CONDITIONAL = ['heel_height', 'platform_height', 'heel_type', 'toe_shape', 'shoe_height_map'];
  for (const field of CONDITIONAL) {
    await db.collection('attribute_registry').doc(field).set({
      depends_on: { field: 'is_fast_fashion', value: 'true' },
      required_for_completion: true,
    }, { merge: true });
    console.log(`✅ depends_on + required_for_completion set: ${field}`);
  }

  console.log('\nDone.');
  process.exit(0);
})();
