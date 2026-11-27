// scripts/syncHtzone.js
// סנכרון קטלוג הייטקזון (htzone.co.il) דרך שרת ה-MCP הרשמי (קריאה בלבד, ללא התחברות).
// ה-endpoint מפורסם ב: https://www.htzone.co.il/.well-known/mcp/server-card.json
// הערה: לא משתמשים ב-/api/ (חסום ב-robots.txt) ולא מחקים התחברות.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
// בכוונה בלי fallback ל-anon key: סקריפט שכותב ומכבה רשומות חייב service role.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DRY_RUN = String(process.env.HTZ_DRY_RUN || 'false').toLowerCase() === 'true';
const DEBUG = String(process.env.HTZ_DEBUG || 'false').toLowerCase() === 'true';

if (!SUPABASE_URL || (!SUPABASE_SERVICE_KEY && !DRY_RUN)) {
  console.error('❌ חסרים משתני סביבה SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (ב-HTZ_DRY_RUN=true אפשר בלי מפתח)');
  process.exit(1);
}

const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SITE_URL = 'https://www.htzone.co.il';
const MCP_URL = process.env.HTZ_MCP_URL || `${SITE_URL}/mcp`;
const PROTOCOL_VERSION = '2025-11-25';
const CLUB_SOURCE = 'htzone';
const USER_AGENT = 'club-benefits-sync/1.0 (MCP client)';

const FETCH_DELAY_MS = Math.max(0, Number(process.env.HTZ_FETCH_DELAY_MS || 250));
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.HTZ_TIMEOUT_MS || 30000));
const MAX_RETRIES = Math.max(0, Number(process.env.HTZ_MAX_RETRIES || 3));
const MAX_PAGES = Math.min(50, Math.max(1, Number(process.env.HTZ_MAX_PAGES || 50)));
const MAX_CATEGORIES = Math.max(1, Number(process.env.HTZ_MAX_CATEGORIES || 300));
const INCLUDE_TOP_CATEGORIES = String(process.env.HTZ_INCLUDE_TOP || 'false').toLowerCase() === 'true';
// הגנה מכיבוי המוני: לא מכבים אם נמצאו פחות מ-X% מהרשומות הפעילות הקיימות
const MIN_KEEP_RATIO = Math.min(1, Math.max(0, Number(process.env.HTZ_MIN_KEEP_RATIO || 0.7)));

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, retries = 3, baseDelayMs = 500) {
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

function cleanText(raw) {
  return String(raw ?? '')
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

function debugLog(label, value) {
  if (!DEBUG) return;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  console.log(`🔎 [DEBUG] ${label}:\n${String(text).slice(0, 2500)}`);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

let sessionId = null;
let rpcId = 0;

function parseSse(text) {
  const messages = [];
  for (const block of String(text).split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!data) continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // מתעלמים מאירועים שאינם JSON
    }
  }
  return messages;
}

async function rpc(method, params, { notify = false } = {}) {
  const id = notify ? undefined : ++rpcId;
  const body = { jsonrpc: '2.0', ...(notify ? {} : { id }), method, ...(params ? { params } : {}) };
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'user-agent': USER_AGENT,
          ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': PROTOCOL_VERSION } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const sid = res.headers.get('mcp-session-id');
      if (sid) sessionId = sid;

      const text = await res.text();
      if (notify) {
        if (!res.ok && res.status !== 202) throw new HttpError(res.status, `HTTP ${res.status}: ${text.slice(0, 150)}`);
        return null;
      }
      if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}: ${text.slice(0, 200)}`);

      const contentType = res.headers.get('content-type') || '';
      let msg;
      if (contentType.includes('text/event-stream')) {
        msg = parseSse(text).find((m) => m.id === id);
      } else {
        const parsed = JSON.parse(text);
        msg = Array.isArray(parsed) ? parsed.find((m) => m.id === id) : parsed;
      }
      if (!msg) throw new Error(`אין תגובת JSON-RPC עבור ${method}`);
      if (msg.error) {
        const e = new Error(`MCP error ${msg.error.code}: ${msg.error.message}`);
        e.retryable = false;
        throw e;
      }
      return msg.result;
    } catch (err) {
      lastErr = err;
      const networkish = err?.name === 'TimeoutError' || err?.name === 'AbortError' || err instanceof TypeError;
      const retryable = err.retryable === true || networkish;
      if (!retryable || attempt === MAX_RETRIES) break;
      const wait = Math.min(15000, 1000 * 2 ** attempt);
      console.warn(`⚠️ ${method} נכשל (${err.message}), ניסיון חוזר ${attempt + 1}/${MAX_RETRIES} בעוד ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function initMcp() {
  sessionId = null;
  const result = await rpc('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'club-benefits-sync', version: '1.0.0' },
  });
  await rpc('notifications/initialized', undefined, { notify: true });
  return result;
}

