import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, Text, View, TouchableOpacity, TextInput, ScrollView, 
  Alert, Keyboard, Modal, ActivityIndicator, Linking 
} from 'react-native';
import { runOptimization, getDaysUntilExpiry } from '../utils/optimizer';
import { 
  searchClubChains, 
  findWalletPaymentBenefits, 
  findCatalogPromotions 
} from '../services/clubBenefits';

export default function CheckoutScreen({ 
  userWallet, availableBrands, hasHistadrut = true, onToggleLock, onConfirmPurchase 
}) {
  const [storeName, setStoreName] = useState('');
  const [amount, setAmount] = useState('');
  const [recommendation, setRecommendation] = useState(null);
  const [selectedStrategyIndex, setSelectedStrategyIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);

  // רשתות להשלמה אוטומטית מהמועדון
  const [clubChainSuggestions, setClubChainSuggestions] = useState([]);

  // הפרדה בין שיטות תשלום (ארנקים) לבין מבצעי מוצר (קטלוג)
  const [walletBenefits, setWalletBenefits] = useState([]);
  const [excludedClubIds, setExcludedClubIds] = useState([]);
  const [catalogPromotions, setCatalogPromotions] = useState([]);
  const [showPromotions, setShowPromotions] = useState(false);
  const [loadingClubData, setLoadingClubData] = useState(false);

  // סטייט למודאל ברקוד במחשבון הקופה
  const [barcodeModalVisible, setBarcodeModalVisible] = useState(false);
  const [selectedItemForBarcode, setSelectedItemForBarcode] = useState(null);

  // המרת מזהי UUID / קודים לשמות מותגים קריאים מתוך availableBrands
  const resolveBrandNames = (rawBrands) => {
    if (!Array.isArray(rawBrands) || rawBrands.length === 0) return 'כללי / לא מוגדר';
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const cleanNames = rawBrands
      .map(b => {
        if (!b) return null;
        const found = availableBrands.find(ab => String(ab.id) === String(b) || ab.name === b);
        if (found) return found.name;
        if (uuidRegex.test(String(b))) return null;
        return String(b);
      })
      .filter(Boolean);

    return cleanNames.length > 0 ? [...new Set(cleanNames)].join(', ') : 'כללי';
  };

  const getActiveClubWallets = (walletsList = walletBenefits, excludedList = excludedClubIds) => {
    if (!hasHistadrut) return [];
    return walletsList.filter(b => !excludedList.includes(`club_${b.id}`));
  };

  useEffect(() => {
    if (recommendation && storeName && amount && parseFloat(amount) > 0) {
      const res = runOptimization(userWallet, amount, storeName, getActiveClubWallets());
      setRecommendation(res);
      setSelectedStrategyIndex(0);
    }
  }, [userWallet, walletBenefits, hasHistadrut, excludedClubIds]);

  useEffect(() => {
    const query = storeName.trim();
    setExcludedClubIds([]);

    if (!hasHistadrut || query.length < 2) {
      setClubChainSuggestions([]);
      setWalletBenefits([]);
      setCatalogPromotions([]);
      setShowPromotions(false);
      return;
    }

    let isActive = true;
    const timer = setTimeout(async () => {
      setLoadingClubData(true);
      try {
        const [chains, wallets, promos] = await Promise.all([
          searchClubChains(query),
          findWalletPaymentBenefits(query),
          findCatalogPromotions(query),
        ]);
        if (isActive) {
          setClubChainSuggestions(chains);
          setWalletBenefits(wallets);
          setCatalogPromotions(promos);
        }
      } catch (err) {
        console.log('Error loading club data:', err);
      } finally {
        if (isActive) setLoadingClubData(false);
      }
    }, 300);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [storeName, hasHistadrut]);

  const localMatching = availableBrands
    .filter(b => b.name.toLowerCase().includes(storeName.trim().toLowerCase()))
    .map(b => ({ name: b.name, source: 'local' }));

  const clubOnlyMatching = (hasHistadrut ? clubChainSuggestions : [])
    .filter(name => !localMatching.some(l => l.name.toLowerCase() === name.toLowerCase()))
    .map(name => ({ name, source: 'histadrut' }));

  const combinedDropdownBrands = [...localMatching, ...clubOnlyMatching];

  const selectStoreFromDropdown = (brandName) => {
    setStoreName(brandName);
    setShowDropdown(false);
    Keyboard.dismiss();
    if (amount && parseFloat(amount) > 0) {
      const res = runOptimization(userWallet, amount, brandName, getActiveClubWallets());
      setRecommendation(res);
      setSelectedStrategyIndex(0);
    }
  };

  const calculatePayment = async () => {
    Keyboard.dismiss();
    setShowDropdown(false);
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('שגיאה', 'נא להזין סכום קנייה תקף');
      return;
    }
    if (!storeName.trim()) {
      Alert.alert('שגיאה', 'נא לבחור או להזין שם רשת / חנות');
      return;
    }

    let currentWallets = walletBenefits;
    if (hasHistadrut) {
      setLoadingClubData(true);
      try {
        const [wallets, promos] = await Promise.all([
          findWalletPaymentBenefits(storeName),
          findCatalogPromotions(storeName),
        ]);
        currentWallets = wallets;
        setWalletBenefits(wallets);
        setCatalogPromotions(promos);
      } catch (err) {
        console.log('Error calculating club data:', err);
      } finally {
        setLoadingClubData(false);
      }
    }

    const activeClubs = getActiveClubWallets(currentWallets, excludedClubIds);
    const res = runOptimization(userWallet, amount, storeName, activeClubs);
    setRecommendation(res);
    setSelectedStrategyIndex(0);
  };

  const excludeItemFromPlan = (item) => {
    if (item.type === 'ClubWallet') {
      const nextExcluded = [...excludedClubIds, item.id];
      setExcludedClubIds(nextExcluded);
      const res = runOptimization(userWallet, amount, storeName, getActiveClubWallets(walletBenefits, nextExcluded));
      setRecommendation(res);
      setSelectedStrategyIndex(0);
      return;
    }

    onToggleLock(item.id);
    const updatedWallet = userWallet.map(w => w.id === item.id ? { ...w, isLocked: true } : w);
    const res = runOptimization(updatedWallet, amount, storeName, getActiveClubWallets());
    setRecommendation(res);
    setSelectedStrategyIndex(0);
  };

  const activeStrategy = recommendation?.strategies?.[selectedStrategyIndex] || recommendation;

  const handleConfirm = async () => {
    await onConfirmPurchase(activeStrategy);
    setRecommendation(null);
    setSelectedStrategyIndex(0);
    setExcludedClubIds([]);
    setAmount('');
  };

  const openBarcodeModalForItem = (itemPlan) => {
    const fullItem = userWallet.find(w => w.id === itemPlan.id);
    if (fullItem && fullItem.code) {
      setSelectedItemForBarcode(fullItem);
      setBarcodeModalVisible(true);
    } else {
      Alert.alert('אין ברקוד', 'לפריט זה לא הוגדר קוד או ברקוד במערכת.');
    }
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }} style={{ zIndex: 10 }}>
      <Text style={styles.headerTitle}>💰 מחשבון קופה מהיר</Text>

      <View style={styles.walletStatusCard}>
        <Text style={styles.walletTitle}>💳 יתרות זמינות בארנק:</Text>
        {userWallet.length === 0 ? (
          <Text style={{ textAlign: 'right', color: '#64748B', fontSize: 13 }}>אין פריטים בארנק</Text>
        ) : (
          userWallet.map(item => {
            const days = getDaysUntilExpiry(item.expiryDate);
            const brandText = resolveBrandNames(item.applicableBrands);
            const typeIcon = item.type === 'CreditCard' ? '💳' : item.type === 'GiftCard' ? '🎁' : '🎫';

            return (
              <View key={item.id} style={styles.walletRowContainer}>
                <View style={styles.walletRow}>
                  <TouchableOpacity onPress={() => onToggleLock(item.id)} style={styles.lockToggleBtn}>
                    <Text style={styles.lockIconText}>{item.isLocked ? '🔒 נעול' : '🔓 פעיל'}</Text>
                  </TouchableOpacity>

                  <Text style={[styles.walletName, item.isLocked && styles.lockedText]}>
                    {typeIcon} {item.name} {days < 30 ? `(⚠️ עוד ${days} ימים)` : ''}
                  </Text>
                  
                  <Text style={[styles.walletBalance, item.isLocked && styles.lockedText]}>
                    {item.type === 'CreditCard'
                      ? (item.discount > 0 ? `${item.discount}% הנחה` : 'אשראי')
                      : `₪${Number(item.balance).toFixed(2)}`}
                  </Text>
                </View>
                <Text style={styles.brandTagText}>🏷️ מותגים: {brandText}</Text>
              </View>
            );
          })
        )}
      </View>

      <View style={[styles.inputCard, { zIndex: 100 }]}>
        <Text style={styles.label}>רשת / חנות:</Text>
        
        <View style={{ position: 'relative', zIndex: 100 }}>
          <TextInput
            style={styles.input}
            value={storeName}
            onFocus={() => setShowDropdown(true)}
            onChangeText={(text) => {
              setStoreName(text);
              setShowDropdown(true);
              if (amount && parseFloat(amount) > 0) {
                const res = runOptimization(userWallet, amount, text, getActiveClubWallets());
                setRecommendation(res);
                setSelectedStrategyIndex(0);
              }
            }}
            placeholder="הקלד שם חנות (לדוגמה: גולף)..."
          />

          {showDropdown && combinedDropdownBrands.length > 0 && (
            <View style={styles.dropdownContainer}>
              <ScrollView nestedScrollEnabled={true} style={{ maxHeight: 180 }}>
                {combinedDropdownBrands.map((brand, idx) => (
                  <TouchableOpacity
                    key={`${brand.name}_${idx}`}
                    style={styles.dropdownRow}
                    onPress={() => selectStoreFromDropdown(brand.name)}
                  >
                    <Text style={styles.dropdownText}>
                      {brand.source === 'histadrut' ? '🏛️ ' : '🏷️ '}
                      {brand.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        <Text style={styles.label}>סכום לתשלום (₪):</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={(text) => {
            setAmount(text);
            if (storeName) {
              const res = runOptimization(userWallet, text, storeName, getActiveClubWallets());
              setRecommendation(res);
              setSelectedStrategyIndex(0);
            }
          }}
          keyboardType="numeric"
          placeholder="0.00"
        />

        <TouchableOpacity style={styles.calcButton} onPress={calculatePayment}>
          <Text style={styles.calcButtonText}>חשב הרכב תשלום אופטימלי</Text>
        </TouchableOpacity>
      </View>

      {/* תצוגה מקדימה של ארנקי מועדון לפני הזנת סכום */}
      {hasHistadrut && !activeStrategy && (loadingClubData || walletBenefits.length > 0) && (
        <View style={styles.clubCard}>
          <View style={styles.clubHeaderRow}>
            <Text style={styles.clubCardTitle}>🏛️ ארנק "ביחד בשבילך" זמין לרשת זו</Text>
            {loadingClubData && <ActivityIndicator size="small" color="#0369A1" />}
          </View>
          {!loadingClubData && walletBenefits.map((benefit) => (
            <View key={benefit.id} style={styles.clubBenefitItem}>
              <View style={styles.clubItemTopRow}>
                <Text style={styles.clubBenefitName}>{benefit.title}</Text>
                <View style={styles.discountBadge}>
                  <Text style={styles.discountBadgeText}>{benefit.discount_percent}% הנחה</Text>
                </View>
              </View>
              <Text style={styles.clubWalletSub}>{benefit.wallet_name}</Text>
            </View>
          ))}
        </View>
      )}

      {/* תוכנית התשלום עם בחירת מסלולים */}
      {activeStrategy && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>🎯 תוכנית תשלום עבור {storeName}:</Text>

          {/* בורר מסלולים חלופיים (מופיע כשיש בחירה בין ניצול שוברים לשמירתם) */}
          {recommendation?.strategies?.length > 1 && (
            <View style={styles.strategyTabsRow}>
              {recommendation.strategies.map((strat, idx) => {
                const isSelected = idx === selectedStrategyIndex;
                return (
                  <TouchableOpacity
                    key={strat.id}
                    style={[styles.strategyTab, isSelected && styles.activeStrategyTab]}
                    onPress={() => setSelectedStrategyIndex(idx)}
                  >
                    <Text style={[styles.strategyTabTitle, isSelected && styles.activeStrategyTabText]}>
                      {strat.label}
                    </Text>
                    <Text style={[styles.strategyTabSub, isSelected && styles.activeStrategyTabText]}>
                      חיסכון ₪{strat.totalSavings.toFixed(0)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {activeStrategy.subtitle ? (
            <Text style={styles.strategySubtitle}>{activeStrategy.subtitle}</Text>
          ) : null}

          <Text style={styles.savingsHeader}>
            חיסכון כולל: ₪{activeStrategy.totalSavings.toFixed(2)} ({activeStrategy.effectiveDiscount}%)
          </Text>

          {activeStrategy.plan.length === 0 ? (
            <Text style={{ textAlign: 'center', color: '#64748B', marginVertical: 10 }}>לא נמצאו שוברים או כרטיסים תקפים לרשת זו</Text>
          ) : (
            activeStrategy.plan.map((item, index) => (
              <View 
                key={index} 
                style={[styles.planItem, item.type === 'ClubWallet' && styles.clubPlanItem]}
              >
                <View style={styles.planItemHeader}>
                  <Text style={styles.planName}>
                    {item.type === 'ClubWallet' ? '🏛️ ' : item.type === 'CreditCard' ? '💳 ' : '🎫 '}
                    {item.name}
                  </Text>
                  <TouchableOpacity style={styles.excludeBtn} onPress={() => excludeItemFromPlan(item)}>
                    <Text style={styles.excludeBtnText}>🚫 אל תשתמש</Text>
                  </TouchableOpacity>
                </View>

                {item.daysLeft !== undefined && item.daysLeft < 30 && (
                  <Text style={styles.warningText}>⚠️ תו זה פג בעוד {item.daysLeft} ימים!</Text>
                )}

                <Text style={styles.planAmount}>סכום לכיסוי בקופה: ₪{item.amount.toFixed(2)}</Text>
                <Text style={styles.planSavings}>חיסכון: ₪{item.savings.toFixed(2)}</Text>

                <View style={{ marginTop: 10 }}>
                  {item.type === 'Voucher' ? (
                    <TouchableOpacity 
                      style={styles.showBarcodeCheckoutBtnFull}
                      onPress={() => openBarcodeModalForItem(item)}
                    >
                      <Text style={styles.showBarcodeCheckoutBtnFullText}>🔍 הצג ברקוד לקופה</Text>
                    </TouchableOpacity>
                  ) : item.type === 'ClubWallet' ? (
                    <View style={styles.clubActionBox}>
                      <Text style={styles.clubActionTitle}>
                        💳 טען ₪{item.amount.toFixed(2)} בארנק ({item.discountPercent}% הנחה)
                      </Text>
                      <Text style={styles.clubActionSub}>
                        תשלום בפועל בכרטיס: ₪{item.actualPay.toFixed(2)}
                        {item.redimType ? ` • ${item.redimType}` : ''}
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity 
                      style={styles.actionBtn}
                      onPress={() => {
                        Keyboard.dismiss();
                        Alert.alert('Google / Apple Pay', `הפעלת NFC עבור ${item.name}`);
                      }}
                    >
                      <Text style={styles.actionBtnText}>💳 שלם ב-NFC / אשראי</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
          )}

          {activeStrategy.plan.length > 0 && (
            <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
              <Text style={styles.confirmBtnText}>✓ ביצעתי את הקנייה (עדכן יתרה)</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* אזור נפרד למבצעי מוצר וקופונים של הרשת */}
      {hasHistadrut && catalogPromotions.length > 0 && (
        <View style={styles.promoSection}>
          <TouchableOpacity 
            style={styles.promoHeaderBtn}
            onPress={() => setShowPromotions(prev => !prev)}
          >
            <Text style={styles.promoHeaderTitle}>
              🎁 מבצעים והטבות מוצר ברשת ({catalogPromotions.length})
            </Text>
            <Text style={styles.promoToggleText}>
              {showPromotions ? '▲ הסתר' : '▼ הצג מבצעים'}
            </Text>
          </TouchableOpacity>

          {showPromotions && catalogPromotions.map((promo) => (
            <View key={promo.id} style={styles.promoItemCard}>
              <Text style={styles.promoItemTitle}>{promo.title}</Text>
              {promo.short_description ? (
                <Text style={styles.promoItemDesc}>{promo.short_description}</Text>
              ) : null}
              {promo.url ? (
                <TouchableOpacity onPress={() => Linking.openURL(promo.url)}>
                  <Text style={styles.promoLink}>לפרטי ההטבה באתר המועדון ↗</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {/* מודאל הצגת ברקוד לקופה */}
      <Modal
        visible={barcodeModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setBarcodeModalVisible(false)}
      >
        <View style={styles.barcodeModalOverlay}>
          <View style={styles.barcodeCard}>
            <Text style={styles.barcodeModalTitle}>{selectedItemForBarcode?.name}</Text>
            <Text style={styles.barcodeModalSubtitle}>הצג ברקוד זה לקופאי בסיום הקנייה</Text>

            <View style={styles.barcodeVisualBox}>
              <View style={styles.barcodeLines}>
                <View style={[styles.barLine, { width: 4 }]} />
                <View style={[styles.barLine, { width: 2 }]} />
                <View style={[styles.barLine, { width: 6 }]} />
                <View style={[styles.barLine, { width: 3 }]} />
                <View style={[styles.barLine, { width: 5 }]} />
                <View style={[styles.barLine, { width: 2 }]} />
                <View style={[styles.barLine, { width: 4 }]} />
                <View style={[styles.barLine, { width: 6 }]} />
                <View style={[styles.barLine, { width: 3 }]} />
                <View style={[styles.barLine, { width: 5 }]} />
                <View style={[styles.barLine, { width: 2 }]} />
                <View style={[styles.barLine, { width: 4 }]} />
              </View>
              <Text style={styles.barcodeLargeText}>
                {selectedItemForBarcode?.code}
              </Text>
            </View>

            {selectedItemForBarcode?.balance !== undefined && (
              <Text style={styles.barcodeBalanceText}>
                יתרה עדכנית: ₪{Number(selectedItemForBarcode.balance).toFixed(2)}
              </Text>
            )}

            <TouchableOpacity 
              style={styles.closeBarcodeButton}
              onPress={() => setBarcodeModalVisible(false)}
            >
              <Text style={styles.closeBarcodeButtonText}>סגור חלון</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerTitle: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginVertical: 15, color: '#0F172A' },
  walletStatusCard: { backgroundColor: '#F1F5F9', padding: 15, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: '#E2E8F0' },
  walletTitle: { fontSize: 14, fontWeight: 'bold', color: '#334155', marginBottom: 8, textAlign: 'right' },
  walletRowContainer: { borderBottomWidth: 1, borderBottomColor: '#CBD5E1', paddingVertical: 8 },
  walletRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  brandTagText: { fontSize: 12, color: '#0284C7', textAlign: 'right', marginTop: 3 },
  walletName: { fontSize: 14, fontWeight: '600', color: '#1E293B', flex: 1, textAlign: 'right', marginHorizontal: 8 },
  walletBalance: { fontSize: 14, fontWeight: 'bold', color: '#0284C7' },
  lockToggleBtn: { backgroundColor: '#E2E8F0', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  lockIconText: { fontSize: 12, fontWeight: 'bold', color: '#334155' },
  lockedText: { textDecorationLine: 'line-through', opacity: 0.5 },
  inputCard: { backgroundColor: '#FFF', padding: 20, borderRadius: 16, elevation: 4 },
  label: { fontSize: 15, fontWeight: '600', color: '#334155', marginBottom: 6, textAlign: 'right' },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 10, fontSize: 16, marginBottom: 14, textAlign: 'right' },
  dropdownContainer: { position: 'absolute', top: 50, left: 0, right: 0, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, elevation: 5, zIndex: 999, overflow: 'hidden' },
  dropdownRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  dropdownText: { fontSize: 15, color: '#0F172A', textAlign: 'right' },
  calcButton: { backgroundColor: '#16A34A', padding: 16, borderRadius: 10, alignItems: 'center' },
  calcButtonText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },

  clubCard: { marginTop: 20, backgroundColor: '#F0F9FF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#BAE6FD' },
  clubHeaderRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  clubCardTitle: { fontSize: 16, fontWeight: 'bold', color: '#0369A1', textAlign: 'right' },
  clubBenefitItem: { backgroundColor: '#FFF', padding: 12, borderRadius: 10, marginTop: 8, borderWidth: 1, borderColor: '#E0F2FE' },
  clubItemTopRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  clubBenefitName: { fontSize: 15, fontWeight: 'bold', color: '#0F172A', flex: 1, textAlign: 'right', marginLeft: 8 },
  discountBadge: { backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  discountBadgeText: { color: '#166534', fontWeight: 'bold', fontSize: 13 },
  clubWalletSub: { fontSize: 13, color: '#334155', textAlign: 'right', marginTop: 4 },

  promoSection: { marginTop: 18, backgroundColor: '#FFFBEB', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#FDE68A' },
  promoHeaderBtn: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  promoHeaderTitle: { fontSize: 15, fontWeight: 'bold', color: '#92400E' },
  promoToggleText: { fontSize: 13, fontWeight: '600', color: '#B45309' },
  promoItemCard: { backgroundColor: '#FFF', padding: 12, borderRadius: 10, marginTop: 10, borderWidth: 1, borderColor: '#FEF3C7' },
  promoItemTitle: { fontSize: 14, fontWeight: 'bold', color: '#1E293B', textAlign: 'right' },
  promoItemDesc: { fontSize: 12, color: '#475569', textAlign: 'right', marginTop: 4 },
  promoLink: { fontSize: 12, color: '#0284C7', fontWeight: '600', textAlign: 'right', marginTop: 6 },

  resultCard: { marginTop: 20, backgroundColor: '#EFF6FF', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#BFDBFE' },
  resultTitle: { fontSize: 20, fontWeight: 'bold', color: '#1E40AF', textAlign: 'right' },
  strategyTabsRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 12, marginBottom: 6 },
  strategyTab: { flex: 1, backgroundColor: '#FFF', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#93C5FD', alignItems: 'center' },
  activeStrategyTab: { backgroundColor: '#1E40AF', borderColor: '#1E40AF' },
  strategyTabTitle: { fontSize: 12, fontWeight: 'bold', color: '#1E40AF', textAlign: 'center' },
  strategyTabSub: { fontSize: 11, color: '#475569', marginTop: 2 },
  activeStrategyTabText: { color: '#FFF' },
  strategySubtitle: { fontSize: 12, color: '#475569', textAlign: 'right', marginTop: 4 },
  savingsHeader: { fontSize: 18, fontWeight: 'bold', color: '#16A34A', textAlign: 'right', marginVertical: 8 },
  planItem: { backgroundColor: '#FFF', padding: 14, borderRadius: 10, marginVertical: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  clubPlanItem: { borderColor: '#38BDF8', backgroundColor: '#F8FAFC' },
  planItemHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  planName: { fontSize: 16, fontWeight: 'bold', textAlign: 'right', color: '#0F172A', flex: 1 },
  excludeBtn: { backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#FCA5A5' },
  excludeBtnText: { color: '#991B1B', fontSize: 12, fontWeight: 'bold' },
  planAmount: { fontSize: 15, textAlign: 'right', color: '#475569', marginTop: 4 },
  planSavings: { fontSize: 14, textAlign: 'right', color: '#16A34A', fontWeight: '600', marginTop: 2 },
  clubActionBox: { backgroundColor: '#E0F2FE', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#BAE6FD' },
  clubActionTitle: { fontSize: 14, fontWeight: 'bold', color: '#0369A1', textAlign: 'right' },
  clubActionSub: { fontSize: 13, color: '#0F172A', textAlign: 'right', marginTop: 3 },
  showBarcodeCheckoutBtnFull: { backgroundColor: '#0284C7', padding: 12, borderRadius: 8, alignItems: 'center' },
  showBarcodeCheckoutBtnFullText: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  actionBtn: { backgroundColor: '#475569', padding: 12, borderRadius: 8, alignItems: 'center' },
  actionBtnText: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  confirmBtn: { backgroundColor: '#0F172A', padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  confirmBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  warningText: { fontSize: 13, color: '#DC2626', fontWeight: 'bold', textAlign: 'right', marginTop: 2 },

  barcodeModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  barcodeCard: { backgroundColor: '#FFF', width: '100%', borderRadius: 20, padding: 24, alignItems: 'center', elevation: 5 },
  barcodeModalTitle: { fontSize: 22, fontWeight: 'bold', color: '#1E293B', marginBottom: 4, textAlign: 'center' },
  barcodeModalSubtitle: { fontSize: 14, color: '#64748B', marginBottom: 24, textAlign: 'center' },
  barcodeVisualBox: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 20, width: '100%', alignItems: 'center', marginBottom: 20 },
  barcodeLines: { flexDirection: 'row', height: 60, alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 12 },
  barLine: { backgroundColor: '#0F172A', height: '100%', borderRadius: 1 },
  barcodeLargeText: { fontSize: 22, fontWeight: 'bold', color: '#0F172A', letterSpacing: 2 },
  barcodeBalanceText: { fontSize: 16, fontWeight: '600', color: '#0284C7', marginBottom: 20 },
  closeBarcodeButton: { backgroundColor: '#334155', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 10, width: '100%', alignItems: 'center' },
  closeBarcodeButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
});