import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PROFILE_PATH = path.join(__dirname, 'profile');
const BASE_URL = 'https://www.hist.org.il/';
const API_URL = 'https://server.hist.org.il/api';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface LeafBenefit {
  categoryId: number;
  categoryName: string;
  supplierName: string | null;
  shortDescription: string | null;
  description: string | null;
  termsOfUse: string | null;
  redimType: string | null;
  categoryHTML: string | null;
  remarks: string | null;
  paths: string[];
}

interface WalletChainItem {
  walletID: string;
  walletName: string;
  discountRate: number;
  walletBalance: number;
  loadedThisMonth: string;
  maxDepositForMonth: number;
  maxAmountToLoad: number;
  chainID: string;
  chainName: string;
  logoURL: string | null;
  searchKeyWords: string | null;
  isWebOnline: boolean;
  webSite: string | null;
  tags: string[];
}

async function notify(msg: string) {
  console.log(`[HIST CRAWLER] ${msg}`);
  const topic = process.env.NTFY_TOPIC;
  if (topic) {
    try {
      await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body: msg });
    } catch (e) {
      console.error('ntfy alert failed:', e);
    }
  }
}

async function runCrawl() {
  const ctx = await chromium.launchPersistentContext(PROFILE_PATH, {
    channel: 'chrome',
    headless: true,
    locale: 'he-IL',
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    page.setDefaultTimeout(180000);

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // 1. בדיקת תקינות סשן
    const checkScript = `
      (async (api) => {
        const H = { organizationid: '48' };
        const u = await fetch(api + '/users/getCurrentUser', { headers: H, credentials: 'include' });
        let loggedIn = false;
        if (u.ok) {
          try {
            const j = await u.json();
            loggedIn = !!(j && j.data);
          } catch {}
        }
        const h = await fetch(api + '/category/GetCategoryHeader', { headers: H, credentials: 'include' });
        return { userStatus: u.status, loggedIn, headerStatus: h.status };
      })(${JSON.stringify(API_URL)})
    `;

    const sessionCheck = await page.evaluate(checkScript) as {
      userStatus: number;
      loggedIn: boolean;
      headerStatus: number;
    };

    if (sessionCheck.userStatus === 401 || sessionCheck.userStatus === 403 || !sessionCheck.loggedIn) {
      await notify('הסשן של "ביחד בשבילך" פג. יש להריץ: npm run login:hist');
      await ctx.close();
      process.exit(2);
    }

    console.log('הסשן תקין. מתחיל בסריקת ההטבות והארנקים הדיגיטליים...');

    // 2. סריקת קטלוג + ארנקים דיגיטליים (מועבר כמחרוזת למניעת הזרקת __name של tsx)
    const crawlScript = `
      (async (api) => {
        const H = { organizationid: '48' };
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        const txt = (s) => {
          if (!s) return '';
          const d = new DOMParser().parseFromString(s.replace(/<(br|\\\/div|\\\/p|\\\/li)\\s*\\\/?>/gi, '\\n'), 'text/html');
          return (d.body.textContent || '')
            .replace(/\\u00a0/g, ' ')
            .replace(/[ \\t]+/g, ' ')
            .replace(/\\n\\s*\\n+/g, '\\n')
            .trim();
        };

        const KEEP = [
          'categoryId', 'categoryName', 'parentId', 'supplierName', 'businessId',
          'categoryType', 'description', 'shortDescription', 'categoryHTML',
          'termsOfUse', 'redimType', 'remarks', 'isLeaf'
        ];
        const HTML_FIELDS = ['shortDescription', 'categoryHTML', 'termsOfUse', 'redimType', 'remarks'];

        const pick = (o) =>
          Object.fromEntries(
            KEEP.map((k) => [k, HTML_FIELDS.includes(k) ? txt(o[k]) : (o[k] ?? null)])
          );

        const apiFetch = async (url, tries = 3) => {
          for (let i = 0; i < tries; i++) {
            try {
              const r = await fetch(url, { headers: H, credentials: 'include' });
              if (r.ok) return (await r.json()).data;
              if (r.status === 401 || r.status === 403) throw new Error('AUTH ' + r.status);
            } catch (e) {
              if (String(e.message).startsWith('AUTH')) throw e;
            }
            await sleep(800 * (i + 1));
          }
          return null;
        };

        // חלק א': סריקת עץ הקטגוריות
        const header = await apiFetch(api + '/category/GetCategoryHeader');
        if (!header) throw new Error('NO_HEADER');

        const leaves = {};
        const visited = new Set();
        const queue = header.map((h) => ({
          id: h.categoryId,
          path: [h.categoryName]
        }));

        const worker = async () => {
          while (true) {
            const item = queue.shift();
            if (!item) {
              await sleep(1500);
              if (!queue.length) return;
              continue;
            }
            if (visited.has(item.id)) continue;
            visited.add(item.id);

            const node = await apiFetch(api + '/category/GetCategoryById?categoryId=' + item.id);
            if (!node) continue;

            const subs = node.subCategories || [];
            if (!subs.length) {
              (leaves[node.categoryId] ??= { ...pick(node), paths: [] }).paths.push(item.path.join(' > '));
            }
            for (const s of subs) {
              const p = [...item.path, s.categoryName];
              if (s.isLeaf) {
                (leaves[s.categoryId] ??= { ...pick(s), paths: [] }).paths.push(p.join(' > '));
              } else if (!visited.has(s.categoryId)) {
                queue.push({ id: s.categoryId, path: p });
              }
            }
            await sleep(250);
          }
        };

        await Promise.all([worker(), worker(), worker(), worker()]);

        // חלק ב': סריקת הארנקים הדיגיטליים והרשתות המכבדות
        const walletChainsMap = {};
        const generalInfo = await apiFetch(api + '/cards/GetCardGeneralInfo');
        const wallets = generalInfo?.wallets || [];

        for (const w of wallets) {
          const tagGroups = await apiFetch(api + '/cards/GetWalletChain?walletId=' + w.walletID);
          if (!Array.isArray(tagGroups)) continue;

          for (const group of tagGroups) {
            const tagName = (group.tagName || '').trim();
            const chains = group.walletChainData || [];

            for (const c of chains) {
              if (!c.chainID || !c.chainName) continue;
              const key = w.walletID + '_' + c.chainID;

              if (!walletChainsMap[key]) {
                walletChainsMap[key] = {
                  walletID: String(w.walletID),
                  walletName: (w.walletName || '').trim(),
                  discountRate: Number(w.discountRate || 0),
                  walletBalance: Number(w.walletBalance || 0),
                  loadedThisMonth: String(w.loadedThisMonth || '0'),
                  maxDepositForMonth: Number(w.maxDepositForMonth || 0),
                  maxAmountToLoad: Number(w.maxAmountToLoad || 0),
                  chainID: String(c.chainID),
                  chainName: c.chainName.trim(),
                  logoURL: c.logoURL ? c.logoURL.trim() : null,
                  searchKeyWords: c.searchKeyWords ? c.searchKeyWords.trim() : null,
                  isWebOnline: Boolean(c.isWebOnline),
                  webSite: c.webSite ? c.webSite.trim() : null,
                  tags: tagName ? [tagName] : []
                };
              } else if (tagName && !walletChainsMap[key].tags.includes(tagName)) {
                walletChainsMap[key].tags.push(tagName);
              }
            }
          }
          await sleep(200);
        }

        return {
          leaves,
          walletChains: Object.values(walletChainsMap),
          walletsCount: wallets.length
        };
      })(${JSON.stringify(API_URL)})
    `;

    const crawlResult = await page.evaluate(crawlScript) as {
      leaves: Record<string, LeafBenefit>;
      walletChains: WalletChainItem[];
      walletsCount: number;
    };

    await ctx.close();

    const catalogItems: LeafBenefit[] = Object.values(crawlResult.leaves);
    const walletItems: WalletChainItem[] = crawlResult.walletChains;

    console.log(
      `נסרקו ${catalogItems.length} הטבות קטלוג ו-${walletItems.length} רשתות מתוך ${crawlResult.walletsCount} ארנקים דיגיטליים.`
    );

    const nowIso = new Date().toISOString();

    // 3א. מיפוי הטבות הקטלוג הרגיל
    const catalogPayload = catalogItems.map((item) => ({
      club_source: 'histadrut',
      external_id: String(item.categoryId),
      benefit_type: 'catalog',
      title: item.categoryName,
      supplier_name: item.supplierName || null,
      short_description: item.shortDescription || null,
      description: item.description || item.categoryHTML || null,
      terms_of_use: item.termsOfUse || null,
      redim_type: item.redimType || null,
      discount_percent: null,
      wallet_id: null,
      wallet_name: null,
      wallet_balance: null,
      max_amount_to_load: null,
      logo_url: null,
      website: null,
      search_keywords: item.paths.join(' | ') || null,
      url: `https://www.hist.org.il/category/products/${item.categoryId}`,
      is_active: true,
      updated_at: nowIso,
    }));

    // 3ב. מיפוי רשתות הארנקים הדיגיטליים (נתוני מועדון כלליים בלבד)
    const walletPayload = walletItems.map((w) => ({
      club_source: 'histadrut',
      external_id: `wallet_${w.walletID}_${w.chainID}`,
      benefit_type: 'wallet',
      title: w.chainName,
      supplier_name: w.chainName,
      short_description: `${w.discountRate}% הנחה בטעינת ארנק (${w.walletName})`,
      description: [
        `ארנק: ${w.walletName}`,
        `אחוז הנחה: ${w.discountRate}%`,
        w.maxDepositForMonth ? `תקרת טעינה חודשית במועדון: ${w.maxDepositForMonth} ₪` : '',
        w.tags.length ? `קטגוריות: ${w.tags.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      terms_of_use: w.maxDepositForMonth
        ? `תקרת טעינה חודשית במועדון: ${w.maxDepositForMonth} ₪`
        : null,
      redim_type: w.isWebOnline ? 'ארנק דיגיטלי (סניפים ואונליין)' : 'ארנק דיגיטלי (סניפים)',
      discount_percent: w.discountRate,
      wallet_id: w.walletID,
      wallet_name: w.walletName,
      monthly_limit: w.maxDepositForMonth || null,
      logo_url: w.logoURL,
      website: w.webSite,
      search_keywords: [w.searchKeyWords, ...w.tags].filter(Boolean).join(', ') || null,
      url: 'https://www.hist.org.il/',
      is_active: true,
      updated_at: nowIso,
    }));

    const fullPayload = [...catalogPayload, ...walletPayload];

    // 4. Upsert במנות של 100 רשומות
    const BATCH_SIZE = 100;
    for (let i = 0; i < fullPayload.length; i += BATCH_SIZE) {
      const batch = fullPayload.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('club_benefits')
        .upsert(batch, { onConflict: 'club_source,external_id' });

      if (error) {
        console.error('שגיאה בעדכון מנה ב-Supabase:', error);
      }
    }

    await notify(
      `סנכרון "ביחד בשבילך" הושלם! עודכנו ${catalogPayload.length} הטבות קטלוג + ${walletPayload.length} רשתות ארנקים ב-Supabase.`
    );
  } catch (err: any) {
    await ctx.close();
    await notify(`כשל בהרצת הסורק: ${err.message}`);
    process.exit(3);
  }
}

runCrawl();