require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://buyme.co.il/'
};

async function fetchAllCategoryIds() {
  try {
    const res = await fetch('https://buyme.co.il/siteapi/categories', { headers: HEADERS });
    if (!res.ok) return [10, 687];
    const data = await res.json();
    const categories = data.categories || data.data || data.items || [];
    const ids = categories.map(c => c.id).filter(Boolean);
    return ids.length > 0 ? ids : [10, 687];
  } catch (e) {
    return [10, 687];
  }
}

async function fetchCategoryPage(categoryId, page = 1) {
  const url = `https://buyme.co.il/siteapi/category/${categoryId}?page=${page}&per_page=100`;
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) return [];
  const payload = await response.json();
  return payload.suppliers || payload.items || payload.data || payload.cards || payload.packages || [];
}

async function syncAllBuyMeData() {
  const runTimestamp = new Date().toISOString();
  console.log(`🔄 מתחיל סנכרון מקיף [תאריך: ${runTimestamp}]...`);

  const categoryIds = await fetchAllCategoryIds();
  console.log(`📋 קטגוריות לסריקה: ${categoryIds.join(', ')}`);

  const { data: club, error: clubErr } = await supabase
    .from('global_clubs')
    .upsert(
      { club_key: 'buyme', display_name: 'BuyMe All', club_type: 'voucher_platform', is_test: false },
      { onConflict: 'club_key' }
    )
    .select('id')
    .single();

  if (clubErr) {
    console.error('❌ שגיאה בטבלת מועדונים:', clubErr.message);
    return;
  }

  let activeCount = 0;

  for (const catId of categoryIds) {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const items = await fetchCategoryPage(catId, page);
      if (!items || items.length === 0) {
        hasMore = false;
        break;
      }

      const rulesToInsert = items
        .map(item => ({
          club_id: club.id,
          brand_name: item.name || item.title || item.supplier_name || item.brand_name,
          discount_percentage: Number(item.discount || item.discount_rate || item.cashback || 10),
          priority_order: 1,
          stacks_with_sales: true,
          special_notes: `תו BuyMe דיגיטלי (קטגוריה ${catId})`,
          is_active: true,
          last_synced_at: runTimestamp,
          valid_to: null,
          is_test: false
        }))
        .filter(r => r.brand_name && r.brand_name.length > 1);

      if (rulesToInsert.length > 0) {
        const { error: rulesErr } = await supabase
          .from('club_brand_rules')
          .upsert(rulesToInsert, { onConflict: 'club_id,brand_name' });

        if (!rulesErr) {
          activeCount += rulesToInsert.length;
        }
      }

      if (items.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }

  // ⚡ SOFT DELETE: כיבוי מותגים שלא נראו בריצה הנוכחית ותיעוד שעת הביטול
  console.log('🧹 מעדכן מותגים שהתבטלו/הוסרו מהאתר...');
  const { data: deactivated, error: deactErr } = await supabase
    .from('club_brand_rules')
    .update({ 
      is_active: false, 
      valid_to: runTimestamp 
    })
    .eq('club_id', club.id)
    .lt('last_synced_at', runTimestamp)
    .eq('is_active', true)
    .select('brand_name');

  if (deactErr) {
    console.error('❌ שגיאה בכיבוי מותגים מבוטלים:', deactErr.message);
  } else {
    console.log(`⚠️ הושבתו ${deactivated?.length || 0} מותגים שכבר אינם קיימים באתר.`);
  }

  console.log(`🎉 סנכרון הושלם! ${activeCount} מותגים פעילים מעודכנים ב-DB.`);
}

syncAllBuyMeData();