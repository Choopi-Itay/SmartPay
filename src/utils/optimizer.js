export const getDaysUntilExpiry = (expiryDateStr) => {
  if (!expiryDateStr) return Infinity;
  const expiry = new Date(expiryDateStr);
  const today = new Date();
  const diffTime = expiry - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// המרת מזהי UUID לשמות מותגים קריאים מתוך availableBrands
const resolveItemBrands = (rawBrands = [], availableBrands = []) => {
  return rawBrands
    .map(b => {
      if (!b) return null;
      const found = availableBrands.find(ab => String(ab.id) === String(b) || ab.name === b);
      return found ? found.name : String(b);
    })
    .filter(Boolean);
};

// איחוד רשומות מועדון שחולקות את אותו ארנק/שובר למניעת ספירה כפולה של תקרת הטעינה (monthly_limit)
const deduplicateClubWallets = (clubWallets = [], cleanInput = '') => {
  if (!Array.isArray(clubWallets) || clubWallets.length === 0) return [];

  const sortedByExactMatch = [...clubWallets].sort((a, b) => {
    const aExact = (a.title || '').trim().toLowerCase() === cleanInput ? 1 : 0;
    const bExact = (b.title || '').trim().toLowerCase() === cleanInput ? 1 : 0;
    if (bExact !== aExact) return bExact - aExact;
    return Number(b.discount_percent || 0) - Number(a.discount_percent || 0);
  });

  const grouped = new Map();

  for (const club of sortedByExactMatch) {
    const sourceKey = (club.club_source || 'histadrut').trim().toLowerCase();
    const walletKey = (club.wallet_name || club.title || String(club.id)).trim().toLowerCase();
    const compositeKey = `${sourceKey}::${walletKey}`;

    if (!grouped.has(compositeKey)) {
      grouped.set(compositeKey, { ...club });
    }
  }

  return Array.from(grouped.values()).sort(
    (a, b) => Number(b.discount_percent || 0) - Number(a.discount_percent || 0)
  );
};

const BALANCE_ITEM_TYPES = ['Voucher', 'GiftCard', 'StoreCredit'];

const buildSingleStrategy = ({
  id,
  label,
  subtitle,
  walletState,
  numAmount,
  cleanInput,
  clubWallets,
  availableBrands = [],
  useExistingVouchers = true,
  useClubWallets = true,
}) => {
  let remaining = numAmount;
  let totalSavings = 0;
  const plan = [];

  const validVouchers = useExistingVouchers
    ? walletState.filter(item => {
        if (!BALANCE_ITEM_TYPES.includes(item.type) || item.balance <= 0 || item.isLocked) {
          return false;
        }

        const resolvedBrands = resolveItemBrands(item.applicableBrands || [], availableBrands);
        const isGeneral = resolvedBrands.includes('כללי');

        if (!isGeneral) {
          if (resolvedBrands.length === 0 || !cleanInput) return false;
          const isMatch = resolvedBrands.some(b => {
            const cleanBrand = (b || '').trim().toLowerCase();
            return cleanInput === cleanBrand;
          });
          if (!isMatch) return false;
        }

        return getDaysUntilExpiry(item.expiryDate) > 0;
      })
    : [];

  const expiringItems = [];
  const storeCredits = [];
  const brandVouchers = [];
  const generalVouchers = [];

  for (const v of validVouchers) {
    const days = getDaysUntilExpiry(v.expiryDate);
    const resolvedBrands = resolveItemBrands(v.applicableBrands || [], availableBrands);
    const isGeneral = resolvedBrands.includes('כללי');

    if (days <= 30) {
      expiringItems.push(v);
    } else if (v.type === 'StoreCredit') {
      storeCredits.push(v);
    } else if (!isGeneral) {
      brandVouchers.push(v);
    } else {
      generalVouchers.push(v);
    }
  }

  const sortByExpiryThenBalance = (a, b) => {
    const expDiff = getDaysUntilExpiry(a.expiryDate) - getDaysUntilExpiry(b.expiryDate);
    if (expDiff !== 0) return expDiff;
    return a.balance - b.balance;
  };

  const sortByDiscountAndExpiry = (a, b) => {
    if ((b.discount || 0) !== (a.discount || 0)) return (b.discount || 0) - (a.discount || 0);
    return getDaysUntilExpiry(a.expiryDate) - getDaysUntilExpiry(b.expiryDate);
  };

  expiringItems.sort(sortByExpiryThenBalance);
  storeCredits.sort(sortByExpiryThenBalance);
  brandVouchers.sort(sortByDiscountAndExpiry);
  generalVouchers.sort(sortByDiscountAndExpiry);

  const applyBalanceItemList = (list) => {
    for (const item of list) {
      if (remaining <= 0) break;
      const useAmount = Math.min(remaining, item.balance);
      const savings = useAmount * ((item.discount || 0) / 100);

      plan.push({
        id: item.id,
        name: item.name,
        amount: useAmount,
        savings: savings,
        type: item.type,
        code: item.code,
        daysLeft: getDaysUntilExpiry(item.expiryDate),
        action: item.type === 'StoreCredit' ? 'ממש זיכוי בקופה' : 'סרוק ברקוד בקופה',
      });

      totalSavings += savings;
      remaining -= useAmount;
    }
  };

  // 1. פריטים שפגים תוך 30 יום
  applyBalanceItemList(expiringItems);

  // 2. זיכויים מחנות
  applyBalanceItemList(storeCredits);

  // 3. שוברים וגיפט-קארדים ייעודיים לרשת
  applyBalanceItemList(brandVouchers);

  // 4. ארנקי מועדון (מאוחדים למניעת ספירה כפולה של תקרת הטעינה החודשית)
  const uniqueClubWallets = deduplicateClubWallets(clubWallets, cleanInput);

  if (useClubWallets && remaining > 0 && uniqueClubWallets.length > 0) {
    for (const club of uniqueClubWallets) {
      if (remaining <= 0) break;
      const discountPct = Number(club.discount_percent || 0);
      if (discountPct <= 0) continue;

      const limitNum = Number(club.monthly_limit);
      const maxAllowed = limitNum > 0 ? limitNum : Infinity;
      const useAmount = Math.min(remaining, maxAllowed);

      if (useAmount > 0) {
        const savings = useAmount * (discountPct / 100);
        const clubLabel = club.wallet_name || club.club_source || 'מועדון צרכנות';

        plan.push({
          id: `club_${club.id}`,
          name: `${club.title} (${clubLabel})`,
          walletName: club.wallet_name,
          discountPercent: discountPct,
          monthlyLimit: limitNum > 0 ? limitNum : null,
          redimType: club.redim_type,
          amount: useAmount,
          actualPay: useAmount - savings,
          savings: savings,
          type: 'ClubWallet',
          action: `טען ארנק ב-${clubLabel}`,
        });

        totalSavings += savings;
        remaining -= useAmount;
      }
    }
  }

  // 5. שוברים כלליים
  applyBalanceItemList(generalVouchers);

  // 6. השלמת יתרה בכרטיס אשראי
  if (remaining > 0) {
    const activeCards = walletState
      .filter(item => item.type === 'CreditCard' && !item.isLocked)
      .sort((a, b) => (b.discount || 0) - (a.discount || 0));

    const bestCard = activeCards[0];
    if (bestCard) {
      const savings = remaining * ((bestCard.discount || 0) / 100);
      plan.push({
        id: bestCard.id,
        name: bestCard.name,
        amount: remaining,
        savings: savings,
        type: bestCard.type,
        action: 'פתח ב-Google Pay / Apple Pay',
      });
      totalSavings += savings;
      remaining = 0;
    }
  }

  return {
    id,
    label,
    subtitle,
    totalAmount: numAmount,
    totalSavings,
    effectiveDiscount: ((totalSavings / numAmount) * 100).toFixed(1),
    plan,
  };
};

export const runOptimization = (
  walletState,
  targetAmountStr,
  currentStore,
  clubWallets = [],
  availableBrands = []
) => {
  const numAmount = parseFloat((targetAmountStr || '').toString().trim());
  if (isNaN(numAmount) || numAmount <= 0) return null;

  const cleanInput = (currentStore || '').trim().toLowerCase();

  const primaryStrategy = buildSingleStrategy({
    id: 'optimal',
    label: '⚡ מסלול מומלץ',
    subtitle: 'ניצול זיכויים, שוברים והנחות מועדון',
    walletState,
    numAmount,
    cleanInput,
    clubWallets,
    availableBrands,
    useExistingVouchers: true,
    useClubWallets: true,
  });

  const strategies = [primaryStrategy];
  const usedBalanceItems = primaryStrategy.plan.some(p => BALANCE_ITEM_TYPES.includes(p.type));
  const usedClub = primaryStrategy.plan.some(p => p.type === 'ClubWallet');
  const hasActiveWalletAlternative = walletState.some(
    item => !item.isLocked && (item.type === 'CreditCard' || item.balance > 0)
  );

  if (usedBalanceItems && clubWallets.length > 0) {
    strategies.push(
      buildSingleStrategy({
        id: 'club_only',
        label: '🛡️ שמור זיכויים/שוברים',
        subtitle: 'משאיר יתרות בארנק ומשתמש רק בהנחת מועדון',
        walletState,
        numAmount,
        cleanInput,
        clubWallets,
        availableBrands,
        useExistingVouchers: false,
        useClubWallets: true,
      })
    );
  } else if (usedClub && hasActiveWalletAlternative) {
    strategies.push(
      buildSingleStrategy({
        id: 'direct_wallet',
        label: '💳 ללא טעינת מועדון',
        subtitle: 'תשלום ישיר באשראי / יתרות קיימות בלבד',
        walletState,
        numAmount,
        cleanInput,
        clubWallets: [],
        availableBrands,
        useExistingVouchers: true,
        useClubWallets: false,
      })
    );
  }

  return {
    ...primaryStrategy,
    strategies,
  };
};