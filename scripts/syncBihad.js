global.WebSocket = require('ws');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = 
  process.env.SUPABASE_SERVICE_ROLE_KEY || 
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 
  process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ חסרים משתני סביבה Supabase!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BIHAD_BASE_URL = 'https://server.hist.org.il/api/category/GetCategoryById?categoryId=';
const INITIAL_CATEGORY_ID = '8851';
let activeCookie = process.env.BIHAD_COOKIE || '';

/**
 * הפקת Cookie & Token עדכניים בלייב ע"י טעינת האתר בדפדפן סמוי
 */
async function getFreshBihadCookies() {
  console.log('🌐 מפעיל דפדפן סמוי (Puppeteer) להפקת Cookie & Token עדכניים...');
  let browser;
  try {
    browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // טעינת דף הבית של ההסתדרות ליצירת סשן תקין
    await page.goto('https://www.hist.org.il/', { waitUntil: 'networkidle2', timeout: 30000 });
    
    // משיכת כל העוגיות שנוצרו בדפדפן
    const cookies = await page.cookies();
    await browser.close();

    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    console.log('✅ הופקו עוגיות עדכניות בהצלחה!');
    return cookieString;
  } catch (err) {
    if (browser) await browser.close();
    console.error('⚠️ שגיאה בהפקת עוגיות דרך Puppeteer:', err.message);
    return '';
  }
}

function extractDiscountPercentage(text) {
  if (!text) return 0;
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? parseFloat(match[1]) : 0;
}

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

async function fetchCategory(categoryId, headers) {
  try {
    const response = await fetch(`${BIHAD_BASE_URL}${categoryId}`, {
      method: 'GET',
      headers: headers
    });

    if (response.status === 401) {
      console.warn(`⚠️ 401 Unauthorized עבור קטגוריה ${categoryId}. נדרש רענון טוקן...`);
      return { isUnauthorized: true };
    }

    if (!response.ok) {
      console.error(`⚠️ שגיאת HTTP ${response.status} (${response.statusText}) עבור קטגוריה ${categoryId}`);
      return null;
    }

    const data = await response.json();
    return data.data || data;
  } catch (err) {
    console.error(`⚠️ שגיאת רשת בבקשת קטגוריה ${categoryId}:`, err.message);
    return null;
  }
}

function extractItemsFromCategoryObj(catObj) {
  if (!catObj) return [];
  let items = [];

  if (Array.isArray(catObj.subCategories) && catObj.subCategories.length > 0) {
    catObj.subCategories.forEach(sub => items.push(sub));
  }
  if (Array.isArray(catObj.events) && catObj.events.length > 0) {
    items.push(...catObj.events);
  }
  if (Array.isArray(catObj.variants) && catObj.variants.length > 0) {
    items.push(...catObj.variants);
  }

  return items;
}

