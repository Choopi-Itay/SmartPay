// scripts/syncPais.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ חסרים משתני סביבה SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const PAIS_LOBBY_URL = 'https://paisplus.co.il/cashcards/binding-chit/lobby/get';
const PAIS_CARDS_URL = 'https://paisplus.co.il/cashcards/binding-chit/cards/get';
const PAIS_CHIT_MERCHANTS_URL = 'https://paisplus.co.il/cashcards/binding-chit/merchants';
const PAIS_NETWORKS_PAGE_URL = 'https://paisplus.co.il/cashcards/networks';
const PAIS_RESTAURANTS_PAGE_URL = 'https://paisplus.co.il/cashcards/restaurants';
const PAIS_FOOD_CHAINS_PAGE_URL = 'https://paisplus.co.il/cashcards/food-chains';
const PAIS_SESSION_PAGE_URL = 'https://paisplus.co.il/unified-cash-cards';
const PAIS_HOME_URL = 'https://paisplus.co.il/';
const PAIS_BASE_URL = 'https://paisplus.co.il';
const PAIS_TIER = (process.env.PAIS_TIER || 'regular').toLowerCase() === 'vip' ? 'vip' : 'regular';

const DEFAULT_GROUP_TO_CHIT = {
  201: 5001,
  202: 5002,
};

function parseGroupToChitMap() {
  const map = { ...DEFAULT_GROUP_TO_CHIT };
  if (process.env.PAIS_GROUP_CHIT_MAP) {
    try {
      const parsed = JSON.parse(process.env.PAIS_GROUP_CHIT_MAP);
      for (const [k, v] of Object.entries(parsed || {})) {
        if (v !== null && v !== undefined && String(v).trim() !== '') {
          map[String(k).trim()] = Number(v);
        }
      }
    } catch (err) {
      console.warn('⚠️ אזהרה בפענוח PAIS_GROUP_CHIT_MAP:', err.message);
    }
  }
  return map;
}

const GROUP_TO_CHIT = parseGroupToChitMap();