function unwrapToolResult(result) {
  if (result && result.structuredContent !== undefined) return result.structuredContent;
  const text = (result?.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callTool(name, args = {}) {
  let result;
  try {
    result = await rpc('tools/call', { name, arguments: args });
  } catch (err) {
    if (err.status === 404 || err.status === 400) {
      console.warn('⚠️ הסשן נראה לא תקף, מאתחל מחדש...');
      await initMcp();
      result = await rpc('tools/call', { name, arguments: args });
    } else {
      throw err;
    }
  }
  if (result?.isError) {
    const msg = (result.content || []).map((c) => c.text || '').join(' ').slice(0, 200);
    throw new Error(`הכלי ${name} החזיר שגיאה: ${msg}`);
  }
  return unwrapToolResult(result);
}

function findArray(data, preferredKeys, { fallback = true } = {}) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of preferredKeys) {
      if (Array.isArray(data[k])) return data[k];
    }
    if (fallback) {
      for (const v of Object.values(data)) {
        if (Array.isArray(v)) return v;
      }
    }
  }
  return [];
}

function categoryId(c) {
  const id = c?.id ?? c?.category_id ?? c?.categoryId;
  return id === undefined || id === null || id === '' ? null : String(id).trim();
}

function categoryName(c) {
  return cleanText(c?.name ?? c?.title ?? c?.label ?? c?.category_name ?? '');
}

function flattenCategories(data) {
  const tops = findArray(data, ['categories', 'items', 'data', 'tree']);
  const out = [];
  const seen = new Set();

  const push = (c, parentName) => {
    const id = categoryId(c);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, name: categoryName(c) || id, parentName: parentName || '' });
  };

  for (const top of tops) {
    const subs = findArray(
      top,
      ['subcategories', 'sub_categories', 'subCategories', 'children', 'categories', 'items'],
      { fallback: false }
    );
    if (subs.length > 0) {
      if (INCLUDE_TOP_CATEGORIES) push(top, '');
      for (const sub of subs) push(sub, categoryName(top));
    } else {
      push(top, '');
    }
  }
  return out;
}

function toAbsoluteUrl(u, fallbackId) {
  const s = String(u || '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) return `${SITE_URL}${s}`;
  return fallbackId ? `${SITE_URL}/item/${fallbackId}` : SITE_URL;
}

function parseStockActive(p) {
  const raw = p?.in_stock ?? p?.inStock ?? p?.available ?? p?.stock ?? p?.availability;
  if (raw === undefined || raw === null) return true;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw > 0;
  const s = String(raw).trim().toLowerCase();
  return !(s === '' || s === '0' || s === 'false' || s === 'no' || /out|אזל|אין במלאי|unavailable/.test(s));
}

function normalizeProduct(p, category) {
  const id = p?.id ?? p?.product_id ?? p?.item_id;
  if (id === undefined || id === null || id === '') return null;

  const title = cleanText(p?.title ?? p?.name);
  if (!title) return null;

  const brandRaw = typeof p?.brand === 'object' ? p?.brand?.name : p?.brand;
  const brand = cleanText(brandRaw);
  const priceNum = p?.price === null || p?.price === undefined || p?.price === '' ? NaN : Number(p.price);
  const hasPrice = Number.isFinite(priceNum) && priceNum > 0;
  const priceNote = cleanText(p?.price_note ?? p?.priceNote ?? '');
  const rating = Number(p?.rating);

  const descParts = [];
  if (hasPrice) {
    descParts.push(`מחיר: ${priceNum} ₪`);
  } else {
    descParts.push(priceNote || 'המחיר מוצג לחברי מועדון בלבד');
  }
  if (Number.isFinite(rating) && rating > 0) descParts.push(`דירוג: ${rating}`);

  const shortDesc = cleanText(p?.description ?? p?.short_description ?? '').slice(0, 300);
  const categoryLabel = cleanText(p?.category?.name ?? p?.category ?? category.name);
  const keywords = [...new Set([categoryLabel, category.parentName, brand, title].map(cleanText).filter(Boolean))].join(' | ');

  return {
    external_id: `htzone_prod_${id}`,
    club_source: CLUB_SOURCE,
    benefit_type: 'catalog',
    is_active: parseStockActive(p),
    title,
    supplier_name: brand || 'הייטקזון',
    short_description: shortDesc || null,
    description: descParts.join(' | ') || null,
    terms_of_use: hasPrice ? null : priceNote || 'מחיר לחברי מועדון בלבד',
    search_keywords: keywords || null,
    url: toAbsoluteUrl(p?.url ?? p?.link, id),
  };
}

async function fetchAllActiveExternalIds() {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('club_benefits')
      .select('external_id')
      .eq('club_source', CLUB_SOURCE)
      .eq('is_active', true)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data.map((r) => r.external_id).filter(Boolean));
    if (data.length < PAGE) break;
  }
  return all;
}

