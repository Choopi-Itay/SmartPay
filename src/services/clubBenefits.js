import { supabase } from '../../supabase';

let cachedClubChains = null;
let cachedClubsKey = '';
let attemptedInitialSeed = false;

export function invalidateClubCache() {
  cachedClubChains = null;
  cachedClubsKey = '';
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSearchTerms(query) {
  const clean = String(query || '').trim();
  if (!clean) return [];

  const noParens = normalizeText(clean);
  const tokens = clean
    .split(/[\s/|,-]+/)
    .map((t) => t.replace(/[()]/g, '').trim())
    .filter((t) => t.length >= 2);

  return [...new Set([clean, noParens, ...tokens].filter(Boolean))];
}

// 1. שליפת כל המועדונים הפעילים במערכת
export async function fetchAllGlobalClubs() {
  const { data, error } = await supabase
    .from('global_clubs')
    .select('id, club_key, display_name, club_type, sync_strategy, synced_items_count')
    .eq('is_test', false)
    .order('synced_items_count', { ascending: false, nullsFirst: false })
    .order('display_name', { ascending: true });

  if (error) {
    console.warn('[clubBenefits] fetchAllGlobalClubs error:', error.message);
    return [];
  }
  return data || [];
}

// 2. שליפת המועדונים המשויכים למשתמש המחובר (כולל אתחול ברירת מחדל אם ריק)
export async function fetchUserSelectedClubs() {
  const { data: userData, error: authError } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (authError || !userId) {
    return { clubIds: [], clubKeys: [] };
  }

  const [allClubs, userMethodsRes] = await Promise.all([
    fetchAllGlobalClubs(),
    supabase
      .from('user_payment_methods')
      .select('club_id')
      .eq('user_id', userId),
  ]);

  if (userMethodsRes.error) {
    console.warn('[clubBenefits] user_payment_methods error:', userMethodsRes.error.message);
    return { clubIds: [], clubKeys: [] };
  }

  let rows = userMethodsRes.data || [];

  if (rows.length === 0 && !attemptedInitialSeed && allClubs.length > 0) {
    attemptedInitialSeed = true;
    const defaultClub =
      allClubs.find((c) => c.club_key === 'histadrut') ||
      allClubs.find((c) => Number(c.synced_items_count || 0) > 0);

    if (defaultClub) {
      const { error: seedErr } = await supabase
        .from('user_payment_methods')
        .upsert(
          {
            user_id: userId,
            club_id: defaultClub.id,
            card_nickname: defaultClub.display_name || defaultClub.club_key,
          },
          { onConflict: 'user_id,club_id' }
        );
      if (!seedErr) {
        rows = [{ club_id: defaultClub.id }];
      } else {
        console.warn('[clubBenefits] initial seed error:', seedErr.message);
      }
    }
  }

  const clubIdToKey = new Map(allClubs.map((c) => [c.id, c.club_key]));
  const clubIds = [...new Set(rows.map((r) => r.club_id).filter(Boolean))];
  const clubKeys = [...new Set(clubIds.map((id) => clubIdToKey.get(id)).filter(Boolean))];

  return { clubIds, clubKeys };
}

// 3. הוספה או הסרה של מועדון עבור המשתמש המחובר
export async function setUserClubMembership(clubId, shouldEnable) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error('משתמש לא מחובר');

  if (shouldEnable) {
    const allClubs = await fetchAllGlobalClubs();
    const matchedClub = allClubs.find((c) => c.id === clubId);
    const nickname = matchedClub?.display_name || matchedClub?.club_key || 'מועדון צרכנות';

    const { error } = await supabase
      .from('user_payment_methods')
      .upsert(
        {
          user_id: userId,
          club_id: clubId,
          card_nickname: nickname,
        },
        { onConflict: 'user_id,club_id' }
      );
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('user_payment_methods')
      .delete()
      .eq('user_id', userId)
      .eq('club_id', clubId);
    if (error) throw error;
  }

  invalidateClubCache();
}

// 4. שליפת מפתחות המועדונים הפעילים של המשתמש
export async function fetchUserActiveClubKeys() {
  const { clubKeys } = await fetchUserSelectedClubs();
  return clubKeys;
}

