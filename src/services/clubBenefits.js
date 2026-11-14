import { supabase } from '../../supabase';

// 1. שליפת שמות רשתות להשלמה אוטומטית ברשימה הנפתחת (למשל "גולף")
export async function searchClubChains(query) {
  const cleanQuery = (query || '').trim();
  if (cleanQuery.length < 2) return [];

  const { data, error } = await supabase
    .from('club_benefits')
    .select('title')
    .eq('is_active', true)
    .eq('benefit_type', 'wallet')
    .ilike('title', `%${cleanQuery}%`)
    .limit(20);

  if (error || !data) return [];

  // הסרת כפילויות (למקרה שרשת מופיעה גם בארנק 25% וגם בארנק 15%)
  const uniqueNames = [...new Set(data.map((item) => item.title.trim()))];
  return uniqueNames;
}

// 2. שליפת שיטות תשלום בלבד (ארנקים נטענים עם אחוז הנחה)
export async function findWalletPaymentBenefits(merchantQuery) {
  const cleanQuery = (merchantQuery || '').trim();
  if (!cleanQuery) return [];

  const { data, error } = await supabase
    .from('club_benefits')
    .select('id, external_id, club_source, title, discount_percent, wallet_name, monthly_limit, redim_type')
    .eq('is_active', true)
    .eq('benefit_type', 'wallet')
    .or(`title.ilike.%${cleanQuery}%,search_keywords.ilike.%${cleanQuery}%`)
    .order('discount_percent', { ascending: false, nullsFirst: false })
    .limit(15);

  if (error || !data) {
    console.log('Error fetching wallet benefits:', error);
    return [];
  }

  const lowerQuery = cleanQuery.toLowerCase();

  // מיון חכם: 1. אחוז הנחה גבוה -> 2. התאמה מדויקת לשם החנות -> 3. שם קצר יותר
  return data.sort((a, b) => {
    const discDiff = Number(b.discount_percent || 0) - Number(a.discount_percent || 0);
    if (discDiff !== 0) return discDiff;

    const titleA = (a.title || '').trim().toLowerCase();
    const titleB = (b.title || '').trim().toLowerCase();
    const exactA = titleA === lowerQuery ? 1 : 0;
    const exactB = titleB === lowerQuery ? 1 : 0;
    if (exactA !== exactB) return exactB - exactA;

    const startsA = titleA.startsWith(lowerQuery) ? 1 : 0;
    const startsB = titleB.startsWith(lowerQuery) ? 1 : 0;
    if (startsA !== startsB) return startsB - startsA;

    return titleA.length - titleB.length;
  });
}

// 3. שליפת מבצעי מוצר וקופונים בלבד (למשל "מצעי פלנל זוגי 100 ₪")
export async function findCatalogPromotions(merchantQuery) {
  const cleanQuery = (merchantQuery || '').trim();
  if (!cleanQuery) return [];

  const { data, error } = await supabase
    .from('club_benefits')
    .select('id, external_id, title, supplier_name, short_description, description, terms_of_use, url')
    .eq('is_active', true)
    .eq('benefit_type', 'catalog')
    .or(`title.ilike.%${cleanQuery}%,supplier_name.ilike.%${cleanQuery}%,search_keywords.ilike.%${cleanQuery}%`)
    .limit(15);

  if (error) {
    console.log('Error fetching catalog promotions:', error);
    return [];
  }
  return data || [];
}