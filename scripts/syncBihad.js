global.WebSocket = require('ws');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ חסרים משתני סביבה Supabase!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// אנדפוינט ה-API הפומבי של ביחד בשבילך לשליפת קטלוג ההטבות
const BIHAD_CATALOG_API = 'https://www.bihad.co.il/api/benefits/catalog'; 

/**
 * חילוץ אחוז הנחה מתוך טקסט ההטבה (למשל: "15% הנחה בטעינה" -> 15.0)
 */
function extractDiscountPercentage(text) {
  if (!text) return 0;
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * קביעת סוג ההנחה דינמית לפי תיאור ההטבה
 */
function determineDiscountType(title, description) {
  const combined = `${title} ${description}`.toLowerCase();
  if (combined.includes('טעינה') || combined.includes('כרטיס נטען') || combined.includes('תו הנטען')) {
    return 'prepaid_card';
  }
  if (combined.includes('קופון') || combined.includes('שובר')) {
    return 'voucher';
  }
  return 'statement_credit';
}

async function fetchLiveBihadBenefits() {
  try {
    // שליפה דינמית מ-API הקטלוג של ביחד בשבילך
    const response = await fetch(BIHAD_CATALOG_API, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // מיפוי ה-JSON הדינמי מהאתר למבנה ה-DB שלנו
    const rawItems = data.items || data.benefits || data || [];
    
    return rawItems.map(item => {
      const brandName = item.supplierName || item.brandName || item.title || 'מותג ללא שם';
      const discountText = item.discountText || item.subtitle || item.title || '';
      const discountPercentage = extractDiscountPercentage(discountText);
      const discountType = determineDiscountType(item.title || '', discountText);

      return {
        brand_name: brandName.trim(),
        discount_percentage: discountPercentage,
        discount_type: discountType
      };
    }).filter(item => item.brand_name && item.discount_percentage > 0);

  } catch (err) {
    console.error('❌ שגיאה בשליפת נתונים חיים מביחד בשבילך:', err.message);
    return [];
  }
}

async function syncBihad() {
  const syncStartTime = new Date().toISOString();
  console.log(`🔄 מתחיל סנכרון חי "ביחד בשבילך" [${syncStartTime}]...`);

  // 1. שליפת ID של המועדון מ-global_clubs לפי club_key
  const { data: club, error: clubError } = await supabase
    .from('global_clubs')
    .select('id')
    .eq('club_key', 'bihad')
    .single();

  if (clubError || !club) {
    console.error('❌ מועדון "ביחד בשבילך" לא נמצא ב-global_clubs!', clubError?.message);
    process.exit(1);
  }

  const clubId = club.id;

  // 2. שליפה דינמית בזמן אמת מהאתר
  const liveRules = await fetchLiveBihadBenefits();
  console.log(`📋 נשלפו ${liveRules.length} הטבות דינמיות מביחד בשבילך.`);

  let upsertedCount = 0;

  // 3. עדכון ה-DB עם הנתונים הדינמיים
  for (const rule of liveRules) {
    const { error } = await supabase
      .from('club_brand_rules')
      .upsert({
        club_id: clubId,
        brand_name: rule.brand_name,
        discount_percentage: rule.discount_percentage,
        discount_type: rule.discount_type,
        is_active: true,
        last_synced_at: syncStartTime
      }, { onConflict: 'club_id, brand_name' });

    if (error) {
      console.error(`⚠️ שגיאה בעדכון ${rule.brand_name}:`, error.message);
    } else {
      upsertedCount++;
    }
  }

  // 4. Soft Delete – השבתת מותגים שהוסרו מהאתר ולא עודכנו בסבב הזה
  const { error: deactivateError } = await supabase
    .from('club_brand_rules')
    .update({ is_active: false })
    .eq('club_id', clubId)
    .lt('last_synced_at', syncStartTime);

  if (deactivateError) {
    console.error('⚠️ שגיאה בעדכון Soft Delete:', deactivateError.message);
  }

  console.log(`🎉 סנכרון "ביחד בשבילך" הושלם! ${upsertedCount} מותגים דינמיים עודכנו ב-DB.`);
}

syncBihad();