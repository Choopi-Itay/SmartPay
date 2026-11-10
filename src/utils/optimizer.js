export const getDaysUntilExpiry = (expiryDateStr) => {
  if (!expiryDateStr) return Infinity;
  const expiry = new Date(expiryDateStr);
  const today = new Date();
  const diffTime = expiry - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

export const runOptimization = (walletState, targetAmountStr, currentStore) => {
  const numAmount = parseFloat(targetAmountStr.trim());
  if (isNaN(numAmount) || numAmount <= 0) return null;

  let remaining = numAmount;
  let totalSavings = 0;
  const plan = [];
  const cleanInput = (currentStore || '').trim().toLowerCase();

  const sortedVouchers = walletState
    .filter(item => {
      if (item.type !== 'Voucher' || item.balance <= 0 || item.isLocked) return false;

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
    .sort((a, b) => {
      const daysA = getDaysUntilExpiry(a.expiryDate);
      const daysB = getDaysUntilExpiry(b.expiryDate);
      const isCriticalA = daysA <= 30;
      const isCriticalB = daysB <= 30;

      if (isCriticalA && !isCriticalB) return -1;
      if (!isCriticalA && isCriticalB) return 1;
      if (isCriticalA && isCriticalB) {
        if (daysA !== daysB) return daysA - daysB;
        return b.discount - a.discount;
      }
      if (b.discount !== a.discount) return b.discount - a.discount;
      return daysA - daysB;
    });

  for (const voucher of sortedVouchers) {
    if (remaining <= 0) break;
    const useAmount = Math.min(remaining, voucher.balance);
    const savings = useAmount * (voucher.discount / 100);

    plan.push({
      id: voucher.id,
      name: voucher.name,
      amount: useAmount,
      savings: savings,
      type: voucher.type,
      code: voucher.code,
      daysLeft: getDaysUntilExpiry(voucher.expiryDate),
      action: 'סרוק ברקוד בקופה',
    });

    totalSavings += savings;
    remaining -= useAmount;
  }

  if (remaining > 0) {
    const bestCard = walletState.find(item => item.type === 'CreditCard' && !item.isLocked);
    if (bestCard) {
      const savings = remaining * (bestCard.discount / 100);
      plan.push({
        id: bestCard.id,
        name: bestCard.name,
        amount: remaining,
        savings: savings,
        type: bestCard.type,
        action: 'פתח ב-Google Pay / Apple Pay',
      });
      totalSavings += savings;
    }
  }

  return {
    totalAmount: numAmount,
    totalSavings: totalSavings,
    effectiveDiscount: ((totalSavings / numAmount) * 100).toFixed(1),
    plan: plan,
  };
};