// 5. שליפת כל שמות הרשתות הזמינות במועדונים שנבחרו (עם דפדוף מלא מעבר ל-1,000 שורות)
export async function fetchAllActiveClubChains(forceRefresh = false, activeClubKeys = null) {
  const keysToUse = activeClubKeys !== null ? activeClubKeys : await fetchUserActiveClubKeys();
  if (!keysToUse || keysToUse.length === 0) return [];

  const cacheSignature = [...keysToUse].sort().join(',');
  if (cachedClubChains && !forceRefresh && cachedClubsKey === cacheSignature) {
    return cachedClubChains;
  }

  const titlesSet = new Set();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('club_benefits')
      .select('title')
      .eq('is_active', true)
      .eq('benefit_type', 'wallet')
      .in('club_source', keysToUse)
      .range(from, from + pageSize - 1);

    if (error) {
      console.warn('[clubBenefits] fetchAllActiveClubChains error:', error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const clean = normalizeText(row.title);
      if (clean) titlesSet.add(clean);
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  cachedClubsKey = cacheSignature;
  cachedClubChains = Array.from(titlesSet);
  return cachedClubChains;
}

export const searchClubChains = fetchAllActiveClubChains;

// 6. שליפת הטבות ארנק לרשת שנבחרה מתוך המועדונים הפעילים של המשתמש
export async function findWalletPaymentBenefits(merchantQuery, activeClubKeys = null) {
  const cleanQuery = String(merchantQuery || '').trim();
  if (!cleanQuery) return [];

  const keysToUse = activeClubKeys !== null ? activeClubKeys : await fetchUserActiveClubKeys();
  if (!keysToUse || keysToUse.length === 0) return [];

  const terms = extractSearchTerms(cleanQuery);
  const orConditions = terms.flatMap((t) => [
    `title.ilike.%${t}%`,
    `wallet_name.ilike.%${t}%`,
    `search_keywords.ilike.%${t}%`,
  ]);

  const [allClubs, benefitsRes] = await Promise.all([
    fetchAllGlobalClubs(),
    supabase
      .from('club_benefits')
      .select('id, external_id, club_source, title, discount_percent, wallet_name, monthly_limit, redim_type, search_keywords')
      .eq('is_active', true)
      .eq('benefit_type', 'wallet')
      .in('club_source', keysToUse)
      .or(orConditions.join(','))
      .order('discount_percent', { ascending: false, nullsFirst: false }),
  ]);

  if (benefitsRes.error) {
    console.warn('[clubBenefits] findWalletPaymentBenefits error:', benefitsRes.error.message);
    return [];
  }

  const rows = benefitsRes.data || [];
  const clubNameMap = new Map(allClubs.map((c) => [c.club_key, c.display_name]));
  const normalizedQuery = normalizeText(cleanQuery).toLowerCase();

  const exactTitleRows = rows.filter(
    (r) => normalizeText(r.title).toLowerCase() === normalizedQuery
  );
  const candidateRows = exactTitleRows.length > 0 ? exactTitleRows : rows;

  return candidateRows
    .map((item) => {
      const clubName = clubNameMap.get(item.club_source) || item.club_source;
      const rawWallet = String(item.wallet_name || '').trim();
      const displayWalletName =
        rawWallet && !rawWallet.includes(clubName)
          ? `${clubName} • ${rawWallet}`
          : rawWallet || clubName;

      return {
        ...item,
        wallet_name: displayWalletName,
      };
    })
    .sort((a, b) => Number(b.discount_percent || 0) - Number(a.discount_percent || 0));
}

// 7. שליפת הטבות קטלוג/מבצעים לרשת שנבחרה
export async function findCatalogPromotions(merchantQuery, activeClubKeys = null) {
  const cleanQuery = String(merchantQuery || '').trim();
  if (!cleanQuery) return [];

  const keysToUse = activeClubKeys !== null ? activeClubKeys : await fetchUserActiveClubKeys();
  if (!keysToUse || keysToUse.length === 0) return [];

  const terms = extractSearchTerms(cleanQuery);
  const orConditions = terms.flatMap((t) => [
    `supplier_name.ilike.%${t}%`,
    `title.ilike.%${t}%`,
  ]);

  const { data, error } = await supabase
    .from('club_benefits')
    .select('id, external_id, club_source, title, supplier_name, short_description, description, terms_of_use, url')
    .eq('is_active', true)
    .eq('benefit_type', 'catalog')
    .in('club_source', keysToUse)
    .or(orConditions.join(','))
    .limit(25);

  if (error || !data) return [];
  return data;
}