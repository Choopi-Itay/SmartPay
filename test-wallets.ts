import { chromium } from 'playwright';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const PROFILE_PATH = path.join(__dirname, 'profile');
const BASE_URL = 'https://www.hist.org.il/';
const API_URL = 'https://server.hist.org.il/api';

async function testWallets() {
  const ctx = await chromium.launchPersistentContext(PROFILE_PATH, {
    channel: 'chrome',
    headless: false, // שים true אם אתה לא רוצה שפתח דפדפן פיזי
    locale: 'he-IL',
  });

  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // שליפה ישירה של הארנקים באמצעות ה-Session הקיים בדפדפן
    const result = await page.evaluate(async (api) => {
      const H = { organizationid: '48' };
      
      const generalRes = await fetch(api + '/cards/GetCardGeneralInfo', { headers: H, credentials: 'include' });
      const generalData = await generalRes.json();
      const wallets = generalData?.data?.wallets || [];

      const details = [];
      for (const w of wallets) {
        const chainRes = await fetch(api + '/cards/GetWalletChain?walletId=' + w.walletID, { headers: H, credentials: 'include' });
        const chainData = await chainRes.json();
        
        details.push({
          walletID: w.walletID,
          walletName: w.walletName,
          discountRate: w.discountRate,
          maxDepositForMonth: w.maxDepositForMonth, // <-- כאן נראה את התקרה
          walletBalance: w.walletBalance,
          chainsCount: chainData?.data ? chainData.data.length : 0,
          rawChainsSample: chainData?.data?.[0]?.walletChainData?.slice(0, 2) || []
        });
      }
      return details;
    }, API_URL);

    console.log('--- תוצאות בדיקת ארנקים מה-API ---');
    console.dir(result, { depth: null });

  } catch (e) {
    console.error('שגיאה בבדיקה:', e);
  } finally {
    await ctx.close();
  }
}

testWallets();