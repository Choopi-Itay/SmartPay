global.WebSocket = require('ws');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ חסרים משתני סביבה של Supabase!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- פונקציית עזר לכתיבה בטוחה ב-Batches + כיבוי הטבות שהוסרו (Soft Delete) ---
async function persistClubBenefits(clubKey, rows, runTimestamp) {
  if (rows.length === 0) return 0;

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase
      .from('club_benefits')
      .upsert(batch, { onConflict: 'club_source,external_id' });

    if (error) {
      throw new Error(`UPSERT failed for ${clubKey}: ${error.message}`);
    }
  }

  const { error: deactError } = await supabase
    .from('club_benefits')
    .update({ is_active: false })
    .eq('club_source', clubKey)
    .lt('updated_at', runTimestamp);

  if (deactError) {
    console.warn(`⚠️ אזהרה בכיבוי הטבות ישנות עבור ${clubKey}:`, deactError.message);
  }

  return rows.length;
}

// ============================================================================
// DRIVER 1: BuyMe API (קטלוג מלא של תווים ורשתות)
// ============================================================================
async function syncBuyMeDriver(club, runTimestamp) {
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://buyme.co.il/',
  };

  const catRes = await fetch('https://buyme.co.il/siteapi/categories', { headers: HEADERS });
  if (!catRes.ok) {
    throw new Error(`BuyMe categories endpoint returned HTTP ${catRes.status}`);
  }

  const catData = await catRes.json();
  const categories = catData.categories || catData.data || catData.items || [];
  const categoryIds = categories.map((c) => c.id).filter(Boolean);

  if (categoryIds.length === 0) {
    throw new Error('לא נמצאו קטגוריות פעילות ב-API של BuyMe');
  }

  const seenMap = new Map();

  for (const catId of categoryIds) {
    let page = 1;
    while (true) {
      const res = await fetch(
        `https://buyme.co.il/siteapi/category/${catId}?page=${page}&per_page=100`,
        { headers: HEADERS }
      );
      if (!res.ok) break;

      const payload = await res.json();
      const items =
        payload.suppliers || payload.items || payload.data || payload.cards || payload.packages || [];
      if (!items || items.length === 0) break;

      for (const item of items) {
        const brandName = (
          item.name ||
          item.title ||
          item.supplier_name ||
          item.brand_name ||
          ''
        ).trim();
        if (!brandName || brandName.length <= 1) continue;

        const discount = Number(item.discount || item.discount_rate || item.cashback || 10);
        const extId = `${club.club_key}_${item.id || brandName}`;
        const rawUrl = item.url || item.link || item.slug || '';
        const itemUrl = rawUrl
          ? rawUrl.startsWith('http')
            ? rawUrl
            : `https://buyme.co.il${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`
          : 'https://buyme.co.il/';

        seenMap.set(extId, {
          club_source: club.club_key,
          external_id: extId,
          title: brandName,
          supplier_name: brandName,
          benefit_type: 'wallet',
          discount_percent: discount,
          wallet_name: club.display_name,
          redim_type: 'תו דיגיטלי',
          terms_of_use: `תו BuyMe דיגיטלי (קטגוריה ${catId})`,
          logo_url: item.logo || item.image || null,
          url: itemUrl,
          is_active: true,
          updated_at: runTimestamp,
        });
      }

      if (items.length < 100) break;
      page++;
    }
  }

  return persistClubBenefits(club.club_key, Array.from(seenMap.values()), runTimestamp);
}

// ============================================================================
// רישום הדרייברים הפעילים (כאן יתווספו max_api, isracard_api, cal_api וכו')
// ============================================================================
const DRIVERS = {
  buyme_api: syncBuyMeDriver,
};

async function runFullSync() {
  const runTimestamp = new Date().toISOString();
  console.log(`🚀 מתחיל סנכרון API דטרמיניסטי [${runTimestamp}]...`);

  const { data: clubs, error } = await supabase
    .from('global_clubs')
    .select('*')
    .eq('auto_sync_enabled', true);

  if (error) {
    console.error('❌ שגיאה בשליפת מועדונים מ-Supabase:', error.message);
    process.exit(1);
  }

  if (!clubs || clubs.length === 0) {
    console.log('ℹ️ אין מועדונים עם auto_sync_enabled = true.');
    return;
  }

  for (const club of clubs) {
    const driver = DRIVERS[club.sync_strategy];
    if (!driver) {
      console.warn(`⚠️ לא נמצא דרייבר רשום עבור אסטרטגיה "${club.sync_strategy}" (${club.display_name})`);
      continue;
    }

    try {
      const syncedCount = await driver(club, runTimestamp);

      await supabase
        .from('global_clubs')
        .update({
          last_synced_at: runTimestamp,
          last_sync_status: syncedCount > 0 ? 'success' : 'empty',
          synced_items_count: syncedCount,
        })
        .eq('id', club.id);

      console.log(`✅ ${club.display_name} (${club.sync_strategy}): סונכרנו ${syncedCount} פריטים.`);
    } catch (err) {
      console.error(`❌ שגיאה בסנכרון ${club.display_name}:`, err.message);
      await supabase
        .from('global_clubs')
        .update({
          last_synced_at: runTimestamp,
          last_sync_status: `error: ${err.message.slice(0, 100)}`,
        })
        .eq('id', club.id);
    }
  }

  console.log('🎉 סנכרון ה-API הסתיים בהצלחה.');
}

runFullSync();