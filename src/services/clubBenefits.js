import { supabase } from '../../supabase';

let cachedClubChains = null;

// 1. שליפת כל שמות הרשתות הפעילות במועדון (עם Cache בזיכרון למניעת טעינות חוזרות)
export async function fetchAllActiveClubChains(forceRefresh = false) {
  if (cachedClubChains && !forceRefresh) {
    return cachedClubChains;
  }

  const { data, error } = await supabase
    .from('club_benefits')
    .select('title')
    .eq('is_active', true)
    .eq('benefit_type', 'wallet');

  if (error || !data) {
    console.log('Error fetching active club chains:', error);
    return cachedClubChains || [];
  }

  cachedClubChains = [
    ...new Set(data.map((item) => (item.title || '').trim()).filter(Boolean)),
  ];
  return cachedClubChains;
}

export const searchClubChains = fetchAllActiveClubChains;

// 2. שליפת שיטות תשלום בלבד (ארנקים נטענים עם אחוז הנחה) - בהתאמה מדויקת לרשת שנבחרה
export async function findWalletPaymentBenefits(merchantQuery) {
  const cleanQuery = (merchantQuery || '').trim();
  if (!cleanQuery) return [];

  const { data, error } = await supabase
    .from('club_benefits')
    .select('id, external_id, club_source, title, discount_percent, wallet_name, monthly_limit, redim_type, search_keywords')
    .eq('is_active', true)
    .eq('benefit_type', 'wallet')
    .ilike('title', `%${cleanQuery}%`)
    .order('discount_percent', { ascending: false, nullsFirst: false });

  if (error || !data) {
    console.log('Error fetching wallet benefits:', error);
    return [];
  }

  const lowerQuery = cleanQuery.toLowerCase();

  const exactMatches = data.filter(
    (item) => (item.title || '').trim().toLowerCase() === lowerQuery
  );

  const finalResults = exactMatches.length > 0 ? exactMatches : data;

  return finalResults.sort(
    (a, b) => Number(b.discount_percent || 0) - Number(a.discount_percent || 0)
  );
}

// 3. שליפת מבצעי מוצר וקופונים בלבד לרשת שנבחרה
export async function findCatalogPromotions(merchantQuery) {
  const cleanQuery = (merchantQuery || '').trim();
  if (!cleanQuery) return [];

  const { data, error } = await supabase
    .from('club_benefits')
    .select('id, external_id, title, supplier_name, short_description, description, terms_of_use, url')
    .eq('is_active', true)
    .eq('benefit_type', 'catalog')
    .or(`supplier_name.ilike.%${cleanQuery}%,title.ilike.%${cleanQuery}%`)
    .limit(25);

  if (error || !data) {
    console.log('Error fetching catalog promotions:', error);
    return [];
  }

  const lowerQuery = cleanQuery.toLowerCase();
  const exactSupplierMatches = data.filter(
    (item) => (item.supplier_name || '').trim().toLowerCase() === lowerQuery
  );

  return exactSupplierMatches.length > 0 ? exactSupplierMatches : data;
}