async function fetchLiveBihadBenefits() {
  try {
    // במידה ולא מוגדרת עוגיה, מפיקים אותה אוטומטית לפני הבקשה הראשונה
    if (!activeCookie) {
      activeCookie = await getFreshBihadCookies();
    }

    const buildHeaders = (cookieStr) => ({
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      'organizationid': '48',
      'priority': 'u=1, i',
      'origin': 'https://www.hist.org.il',
      'referer': 'https://www.hist.org.il/',
      'sec-ch-ua': '"Not-A.Brand";v="99", "Google Chrome";v="157", "Chromium";v="157"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
      'cookie': cookieStr
    });

    console.log(`📡 מוריד קטגוריית בסיס ${INITIAL_CATEGORY_ID} לחילוץ עץ הקטגוריות הראשי...`);
    let initialData = await fetchCategory(INITIAL_CATEGORY_ID, buildHeaders(activeCookie));

    // אם התקבלה תשובת 401, מפיקים עוגיות חדשות ומנסים שוב בלייב
    if (initialData?.isUnauthorized) {
      console.log('🔄 מחדש סשן דרך Puppeteer ומנסה שוב...');
      activeCookie = await getFreshBihadCookies();
      initialData = await fetchCategory(INITIAL_CATEGORY_ID, buildHeaders(activeCookie));
    }

    if (!initialData || initialData.isUnauthorized) {
      throw new Error('לא ניתן היה לשלוף את קטגוריית הבסיס גם לאחר רענון עוגיות!');
    }

    const headers = buildHeaders(activeCookie);
    let rootCategories = [initialData];

    if (Array.isArray(initialData.sameLevelCategories) && initialData.sameLevelCategories.length > 0) {
      console.log(`📂 גילוי אוטומטי: נמצאו ${initialData.sameLevelCategories.length} קטגוריות-על ראשיות ברמה הראשית.`);
      const siblingResults = await Promise.all(
        initialData.sameLevelCategories.map(cat => fetchCategory(cat.categoryId, headers))
      );
      rootCategories.push(...siblingResults.filter(r => r && !r.isUnauthorized));
    }

    let allItems = [];

    for (const rootCat of rootCategories) {
      const rootItems = extractItemsFromCategoryObj(rootCat);
      allItems.push(...rootItems);

      const subCats = rootCat.subCategories || [];
      if (subCats.length > 0) {
        const subResults = await Promise.all(
          subCats.map(sub => fetchCategory(sub.categoryId, headers))
        );
        subResults.forEach(subCatObj => {
          if (subCatObj && !subCatObj.isUnauthorized) {
            allItems.push(...extractItemsFromCategoryObj(subCatObj));
          }
        });
      }
    }

    console.log(`📋 סה"כ נאספו ${allItems.length} פריטים והטבות מכל הקטגוריות הראשיות במועדון.`);

    return allItems.map(item => {
      const brandName = 
        item.supplierName || 
        item.business?.name || 
        item.categoryName || 
        item.title || 
        item.Title || '';

      const discountText = `${item.description || ''} ${item.shortDescription || ''} ${item.categorySubTitle || ''}`;
      let discountPercentage = extractDiscountPercentage(discountText);

      if (discountPercentage === 0 && Array.isArray(item.prices) && item.prices.length >= 2) {
        const minPrice = Math.min(...item.prices);
        const maxPrice = Math.max(...item.prices);
        if (maxPrice > minPrice && minPrice > 0) {
          discountPercentage = Math.round(((maxPrice - minPrice) / maxPrice) * 100);
        }
      }

      if (discountPercentage === 0 && item.prices && item.prices.length > 0) {
        discountPercentage = 15;
      }

      const discountType = determineDiscountType(brandName, discountText);

      return {
        brand_name: String(brandName).trim(),
        discount_percentage: discountPercentage,
        discount_type: discountType
      };
    }).filter(item => item.brand_name && item.discount_percentage > 0);

  } catch (err) {
    console.error('❌ שגיאה בשליפת נתונים משרת ביחד בשבילך:', err.message);
    return [];
  }
}

async function syncBihad() {
  const syncStartTime = new Date().toISOString();
  console.log(`🔄 מתחיל סנכרון מקיף מלא "ביחד בשבילך" [${syncStartTime}]...`);

  const { data: club, error: clubError } = await supabase
    .from('global_clubs')
    .select('id')
    .eq('club_key', 'bihad')
    .single();

  if (clubError || !club) {
    console.error('❌ מועדון "ביחד בשבילך" לא נמצא ב-global_clubs!', clubError?.message);
    process.exit(1);
  }

  const liveRules = await fetchLiveBihadBenefits();
  console.log(`🎯 פוענחו ${liveRules.length} הטבות דינמיות מכל הקטגוריות במועדון.`);

  let upsertedCount = 0;

  for (const rule of liveRules) {
    const { error } = await supabase
      .from('club_brand_rules')
      .upsert({
        club_id: club.id,
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

  const { error: deactivateError } = await supabase
    .from('club_brand_rules')
    .update({ is_active: false })
    .eq('club_id', club.id)
    .lt('last_synced_at', syncStartTime);

  if (deactivateError) {
    console.error('⚠️ שגיאה בעדכון Soft Delete:', deactivateError.message);
  }

  console.log(`🎉 סנכרון מקיף מלא "ביחד בשבילך" הושלם! ${upsertedCount} מותגים עודכנו/התווספו ב-DB.`);
}

syncBihad();