async function deactivateStale(seenIds, hasErrors) {
  if (hasErrors) {
    console.warn('⚠️ דילוג על כיבוי רשומות ישנות: היו שגיאות בשליפה.');
    return 0;
  }

  let existing;
  try {
    existing = await fetchAllActiveExternalIds();
  } catch (err) {
    console.warn('⚠️ אזהרה בבדיקת רשומות פעילות קיימות:', err.message);
    return 0;
  }
  if (existing.length === 0) return 0;

  if (seenIds.size < existing.length * MIN_KEEP_RATIO) {
    console.warn(
      `⚠️ דילוג על כיבוי: נמצאו ${seenIds.size} רשומות לעומת ${existing.length} פעילות קיימות (סף ${Math.round(
        MIN_KEEP_RATIO * 100
      )}%). בדוק אם ה-MCP החזיר תוצאות חלקיות.`
    );
    return 0;
  }

  const staleIds = existing.filter((id) => !seenIds.has(id));
  const BATCH = 200;
  let deactivated = 0;
  for (let i = 0; i < staleIds.length; i += BATCH) {
    const chunk = staleIds.slice(i, i + BATCH);
    const { error } = await supabase
      .from('club_benefits')
      .update({ is_active: false })
      .eq('club_source', CLUB_SOURCE)
      .in('external_id', chunk);
    if (error) console.warn(`⚠️ אזהרה בכיבוי (batch ${i}):`, error.message);
    else deactivated += chunk.length;
  }
  if (deactivated > 0) console.log(`🔕 סומנו כלא אקטיביות: ${deactivated} הטבות שהוסרו מהקטלוג`);
  return deactivated;
}

async function syncHtzone() {
  console.log(`🚀 מתחיל סנכרון הייטקזון (htzone) | ${DRY_RUN ? 'DRY RUN (בלי כתיבה ל-DB)' : 'כתיבה ל-DB'}`);

  const init = await initMcp();
  console.log(`✅ חיבור ל-MCP: ${init?.serverInfo?.name || 'htzone'} v${init?.serverInfo?.version || '?'}`);

  const categoriesRaw = await callTool('list_categories');
  debugLog('list_categories (גולמי)', categoriesRaw);
  const categories = flattenCategories(categoriesRaw).slice(0, MAX_CATEGORIES);
  if (categories.length === 0) {
    throw new Error('לא נמצאו קטגוריות. הרץ עם HTZ_DEBUG=true ובדוק את מבנה התשובה של list_categories.');
  }
  console.log(`📂 נמצאו ${categories.length} קטגוריות לסריקה`);

  const rowsById = new Map();
  let hasErrors = false;
  let firstProductLogged = false;

  for (const category of categories) {
    let added = 0;
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await callTool('list_category_products', { category_id: Number(category.id), page });
        const products = findArray(data, ['products', 'items', 'results', 'data']);
        if (products.length === 0) break;

        if (DEBUG && !firstProductLogged) {
          firstProductLogged = true;
          debugLog('מוצר ראשון (גולמי)', products[0]);
        }

        let newInPage = 0;
        for (const p of products) {
          const row = normalizeProduct(p, category);
          if (!row || rowsById.has(row.external_id)) continue;
          rowsById.set(row.external_id, row);
          newInPage++;
          added++;
        }

        if (products.length < 20 || newInPage === 0) break;
        if (FETCH_DELAY_MS > 0) await sleep(FETCH_DELAY_MS);
      }
      if (added > 0) console.log(`  🛒 ${category.parentName ? category.parentName + ' / ' : ''}${category.name} (${category.id}): נוספו ${added}`);
    } catch (err) {
      hasErrors = true;
      console.warn(`⚠️ דילוג על קטגוריה ${category.name} (${category.id}): ${err.message}`);
    }
    if (FETCH_DELAY_MS > 0) await sleep(FETCH_DELAY_MS);
  }

  const rows = [...rowsById.values()];
  const activeCount = rows.filter((r) => r.is_active).length;
  console.log(`📊 סיכום שליפה: ${rows.length} מוצרים (${activeCount} פעילים), שגיאות: ${hasErrors ? 'כן' : 'לא'}`);

  if (rows.length === 0) throw new Error('לא נמצאו מוצרים תקינים לסנכרון עבור htzone');

  if (DRY_RUN) {
    console.log('🧪 DRY RUN: דוגמה ל-3 שורות ראשונות:');
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));
    return;
  }

  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await withRetry(async () => {
      const { error } = await supabase.from('club_benefits').upsert(batch, { onConflict: 'external_id' });
      if (error) throw new Error(`שגיאה ב-upsert ל-club_benefits (batch ${i}): ${error.message}`);
    }, 3, 500);

    if ((i / BATCH_SIZE + 1) % 25 === 0 || i + BATCH_SIZE >= rows.length) {
      console.log(`  💾 הועלו ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length} שורות...`);
    }
  }

  const deactivated = await deactivateStale(new Set(rowsById.keys()), hasErrors);

  const { error: countErr } = await supabase
    .from('global_clubs')
    .update({ synced_items_count: activeCount })
    .eq('club_key', CLUB_SOURCE);
  if (countErr) console.warn('⚠️ אזהרה בעדכון synced_items_count ב-global_clubs:', countErr.message);

  console.log(`✅ סנכרון htzone הושלם: ${activeCount} הטבות פעילות (${rows.length} סה"כ עובדו, ${deactivated} כובו).`);
}

syncHtzone().catch((err) => {
  console.error('❌ שגיאה בסנכרון htzone:', err.message);
  process.exit(1);
});