const EXTRA_CHIT_IDS = String(process.env.PAIS_CHIT_IDS || '')
  .split(',')
  .map((id) => Number(String(id || '').trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const AUTO_DISCOVER = String(process.env.PAIS_AUTO_DISCOVER ?? 'true').toLowerCase() !== 'false';
const MAX_CATEGORIES = Math.max(1, Number(process.env.PAIS_MAX_CATEGORIES || 350));
const FETCH_DELAY_MS = Math.max(0, Number(process.env.PAIS_FETCH_DELAY_MS || 200));

const MANUAL_CATEGORY_IDS = String(process.env.PAIS_CATEGORY_IDS || '')
  .split(',')
  .map((id) => String(id || '').trim())
  .filter(Boolean);

const DEFAULT_ROOT_CATEGORY_IDS = String(process.env.PAIS_ROOT_CATEGORY_IDS || '151,432,1326')
  .split(',')
  .map((id) => String(id || '').trim())
  .filter(Boolean);

const GENERIC_CATEGORY_NAMES = new Set([
  'מזון',
  'שופינג וצרכנות',
  'סרטים, מופעים ועוד',
  'נופשים - כל ההטבות',
  'אטרקציות וחוויות לכל המשפחה',
  'הטבות חדשות באתר',
  'הטבות חדשות',
  'עמוד הבית',
  'מועדפות - כל ההטבות',
  'כל המתנות',
  'אחר - מזון',
  'פיצות',
  'אסייתי',
  'המבורגרים',
  'ביס בפיתה',
  'בתי קפה וארוחות בוקר',
  'ארוחות עד הבית',
  'מעדנייה',
  'חשמל ואלקטרוניקה',
  'אופנה והלבשה',
]);

let activeCookieHeader = String(process.env.PAIS_COOKIE || '').trim();
const manualXsrfToken = String(process.env.PAIS_XSRF_TOKEN || '').trim();

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, retries = 3, baseDelayMs = 400) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

function getSetCookieHeaders(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function mergeCookies(existingCookieStr, setCookieList) {
  const jar = new Map();

  for (const part of String(existingCookieStr || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      jar.set(trimmed.slice(0, eqIdx).trim(), trimmed.slice(eqIdx + 1).trim());
    }
  }

  for (const sc of setCookieList || []) {
    const firstSegment = String(sc || '').split(';')[0].trim();
    const eqIdx = firstSegment.indexOf('=');
    if (eqIdx > 0) {
      jar.set(firstSegment.slice(0, eqIdx).trim(), firstSegment.slice(eqIdx + 1).trim());
    }
  }

  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function extractXsrfFromCookie(cookieHeader) {
  if (manualXsrfToken) return manualXsrfToken;
  if (!cookieHeader) return '';
  const match = cookieHeader.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function extractCategoryIdsFromHtml(html) {
  const ids = new Set();
  if (!html) return ids;

  for (const m of html.matchAll(/\/category\/(\d+)/g)) {
    ids.add(m[1]);
  }
  for (const m of html.matchAll(/"category_id"\s*:\s*"?(\d+)"?/g)) {
    ids.add(m[1]);
  }
  for (const m of html.matchAll(/"categoryId"\s*:\s*"?(\d+)"?/g)) {
    ids.add(m[1]);
  }

  return ids;
}

async function initSessionAndDiscoverRoots() {
  const discoveredRoots = new Set(DEFAULT_ROOT_CATEGORY_IDS);

  console.log('🌐 מנסה להשיג עוגיות סשן, CSRF וקטגוריות ראשיות מ-paisplus.co.il...');
  for (const pageUrl of [
    PAIS_HOME_URL,
    PAIS_NETWORKS_PAGE_URL,
    PAIS_RESTAURANTS_PAGE_URL,
    PAIS_FOOD_CHAINS_PAGE_URL,
    PAIS_SESSION_PAGE_URL,
  ]) {
    try {
      const res = await fetch(pageUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36',
          ...(activeCookieHeader ? { cookie: activeCookieHeader } : {}),
        },
      });

      const setCookies = getSetCookieHeaders(res);
      const html = await res.text();

      if (setCookies.length > 0) {
        activeCookieHeader = mergeCookies(activeCookieHeader, setCookies);
      }

      const foundInPage = extractCategoryIdsFromHtml(html);
      for (const id of foundInPage) {
        discoveredRoots.add(id);
      }
    } catch (err) {
      console.warn(`⚠️ אזהרה בטעינת ${pageUrl}:`, err.message);
    }
  }

  const hasXsrf = Boolean(extractXsrfFromCookie(activeCookieHeader));
  console.log(
    `✅ סשן מוכן (XSRF-TOKEN: ${hasXsrf ? 'כן' : 'לא'}) | אותרו ${discoveredRoots.size} קטגוריות פתיחה`
  );

  return Array.from(discoveredRoots);
}

function buildHeaders(referer = PAIS_NETWORKS_PAGE_URL) {
  const xsrf = extractXsrfFromCookie(activeCookieHeader);

  const headers = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    origin: PAIS_BASE_URL,
    referer,
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36',
    'x-requested-with': 'XMLHttpRequest',
  };

  if (activeCookieHeader) headers.cookie = activeCookieHeader;
  if (xsrf) headers['x-xsrf-token'] = xsrf;

  return headers;
}

function cleanText(raw) {
  return String(raw || '')
    .replace(/<br\s*\/?>/gi, ' | ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/\s*\|\s*\|\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .replace(/^\|\s*|\s*\|$/g, '')
    .trim();
}

function isDiscountActive(val) {
  const s = String(val ?? '').trim().toLowerCase();
  return val === true || s === 'כן' || s === 'yes' || s === 'true' || s === '1';
}

function getMerchantDisplayName(merchant) {
  return cleanText(
    merchant?.commercial_name ||
      merchant?.chit_name ||
      merchant?.marketing_name ||
      merchant?.name ||
      merchant?.title ||
      merchant?.business_name ||
      ''
  );
}

function buildWalletExternalId(groupId, merchantName) {
  const normalized = cleanText(merchantName)
    .toLowerCase()
    .replace(/[^\w\u0590-\u05FF]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `pais_cc_${groupId}_${normalized}`;
}

function summarizeDiscountList(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const activeTiers = list
    .filter((d) => isDiscountActive(d?.active))
    .sort((a, b) => Number(a.from_amount || 0) - Number(b.from_amount || 0));

  if (activeTiers.length === 0) return null;

  const primaryTier = activeTiers[0];
  const tiersSummary = activeTiers
    .map(
      (t) =>
        `${Number(t.from_amount || 0)}-${Number(t.to_amount || 0)} ₪: ${Number(
          t.w_eligibility_discount_percent || 0
        )}%`
    )
    .join(' | ');

  return {
    discountPercent: Number(primaryTier.w_eligibility_discount_percent || 0),
    monthlyLimit: Number(primaryTier.to_amount || 0) || null,
    tiersSummary,
  };
}

function parseTierDiscounts(group) {
  const tierList = Array.isArray(group?.discounts?.[PAIS_TIER])
    ? group.discounts[PAIS_TIER]
    : Array.isArray(group?.discounts?.regular)
    ? group.discounts.regular
    : [];

  return summarizeDiscountList(tierList);
}

function parseChitDiscounts(chit, fallbackDiscountInfo) {
  if (Array.isArray(chit?.topup_rules) && chit.topup_rules.length > 0) {
    const ruleForTier =
      chit.topup_rules.find((r) => String(r?.rule_member || '').toLowerCase() === PAIS_TIER) ||
      chit.topup_rules.find((r) => String(r?.rule_member || '').toLowerCase() === 'regular') ||
      chit.topup_rules[0];

    const parsedFromRule = summarizeDiscountList(ruleForTier?.topup_rule_discounts);
    if (parsedFromRule) return parsedFromRule;
  }

  return fallbackDiscountInfo;
}

function extractSupplierName(product, fallbackCategoryName) {
  const cleanBrandFromTitle = (rawTitle) => {
    const t = cleanText(rawTitle);
    const dashMatch = t.match(/\s-\s([^-\n]{2,40})$/);
    if (dashMatch && dashMatch[1]) {
      const candidate = dashMatch[1].trim();
      if (!/^(מגש|פיצה|לחם|מבצע|קופון|כרטיס)/i.test(candidate)) {
        return candidate;
      }
    }
    return '';
  };

  const normalizeBrand = (raw) =>
    cleanText(raw)
      .replace(/^רשת\s+/i, '')
      .replace(/\s+(בע"מ|בע״מ|בעמ)\s*$/i, '')
      .trim();

  if (product.business_name && cleanText(product.business_name)) {
    return normalizeBrand(product.business_name);
  }

  const fromTitle = cleanBrandFromTitle(product.name);
  if (fromTitle) {
    return normalizeBrand(fromTitle);
  }

  const cleanCat = cleanText(fallbackCategoryName);
  const provider = cleanText(product.provider_name);

  if (provider) {
    const parenMatches = [...provider.matchAll(/\(([^()]+)\)/g)].map((m) => m[1].trim());
    const brandParen = [...parenMatches].reverse().find((p) => !/^\d+$/.test(p));
    if (brandParen) return normalizeBrand(brandParen);
  }

  if (cleanCat && !GENERIC_CATEGORY_NAMES.has(cleanCat) && !/^\d+$/.test(cleanCat)) {
    return normalizeBrand(cleanCat);
  }

  if (provider) {
    const cleanedProvider = provider.replace(/\(\d+\)/g, '').trim();
    if (cleanedProvider) return normalizeBrand(cleanedProvider);
  }

  return normalizeBrand(cleanCat) || 'מפעל הפיס';
}

function buildProductDescription(product) {
  const clubPrice = Number(product.club_price ?? product.discounted_price);
  const marketPrice = Number(product.market_price);

  const parts = [];
  if (!Number.isNaN(clubPrice) && clubPrice > 0) {
    if (!Number.isNaN(marketPrice) && marketPrice > clubPrice) {
      const savingsPct = Math.round(((marketPrice - clubPrice) / marketPrice) * 100);
      parts.push(`מחיר מנוי: ${clubPrice} ₪ במקום ${marketPrice} ₪ (חיסכון ~${savingsPct}%)`);
    } else {
      parts.push(`מחיר מנוי: ${clubPrice} ₪`);
    }
  }

  if (product.product_type_name) {
    parts.push(cleanText(product.product_type_name));
  }

  return parts.join(' | ');
}

function buildMerchantTerms(merchant) {
  const parts = [];
  if (merchant?.short_description) parts.push(cleanText(merchant.short_description));
  if (merchant?.limitations_text) parts.push(cleanText(merchant.limitations_text));
  if (merchant?.terms_of_use) parts.push(cleanText(merchant.terms_of_use));
  if (merchant?.terms) parts.push(cleanText(merchant.terms));
  if (merchant?.redemption_info) parts.push(cleanText(merchant.redemption_info));
  if (merchant?.branches_page_url) parts.push(`סניפים: ${cleanText(merchant.branches_page_url)}`);
  return [...new Set(parts.filter(Boolean))].join(' | ') || null;
}

function safeParseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn(`⚠️ JSON לא תקין / נחתך ב-${label}: ${err.message}`);
    return null;
  }
}

async function fetchPaisLobby() {
  const res = await fetch(PAIS_LOBBY_URL, {
    method: 'GET',
    headers: buildHeaders(PAIS_SESSION_PAGE_URL),
  });

  const updatedCookies = getSetCookieHeaders(res);
  if (updatedCookies.length > 0) {
    activeCookieHeader = mergeCookies(activeCookieHeader, updatedCookies);
  }

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!res.ok || !contentType.includes('application/json')) {
    throw new Error(
      `תגובה לא תקינה מ-Pais Lobby (HTTP ${res.status}, content-type: ${contentType}): ${text.slice(0, 200)}`
    );
  }

  const json = safeParseJson(text, 'Pais Lobby');
  if (!json || json.status_code !== 0 || !Array.isArray(json.groups)) {
    throw new Error(`מבנה JSON לא צפוי ב-Lobby: status_code=${json?.status_code}`);
  }

  return json.groups;
}

async function fetchGroupChits(groupId, referer) {
  const res = await fetch(PAIS_CARDS_URL, {
    method: 'POST',
    headers: { ...buildHeaders(referer), 'content-type': 'application/json' },
    body: JSON.stringify({ chit_group_id: Number(groupId) }),
  });

  const updatedCookies = getSetCookieHeaders(res);
  if (updatedCookies.length > 0) {
    activeCookieHeader = mergeCookies(activeCookieHeader, updatedCookies);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} עבור chit_group_id=${groupId}: ${text.slice(0, 150)}`);
  }

  const json = safeParseJson(text, `cards/get group=${groupId}`);
  if (!json || json.status_code !== 0) {
    throw new Error(
      `status_code=${json?.status_code} (${json?.status_msg || ''}) עבור chit_group_id=${groupId}`
    );
  }
  return Array.isArray(json.chits) ? json.chits : [];
}

async function fetchChitMerchants(chitId, referer = PAIS_NETWORKS_PAGE_URL) {
  const res = await fetch(PAIS_CHIT_MERCHANTS_URL, {
    method: 'POST',
    headers: {
      ...buildHeaders(referer),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ chit_id: Number(chitId) }),
  });

  const updatedCookies = getSetCookieHeaders(res);
  if (updatedCookies.length > 0) {
    activeCookieHeader = mergeCookies(activeCookieHeader, updatedCookies);
  }

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!res.ok || !contentType.includes('application/json')) {
    throw new Error(
      `HTTP ${res.status} עבור chit_id=${chitId} (content-type: ${contentType}): ${text.slice(0, 150)}`
    );
  }

  const json = safeParseJson(text, `chit_id=${chitId}`);
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.merchants)) return json.merchants;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.items)) return json.items;
  return [];
}

function buildWalletRowFromMerchant({ merchant, chitId, groupName, walletUrl, discountInfo }) {
  const title = getMerchantDisplayName(merchant);
  if (!title) return null;

  const effectiveChitId = merchant?.chit_id ?? chitId;
  const externalId = buildWalletExternalId(effectiveChitId, title);
  const effectiveDiscount = parseChitDiscounts(merchant, discountInfo);
  const merchantTerms = buildMerchantTerms(merchant);
  const tagNames = Array.isArray(merchant?.tags)
    ? merchant.tags.map((t) => cleanText(t?.tag_name)).filter(Boolean)
    : [];

  return {
    external_id: externalId,
    club_source: 'pais',
    benefit_type: 'wallet',
    is_active: true,
    title,
    supplier_name: title,
    wallet_name: groupName,
    discount_percent: effectiveDiscount?.discountPercent ?? null,
    monthly_limit: effectiveDiscount?.monthlyLimit ?? null,
    terms_of_use: merchantTerms,
    search_keywords: [
      groupName,
      title,
      ...tagNames,
      effectiveDiscount?.tiersSummary,
      merchantTerms,
    ]
      .filter(Boolean)
      .join(' | '),
    url: merchant?.site_url || merchant?.url || walletUrl,
  };
}

async function fetchPaisCategoryPage(categoryId, skip = 0) {
  const baseUrl = `${PAIS_BASE_URL}/category/${categoryId}`;
  const url = skip > 0 ? `${baseUrl}?skip=${skip}` : baseUrl;

  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(baseUrl),
    });

    const updatedCookies = getSetCookieHeaders(res);
    if (updatedCookies.length > 0) {
      activeCookieHeader = mergeCookies(activeCookieHeader, updatedCookies);
    }

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    if (!res.ok || !contentType.includes('application/json')) {
      throw new Error(
        `תגובה לא תקינה מקטגוריה ${categoryId} (HTTP ${res.status}): ${text.slice(0, 200)}`
      );
    }

    const json = safeParseJson(text, `category/${categoryId}`);
    if (!json || json.status_code !== 0) {
      throw new Error(`סטטוס לא תקין בקטגוריה ${categoryId}: status_code=${json?.status_code}`);
    }

    return json;
  }, 2, 300);
}

function collectSubcategoryIds(subcategories, outQueue) {
  if (!Array.isArray(subcategories)) return;
  for (const sub of subcategories) {
    if (!sub || !sub.category_id) continue;
    if (sub.require_login === 'Y' || sub.hide_when_not_logged_in === 'Y') continue;
    outQueue.push(String(sub.category_id).trim());
    if (sub.link_to_category_id) {
      outQueue.push(String(sub.link_to_category_id).trim());
    }
    if (Array.isArray(sub.categories) && sub.categories.length > 0) {
      collectSubcategoryIds(sub.categories, outQueue);
    }
  }
}

async function deactivateStaleBenefits(activeIds, hasCategoryErrors) {
  const { data: existingActive, error: fetchActiveErr } = await supabase
    .from('club_benefits')
    .select('external_id, benefit_type')
    .eq('club_source', 'pais')
    .eq('is_active', true);

  if (fetchActiveErr) {
    console.warn('⚠️ אזהרה בבדיקת רשומות פעילות קיימות של pais:', fetchActiveErr.message);
    return 0;
  }

  if (!existingActive || existingActive.length === 0) return 0;

  const staleIds = existingActive
    .filter((r) => {
      if (!r.external_id || activeIds.has(r.external_id)) return false;
      if (hasCategoryErrors && r.benefit_type === 'catalog') return false;
      return true;
    })
    .map((r) => r.external_id);

  if (staleIds.length === 0) return 0;

  const DEACTIVATE_BATCH_SIZE = 200;
  let deactivatedCount = 0;

  for (let i = 0; i < staleIds.length; i += DEACTIVATE_BATCH_SIZE) {
    const chunk = staleIds.slice(i, i + DEACTIVATE_BATCH_SIZE);
    const { error: deactivateErr } = await supabase
      .from('club_benefits')
      .update({ is_active: false })
      .eq('club_source', 'pais')
      .in('external_id', chunk);

    if (deactivateErr) {
      console.warn(`⚠️ אזהרה בכיבוי רשומות ישנות של pais (batch ${i}):`, deactivateErr.message);
    } else {
      deactivatedCount += chunk.length;
    }
  }

  if (deactivatedCount > 0) {
    console.log(
      `🔕 סומנו כלא אקטיביות (is_active = false): ${deactivatedCount} הטבות שהסתיימו או הוסרו ב-pais`
    );
  }

  return deactivatedCount;
}

async function syncPais() {
  console.log(
    `🚀 מתחיל סנכרון מפעל הפיס (pais) | מסלול: ${PAIS_TIER.toUpperCase()} | סריקת קטגוריות אוטומטית: ${
      AUTO_DISCOVER ? `ON (עד ${MAX_CATEGORIES})` : 'OFF'
    }`
  );

  const discoveredRootIds = await initSessionAndDiscoverRoots();

  const rowsToUpsert = [];
  const seenExternalIds = new Set();
  const syncedChitIds = new Set();

  // 1. תווים נטענים מאוחדים (wallet) מתוך Lobby + cards/get
  let groups = [];
  try {
    groups = await fetchPaisLobby();
    console.log(`📦 התקבלו ${groups.length} קבוצות תווים נטענים`);
  } catch (err) {
    console.warn(`⚠️ אזהרה בטעינת Lobby: ${err.message}`);
  }

  for (const group of groups) {
    const groupName = cleanText(group.name);
    const discountInfo = parseTierDiscounts(group);

    if (!discountInfo || discountInfo.discountPercent <= 0) {
      console.log(`⚠️ מדלג על קבוצה "${groupName}" (${group.id}) — ללא מדרגת הנחה פעילה`);
      continue;
    }

    const topupUrl = group.topup_rel_url
      ? `${PAIS_BASE_URL}${group.topup_rel_url.startsWith('/') ? '' : '/'}${group.topup_rel_url}`
      : PAIS_SESSION_PAGE_URL;

    const mappedChitId = group.chit_id ?? GROUP_TO_CHIT[String(group.id)] ?? null;
    let merchants = Array.isArray(group.merchants) ? [...group.merchants] : [];

    let loadedFromCardsGet = false;
    try {
      const chits = await fetchGroupChits(group.id, topupUrl);
      if (chits.length > 0) {
        merchants = chits;
        loadedFromCardsGet = true;
      } else {
        console.warn(`⚠️ cards/get החזיר 0 chits עבור קבוצה ${groupName} (${group.id})`);
      }
    } catch (err) {
      console.warn(`⚠️ לא ניתן למשוך chits עבור קבוצה ${groupName} (${group.id}): ${err.message}`);
    }

    if (!loadedFromCardsGet && mappedChitId) {
      syncedChitIds.add(Number(mappedChitId));
      const referer = Number(mappedChitId) === 5002 ? PAIS_RESTAURANTS_PAGE_URL : PAIS_NETWORKS_PAGE_URL;
      try {
        const fetchedMerchants = await fetchChitMerchants(mappedChitId, referer);
        if (fetchedMerchants.length > 0) {
          const existingNames = new Set(merchants.map((m) => getMerchantDisplayName(m).toLowerCase()));
          for (const fm of fetchedMerchants) {
            const fname = getMerchantDisplayName(fm);
            if (fname && !existingNames.has(fname.toLowerCase())) {
              merchants.push(fm);
              existingNames.add(fname.toLowerCase());
            }
          }
        }
      } catch (err) {
        console.warn(
          `⚠️ לא ניתן למשוך רשימה מלאה עבור קבוצה ${groupName} (chit_id=${mappedChitId}): ${err.message}`
        );
      }
    }

    if (FETCH_DELAY_MS > 0) await sleep(FETCH_DELAY_MS);

    const idForKey = loadedFromCardsGet ? `group_${group.id}` : (mappedChitId ?? group.id);
    console.log(
      `  • [Wallet] ${groupName} (${idForKey}): ${discountInfo.discountPercent}% (עד ${discountInfo.monthlyLimit} ₪) | ${merchants.length} בתי עסק`
    );

    for (const merchant of merchants) {
      const row = buildWalletRowFromMerchant({
        merchant,
        chitId: idForKey,
        groupName,
        walletUrl: topupUrl,
        discountInfo,
      });
      if (!row || seenExternalIds.has(row.external_id)) continue;
      seenExternalIds.add(row.external_id);
      rowsToUpsert.push(row);
    }
  }

  // 1ב. משיכה ישירה של chit_ids נוספים אם הוגדרו ב-PAIS_CHIT_IDS
  for (const chitId of EXTRA_CHIT_IDS) {
    if (syncedChitIds.has(chitId)) continue;
    syncedChitIds.add(chitId);

    try {
      const referer = chitId === 5002 ? PAIS_RESTAURANTS_PAGE_URL : PAIS_NETWORKS_PAGE_URL;
      const fetchedMerchants = await fetchChitMerchants(chitId, referer);
      const groupLabel = chitId === 5002 ? 'תו נטען מסעדות' : `תו ${chitId}`;
      let addedFromChit = 0;

      for (const merchant of fetchedMerchants) {
        const row = buildWalletRowFromMerchant({
          merchant,
          chitId,
          groupName: groupLabel,
          walletUrl: referer,
          discountInfo: null,
        });
        if (!row || seenExternalIds.has(row.external_id)) continue;
        seenExternalIds.add(row.external_id);
        rowsToUpsert.push(row);
        addedFromChit++;
      }

      console.log(
        `  • [Wallet Chit ${chitId}] ${groupLabel}: נוספו ${addedFromChit} בתי עסק/רשתות`
      );
      if (FETCH_DELAY_MS > 0) await sleep(FETCH_DELAY_MS);
    } catch (err) {
      console.warn(`⚠️ אזהרה במשיכת רשתות עבור chit_id=${chitId}: ${err.message}`);
    }
  }

  // 2. סריקת קטגוריות והטבות/קופונים (catalog)
  const rawQueue = [...MANUAL_CATEGORY_IDS, ...(AUTO_DISCOVER ? discoveredRootIds : [])];
  const prioritizedQueue = [
    ...rawQueue.filter((id) => id !== '151'),
    ...rawQueue.filter((id) => id === '151'),
  ];

  const queue = prioritizedQueue;
  const queuedSet = new Set(queue);
  const visitedCategories = new Set();
  let catalogCount = 0;
  let hasCategoryErrors = false;

  while (queue.length > 0 && visitedCategories.size < MAX_CATEGORIES) {
    const categoryId = queue.shift();
    if (!categoryId || visitedCategories.has(categoryId)) continue;
    visitedCategories.add(categoryId);

    try {
      let skip = 0;
      let addedInCategory = 0;
      let catName = categoryId;

      while (true) {
        const catData = await fetchPaisCategoryPage(categoryId, skip);
        if (skip === 0) {
          catName = cleanText(catData.category_name || catData.header || categoryId);
          if (catData.parentCategoryId) {
            const pId = String(catData.parentCategoryId).trim();
            if (pId && !visitedCategories.has(pId) && !queuedSet.has(pId)) {
              queuedSet.add(pId);
              queue.push(pId);
            }
          }
          if (AUTO_DISCOVER && Array.isArray(catData.categories) && catData.categories.length > 0) {
            const discovered = [];
            collectSubcategoryIds(catData.categories, discovered);
            for (const nextId of discovered) {
              if (!visitedCategories.has(nextId) && !queuedSet.has(nextId)) {
                queuedSet.add(nextId);
                queue.unshift(nextId);
              }
            }
          }
        }

        const rawProducts = Array.isArray(catData.products)
          ? catData.products
          : Array.isArray(catData.items)
          ? catData.items
          : [];

        for (const product of rawProducts) {
          if (!product || !product.product_id) continue;
          const externalId = `pais_prod_${product.product_id}`;
          if (seenExternalIds.has(externalId)) continue;

          const title = cleanText(product.name);
          if (!title) continue;

          seenExternalIds.add(externalId);
          const supplierName = extractSupplierName(product, catName);
          const shortDesc = cleanText(product.short_description);
          const description = buildProductDescription(product);
          const termsParts = [
            product.fulfillment_type_name ? `מימוש: ${cleanText(product.fulfillment_type_name)}` : '',
            product.eligibility_type_name ? `זכאות: ${cleanText(product.eligibility_type_name)}` : '',
          ].filter(Boolean);

          const keywords = [...new Set([catName, supplierName, title].map(cleanText).filter(Boolean))].join(' | ');

          rowsToUpsert.push({
            external_id: externalId,
            club_source: 'pais',
            benefit_type: 'catalog',
            is_active: product.out_of_stock !== 'Y',
            title,
            supplier_name: supplierName,
            short_description: shortDesc || null,
            description: description || null,
            terms_of_use: termsParts.join(' | ') || null,
            search_keywords: keywords || null,
            url: `${PAIS_BASE_URL}/category/${categoryId}`,
          });

          addedInCategory++;
          catalogCount++;
        }

        const showCount = Number(catData.show || 300);
        if (catData.has_more === 'Y' && rawProducts.length > 0 && skip < 3000) {
          skip += showCount;
          if (FETCH_DELAY_MS > 0) await sleep(FETCH_DELAY_MS);
        } else {
          break;
        }
      }

      if (addedInCategory > 0) {
        console.log(`  🍕 [Catalog] ${catName} (${categoryId}): נוספו ${addedInCategory} מוצרים`);
      }
    } catch (err) {
      hasCategoryErrors = true;
      console.warn(`⚠️ דילוג על קטגוריה ${categoryId}: ${err.message}`);
    }

    if (queue.length > 0 && FETCH_DELAY_MS > 0) {
      await sleep(FETCH_DELAY_MS);
    }
  }

  if (queue.length > 0) {
    console.warn(
      `⚠️ הסריקה נעצרה בגלל PAIS_MAX_CATEGORIES (${MAX_CATEGORIES}) ונותרו ${queue.length} קטגוריות בתור. הגדל PAIS_MAX_CATEGORIES ב-.env אם צריך לסרוק הכל.`
    );
  }

  console.log(
    `📊 סיכום שליפה: ${rowsToUpsert.length - catalogCount} תווים נטענים + ${catalogCount} מוצרי קטלוג (נסרקו ${visitedCategories.size} קטגוריות, נותרו בתור: ${queue.length})`
  );

  if (rowsToUpsert.length === 0) {
    throw new Error('לא נמצאו רשומות תקינות לסנכרון עבור pais');
  }

  const BATCH_SIZE = 100;
  for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
    const batch = rowsToUpsert.slice(i, i + BATCH_SIZE);
    await withRetry(async () => {
      const { error: upsertErr } = await supabase
        .from('club_benefits')
        .upsert(batch, { onConflict: 'external_id' });

      if (upsertErr) {
        throw new Error(`שגיאה ב-upsert ל-club_benefits (batch ${i}): ${upsertErr.message}`);
      }
    }, 3, 500);
  }

  const deactivatedCount = await deactivateStaleBenefits(seenExternalIds, hasCategoryErrors);
  const activeSyncedCount = rowsToUpsert.filter((r) => r.is_active).length;

  const { error: countErr } = await supabase
    .from('global_clubs')
    .update({ synced_items_count: activeSyncedCount })
    .eq('club_key', 'pais');

  if (countErr) {
    console.warn('⚠️ אזהרה בעדכון synced_items_count ב-global_clubs:', countErr.message);
  }

  console.log(
    `✅ סנכרון pais הושלם: ${activeSyncedCount} הטבות פעילות (${rowsToUpsert.length} סה"כ עובדו, ${deactivatedCount} כובו).`
  );
}

syncPais().catch((err) => {
  console.error('❌ שגיאה בסנכרון pais:', err.message);
  process.exit(1);
});