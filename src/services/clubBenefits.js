import { supabase } from '../../supabase';

let cachedClubChains = null;
let cachedClubsKey = '';
let cachedAt = 0;
let attemptedInitialSeed = false;

const CHAIN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 דקות

export function invalidateClubCache() {
  cachedClubChains = null;
  cachedClubsKey = '';
  cachedAt = 0;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalChainName(value) {
  return normalizeText(value)
    .replace(/^רשת\s+/i, '')
    .replace(/\s+(בע"מ|בע״מ|בעמ)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePostgrestTerm(term) {
  return String(term || '').replace(/[%_,]/g, ' ').replace(/\s+/g, ' ').trim();
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

async function fetchPaginatedColumn(table, column, benefitType, clubKeys, pageSize = 1000) {
  const values = [];
  let from = 0;

  while (true) {
    let q = supabase
      .from(table)
      .select(column)
      .eq('is_active', true)
      .eq('benefit_type', benefitType)
      .in('club_source', clubKeys);

    if (benefitType === 'catalog') {
      q = q.not(column, 'is', null);
    }

    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) {
      console.warn(`[clubBenefits] fetchPaginatedColumn (${benefitType}) error:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row[column]) values.push(row[column]);
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return values;
}

// 5. שליפת כל שמות הרשתות הזמינות במועדונים שנבחרו (קריאת RPC מהירה עם גיבוי לדפדוף)
export async function fetchAllActiveClubChains(forceRefresh = false, activeClubKeys = null) {
  const keysToUse = activeClubKeys !== null ? activeClubKeys : await fetchUserActiveClubKeys();
  if (!keysToUse || keysToUse.length === 0) return [];

  const cacheSignature = [...keysToUse].sort().join(',');
  const isCacheValid =
    cachedClubChains &&
    !forceRefresh &&
    cachedClubsKey === cacheSignature &&
    Date.now() - cachedAt < CHAIN_CACHE_TTL_MS;

  if (isCacheValid) {
    return cachedClubChains;
  }

  const canonicalMap = new Map();

  // ניסיון ראשון: קריאת RPC מהירה בצד השרת (מחזירה שמות ייחודיים בלבד)
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_active_club_chains', {
    p_club_keys: keysToUse,
  });

  if (!rpcError && Array.isArray(rpcData)) {
    for (const row of rpcData) {
      const clean = normalizeText(row.chain_name);
      const canon = canonicalChainName(clean);
      if (canon && canon !== 'מפעל הפיס') {
        const key = canon.toLowerCase();
        if (!canonicalMap.has(key)) {
          canonicalMap.set(key, canon);
        }
      }
    }

    cachedClubsKey = cacheSignature;
    cachedClubChains = Array.from(canonicalMap.values());
    cachedAt = Date.now();
    return cachedClubChains;
  }

  // גיבוי: דפדוף מלא אם פונקציית ה-RPC טרם הוגדרה ב-DB
  const [walletTitles, catalogSuppliers] = await Promise.all([
    fetchPaginatedColumn('club_benefits', 'title', 'wallet', keysToUse),
    fetchPaginatedColumn('club_benefits', 'supplier_name', 'catalog', keysToUse),
  ]);

  for (const rawTitle of walletTitles) {
    const clean = normalizeText(rawTitle);
    const canon = canonicalChainName(clean);
    if (canon) {
      const key = canon.toLowerCase();
      if (!canonicalMap.has(key)) {
        canonicalMap.set(key, clean);
      }
    }
  }

  for (const rawSupplier of catalogSuppliers) {
    const clean = normalizeText(rawSupplier);
    const canon = canonicalChainName(clean);
    if (canon && canon !== 'מפעל הפיס') {
      const key = canon.toLowerCase();
      if (!canonicalMap.has(key)) {
        canonicalMap.set(key, canon);
      }
    }
  }

  cachedClubsKey = cacheSignature;
  cachedClubChains = Array.from(canonicalMap.values());
  cachedAt = Date.now();
  return cachedClubChains;
}

export const searchClubChains = fetchAllActiveClubChains;

// 6. שליפת הטבות ארנק לרשת שנבחרה — התאמה מדויקת/ממוקדת לשם הרשת בלבד
export async function findWalletPaymentBenefits(merchantQuery, activeClubKeys = null) {
  const cleanQuery = escapePostgrestTerm(merchantQuery);
  if (!cleanQuery || cleanQuery.length < 2) return [];

  const keysToUse = activeClubKeys !== null ? activeClubKeys : await fetchUserActiveClubKeys();
  if (!keysToUse || keysToUse.length === 0) return [];

  const canonQuery = canonicalChainName(cleanQuery).toLowerCase();
  const rawLower = normalizeText(cleanQuery).toLowerCase();

  const [allClubs, benefitsRes] = await Promise.all([
    fetchAllGlobalClubs(),
    supabase
      .from('club_benefits')
      .select('id, external_id, club_source, title, discount_percent, wallet_name, monthly_limit, redim_type, search_keywords')
      .eq('is_active', true)
      .eq('benefit_type', 'wallet')
      .in('club_source', keysToUse)
      .ilike('title', `%${cleanQuery}%`)
      .order('discount_percent', { ascending: false, nullsFirst: false }),
  ]);

  if (benefitsRes.error) {
    console.warn('[clubBenefits] findWalletPaymentBenefits error:', benefitsRes.error.message);
    return [];
  }

  const rows = (benefitsRes.data || []).filter((r) => {
    const itemTitleNorm = normalizeText(r.title).toLowerCase();
    const itemCanon = canonicalChainName(r.title).toLowerCase();
    return (
      itemTitleNorm === rawLower ||
      itemCanon === canonQuery ||
      (canonQuery.length >= 3 && (itemCanon.includes(canonQuery) || canonQuery.includes(itemCanon)))
    );
  });

  const clubNameMap = new Map(allClubs.map((c) => [c.club_key, c.display_name]));

  return rows
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

// 7. שליפת הטבות קטלוג/מבצעים לרשת שנבחרה — מאוזנת בין כל המועדונים הפעילים
export async function findCatalogPromotions(merchantQuery, activeClubKeys = null) {
  const cleanQuery = escapePostgrestTerm(merchantQuery);
  if (!cleanQuery || cleanQuery.length < 2) return [];

  const keysToUse = activeClubKeys !== null ? activeClubKeys : await fetchUserActiveClubKeys();
  if (!keysToUse || keysToUse.length === 0) return [];

  const canonTerm = escapePostgrestTerm(canonicalChainName(cleanQuery));
  const searchTerm = canonTerm.length >= 2 ? canonTerm : cleanQuery;
  const perClubLimit = Math.max(10, Math.ceil(40 / keysToUse.length));

  const clubResults = await Promise.all(
    keysToUse.map(async (clubKey) => {
      const { data, error } = await supabase
        .from('club_benefits')
        .select('id, external_id, club_source, title, supplier_name, short_description, description, terms_of_use, url')
        .eq('is_active', true)
        .eq('benefit_type', 'catalog')
        .eq('club_source', clubKey)
        .or(
          `supplier_name.ilike.%${searchTerm}%,title.ilike.%${searchTerm}%,search_keywords.ilike.%${searchTerm}%`
        )
        .limit(perClubLimit);

      if (error || !data) return [];
      return data;
    })
  );

  const seenIds = new Set();
  const combined = [];

  for (const list of clubResults) {
    for (const row of list) {
      if (!row?.id || seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      combined.push(row);
    }
  }

  return combined;
}