export const getDaysUntilExpiry = (expiryDateStr) => {
  if (!expiryDateStr) return Infinity;
  const expiry = new Date(expiryDateStr);
  const today = new Date();
  const diffTime = expiry - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const buildSingleStrategy = ({
  id,
  label,
  subtitle,
  walletState,
  numAmount,
  cleanInput,
  clubWallets,
  useExistingVouchers = true,
  useClubWallets = true,
}) => {
  let remaining = numAmount;
  let totalSavings = 0;
  const plan = [];

  const validVouchers = useExistingVouchers
    ? walletState.filter(item => {
        if ((item.type !== 'Voucher' && item.type !== 'GiftCard') || item.balance <= 0 || item.isLocked) {
          return false;
        }

        const brands = item.applicableBrands || [];
        const isGeneral = brands.includes('כללי');

        if (!isGeneral) {
          if (brands.length === 0 || !cleanInput) return false;
          const inputWords = cleanInput.split(/\s+/);
          const isMatch = brands.some(b => {
            const cleanBrand = (b || '').trim().toLowerCase();
            return cleanInput === cleanBrand || inputWords.includes(cleanBrand);
          });
          if (!isMatch) return false;
        }

        return getDaysUntilExpiry(item.expiryDate) > 0;
      })
    : [];

  const expiringVouchers = [];
  const brandVouchers = [];
  const generalVouchers = [];

  for (const v of validVouchers) {
    const days = getDaysUntilExpiry(v.expiryDate);
    const isGeneral = (v.applicableBrands || []).includes('כללי');
    if (days <= 30) expiringVouchers.push(v);
    else if (!isGeneral) brandVouchers.push(v);
    else generalVouchers.push(v);
  }

  const sortByDiscountAndExpiry = (a, b) => {
    if (b.discount !== a.discount) return b.discount - a.discount;
    return getDaysUntilExpiry(a.expiryDate) - getDaysUntilExpiry(b.expiryDate);
  };

  expiringVouchers.sort((a, b) => getDaysUntilExpiry(a.expiryDate) - getDaysUntilExpiry(b.expiryDate));
  brandVouchers.sort(sortByDiscountAndExpiry);
  generalVouchers.sort(sortByDiscountAndExpiry);

  const applyVoucherList = (list) => {
    for (const voucher of list) {
      if (remaining <= 0) break;
      const useAmount = Math.min(remaining, voucher.balance);
      const savings = useAmount * ((voucher.discount || 0) / 100);

      plan.push({
        id: voucher.id,
        name: voucher.name,
        amount: useAmount,
        savings: savings,
        type: 'Voucher',
        code: voucher.code,
        daysLeft: getDaysUntilExpiry(voucher.expiryDate),
        action: 'סרוק ברקוד בקופה',
      });

      totalSavings += savings;
      remaining -= useAmount;
    }
  };

  // 1. שוברים שפגים בקרוב + שוברים ייעודיים לרשת
  applyVoucherList(expiringVouchers);
  applyVoucherList(brandVouchers);

  // 2. ארנקי מועדון (מוגבלים לפי תקרת הטעינה החודשית - monthly_limit)
  if (useClubWallets && remaining > 0 && Array.isArray(clubWallets) && clubWallets.length > 0) {
    for (const club of clubWallets) {
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

  // 3. שוברים כלליים
  applyVoucherList(generalVouchers);

  // 4. השלמת יתרה בכרטיס אשראי
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

export const runOptimization = (walletState, targetAmountStr, currentStore, clubWallets = []) => {
  const numAmount = parseFloat((targetAmountStr || '').toString().trim());
  if (isNaN(numAmount) || numAmount <= 0) return null;

  const cleanInput = (currentStore || '').trim().toLowerCase();

  const primaryStrategy = buildSingleStrategy({
    id: 'optimal',
    label: '⚡ מסלול מומלץ',
    subtitle: 'מקסימום חיסכון כולל מועדון ויתרות קיימות',
    walletState,
    numAmount,
    cleanInput,
    clubWallets,
    useExistingVouchers: true,
    useClubWallets: true,
  });

  const strategies = [primaryStrategy];
  const usedVouchers = primaryStrategy.plan.some(p => p.type === 'Voucher');
  const usedClub = primaryStrategy.plan.some(p => p.type === 'ClubWallet');
  const hasActiveWalletAlternative = walletState.some(
    item => !item.isLocked && (item.type === 'CreditCard' || item.balance > 0)
  );

  if (usedVouchers && clubWallets.length > 0) {
    strategies.push(
      buildSingleStrategy({
        id: 'club_only',
        label: '🛡️ שמור שוברים',
        subtitle: 'משאיר שוברים בארנק ומשתמש רק בהנחת מועדון',
        walletState,
        numAmount,
        cleanInput,
        clubWallets,
        useExistingVouchers: false,
        useClubWallets: true,
      })
    );
  } else if (usedClub && hasActiveWalletAlternative) {
    strategies.push(
      buildSingleStrategy({
        id: 'direct_wallet',
        label: '💳 ללא טעינת מועדון',
        subtitle: 'תשלום ישיר באשראי / שוברים קיימים בלבד',
        walletState,
        numAmount,
        cleanInput,
        clubWallets: [],
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