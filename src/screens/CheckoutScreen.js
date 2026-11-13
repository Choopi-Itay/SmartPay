import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, Text, View, TouchableOpacity, TextInput, ScrollView, 
  Alert, Keyboard, Modal, ActivityIndicator 
} from 'react-native';
import { runOptimization, getDaysUntilExpiry } from '../utils/optimizer';
import { findBestClubBenefits } from '../services/clubBenefits';

export default function CheckoutScreen({ userWallet, availableBrands, onToggleLock, onConfirmPurchase }) {
  const [storeName, setStoreName] = useState('');
  const [amount, setAmount] = useState('');
  const [recommendation, setRecommendation] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);

  // סטייט להטבות מועדון ("ביחד בשבילך")
  const [clubBenefits, setClubBenefits] = useState([]);
  const [loadingClubBenefits, setLoadingClubBenefits] = useState(false);

  // סטייט למודאל ברקוד במחשבון הקופה
  const [barcodeModalVisible, setBarcodeModalVisible] = useState(false);
  const [selectedItemForBarcode, setSelectedItemForBarcode] = useState(null);

  // אם היתרות בארנק משתנות בזמן שיש תוכנית פעילה, נחשב מחדש אוטומטית
  useEffect(() => {
    if (recommendation && storeName && amount && parseFloat(amount) > 0) {
      setRecommendation(runOptimization(userWallet, amount, storeName));
    }
  }, [userWallet]);

  // שליפת הטבות מועדון מ-Supabase בכל שינוי של שם החנות (עם Debounce למניעת עומס)
  useEffect(() => {
    const query = storeName.trim();
    if (query.length < 2) {
      setClubBenefits([]);
      return;
    }

    let isActive = true;
    const timer = setTimeout(async () => {
      setLoadingClubBenefits(true);
      try {
        const results = await findBestClubBenefits(query);
        if (isActive) {
          setClubBenefits(results);
        }
      } catch (err) {
        console.log('Error loading club benefits in checkout:', err);
      } finally {
        if (isActive) setLoadingClubBenefits(false);
      }
    }, 350);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [storeName]);

  const matchingBrands = availableBrands.filter(brand =>
    brand.name.toLowerCase().includes(storeName.trim().toLowerCase())
  );

  const selectStoreFromDropdown = (brandName) => {
    setStoreName(brandName);
    setShowDropdown(false);
    Keyboard.dismiss();
    if (amount && parseFloat(amount) > 0) {
      setRecommendation(runOptimization(userWallet, amount, brandName));
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
    setRecommendation(runOptimization(userWallet, amount, storeName));

    // רענון מיידי של הטבות המועדון בלחיצה על כפתור החישוב
    setLoadingClubBenefits(true);
    try {
      const results = await findBestClubBenefits(storeName);
      setClubBenefits(results);
    } finally {
      setLoadingClubBenefits(false);
    }
  };

  const excludeItemFromPlan = (itemId) => {
    onToggleLock(itemId);
    const updatedWallet = userWallet.map(item => item.id === itemId ? { ...item, isLocked: true } : item);
    setRecommendation(runOptimization(updatedWallet, amount, storeName));
  };

  const handleConfirm = async () => {
    await onConfirmPurchase(recommendation);
    setRecommendation(null);
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

  const numericAmount = parseFloat(amount) || 0;

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
            const brandText = item.applicableBrands?.length > 0 ? item.applicableBrands.join(', ') : 'לא מוגדר';
            return (
              <View key={item.id} style={styles.walletRowContainer}>
                <View style={styles.walletRow}>
                  <TouchableOpacity onPress={() => onToggleLock(item.id)} style={styles.lockToggleBtn}>
                    <Text style={styles.lockIconText}>{item.isLocked ? '🔒 נעול' : '🔓 פעיל'}</Text>
                  </TouchableOpacity>

                  <Text style={[styles.walletName, item.isLocked && styles.lockedText]}>
                    {item.name} {days < 30 ? `(⚠️ עוד ${days} ימים)` : ''}
                  </Text>
                  
                  <Text style={[styles.walletBalance, item.isLocked && styles.lockedText]}>
                    {item.type === 'Voucher' ? `₪${item.balance.toFixed(2)}` : 'אשראי'}
                  </Text>
                </View>
                <Text style={styles.brandTagText}>🏷️ מותגים: [{brandText}]</Text>
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
                setRecommendation(runOptimization(userWallet, amount, text));
              }
            }}
            placeholder="הקלד שם חנות או בחר מהרשימה..."
          />

          {showDropdown && matchingBrands.length > 0 && (
            <View style={styles.dropdownContainer}>
              <ScrollView nestedScrollEnabled={true} style={{ maxHeight: 160 }}>
                {matchingBrands.map(brand => (
                  <TouchableOpacity
                    key={brand.id}
                    style={styles.dropdownRow}
                    onPress={() => selectStoreFromDropdown(brand.name)}
                  >
                    <Text style={styles.dropdownText}>🏷️ {brand.name}</Text>
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
              setRecommendation(runOptimization(userWallet, text, storeName));
            }
          }}
          keyboardType="numeric"
          placeholder="0.00"
        />

        <TouchableOpacity style={styles.calcButton} onPress={calculatePayment}>
          <Text style={styles.calcButtonText}>חשב הרכב תשלום אופטימלי</Text>
        </TouchableOpacity>
      </View>

      {/* כרטיסיית הטבות מועדון "ביחד בשבילך" (טעינת ארנק / שוברים) */}
      {(loadingClubBenefits || clubBenefits.length > 0) && (
        <View style={styles.clubCard}>
          <View style={styles.clubHeaderRow}>
            <Text style={styles.clubCardTitle}>🏛️ הטבות מועדון "ביחד בשבילך"</Text>
            {loadingClubBenefits && <ActivityIndicator size="small" color="#0369A1" />}
          </View>

          {!loadingClubBenefits && clubBenefits.map((benefit) => {
            const discount = Number(benefit.discount_percent || 0);
            const applicableAmount = benefit.monthly_limit
              ? Math.min(numericAmount, Number(benefit.monthly_limit))
              : numericAmount;
            const potentialSavings = discount > 0 && numericAmount > 0
              ? (applicableAmount * discount) / 100
              : 0;
            const finalPay = numericAmount - potentialSavings;

            return (
              <View key={benefit.id} style={styles.clubBenefitItem}>
                <View style={styles.clubItemTopRow}>
                  <Text style={styles.clubBenefitName}>{benefit.title}</Text>
                  {discount > 0 && (
                    <View style={styles.discountBadge}>
                      <Text style={styles.discountBadgeText}>{discount}% הנחה</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.clubWalletSub}>
                  {benefit.wallet_name || benefit.short_description}
                </Text>

                {benefit.redim_type && (
                  <Text style={styles.clubMetaText}>📍 אופן מימוש: {benefit.redim_type}</Text>
                )}

                {benefit.monthly_limit ? (
                  <Text style={styles.clubMetaText}>
                    📊 תקרת טעינה חודשית במועדון: ₪{benefit.monthly_limit}
                  </Text>
                ) : null}

                {potentialSavings > 0 && (
                  <View style={styles.clubCalcBox}>
                    <Text style={styles.clubSavingsText}>
                      💡 בטעינת הארנק תחסוך ₪{potentialSavings.toFixed(2)} (תשלם ₪{finalPay.toFixed(2)})
                    </Text>
                    {benefit.monthly_limit && numericAmount > Number(benefit.monthly_limit) && (
                      <Text style={styles.clubLimitWarning}>
                        * ההנחה חושבה עד לתקרה החודשית (₪{benefit.monthly_limit})
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {recommendation && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>🎯 תוכנית תשלום מומלצת עבור {storeName}:</Text>
          <Text style={styles.savingsHeader}>
            חיסכון כולל: ₪{recommendation.totalSavings.toFixed(2)} ({recommendation.effectiveDiscount}%)
          </Text>

          {recommendation.plan.length === 0 ? (
            <Text style={{ textAlign: 'center', color: '#64748B', marginVertical: 10 }}>לא נמצאו שוברים או כרטיסים תקפים לרשת זו</Text>
          ) : (
            recommendation.plan.map((item, index) => (
              <View key={index} style={styles.planItem}>
                <View style={styles.planItemHeader}>
                  <Text style={styles.planName}>{item.name}</Text>
                  <TouchableOpacity style={styles.excludeBtn} onPress={() => excludeItemFromPlan(item.id)}>
                    <Text style={styles.excludeBtnText}>🚫 אל תשתמש</Text>
                  </TouchableOpacity>
                </View>

                {item.daysLeft !== undefined && item.daysLeft < 30 && (
                  <Text style={styles.warningText}>⚠️ תו זה פג בעוד {item.daysLeft} ימים!</Text>
                )}
                <Text style={styles.planAmount}>סכום לתשלום: ₪{item.amount.toFixed(2)}</Text>
                <Text style={styles.planSavings}>חיסכון: ₪{item.savings.toFixed(2)}</Text>

                <View style={{ marginTop: 10 }}>
                  {item.type === 'Voucher' ? (
                    <TouchableOpacity 
                      style={styles.showBarcodeCheckoutBtnFull}
                      onPress={() => openBarcodeModalForItem(item)}
                    >
                      <Text style={styles.showBarcodeCheckoutBtnFullText}>🔍 הצג ברקוד לקופה</Text>
                    </TouchableOpacity>
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

          {recommendation.plan.length > 0 && (
            <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
              <Text style={styles.confirmBtnText}>✓ ביצעתי את הקנייה (עדכן יתרה)</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* מודאל הצגת ברקוד לקופה מתוך מחשבון הקופה */}
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
  walletRowContainer: { borderBottomWidth: 1, borderBottomColor: '#CBD5E1', paddingVertical: 6 },
  walletRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  brandTagText: { fontSize: 11, color: '#0284C7', textAlign: 'right', marginTop: 2 },
  walletName: { fontSize: 14, color: '#475569' },
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

  // סגנונות לכרטיסיית הטבות המועדון
  clubCard: { marginTop: 20, backgroundColor: '#F0F9FF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#BAE6FD' },
  clubHeaderRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  clubCardTitle: { fontSize: 17, fontWeight: 'bold', color: '#0369A1', textAlign: 'right' },
  clubBenefitItem: { backgroundColor: '#FFF', padding: 12, borderRadius: 10, marginTop: 8, borderWidth: 1, borderColor: '#E0F2FE' },
  clubItemTopRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' },
  clubBenefitName: { fontSize: 15, fontWeight: 'bold', color: '#0F172A', flex: 1, textAlign: 'right', marginLeft: 8 },
  discountBadge: { backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  discountBadgeText: { color: '#166534', fontWeight: 'bold', fontSize: 13 },
  clubWalletSub: { fontSize: 13, color: '#334155', textAlign: 'right', marginTop: 4 },
  clubMetaText: { fontSize: 12, color: '#64748B', textAlign: 'right', marginTop: 3 },
  clubCalcBox: { marginTop: 8, backgroundColor: '#F0FDF4', padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#BBF7D0' },
  clubSavingsText: { fontSize: 13, fontWeight: 'bold', color: '#15803D', textAlign: 'right' },
  clubLimitWarning: { fontSize: 11, color: '#B45309', textAlign: 'right', marginTop: 2 },

  resultCard: { marginTop: 20, backgroundColor: '#EFF6FF', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#BFDBFE' },
  resultTitle: { fontSize: 20, fontWeight: 'bold', color: '#1E40AF', textAlign: 'right' },
  savingsHeader: { fontSize: 18, fontWeight: 'bold', color: '#16A34A', textAlign: 'right', marginVertical: 8 },
  planItem: { backgroundColor: '#FFF', padding: 14, borderRadius: 10, marginVertical: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  planItemHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  planName: { fontSize: 16, fontWeight: 'bold', textAlign: 'right', color: '#0F172A', flex: 1 },
  excludeBtn: { backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#FCA5A5' },
  excludeBtnText: { color: '#991B1B', fontSize: 12, fontWeight: 'bold' },
  planAmount: { fontSize: 15, textAlign: 'right', color: '#475569', marginTop: 4 },
  planSavings: { fontSize: 14, textAlign: 'right', color: '#16A34A', fontWeight: '600', marginTop: 2 },
  
  showBarcodeCheckoutBtnFull: { backgroundColor: '#0284C7', padding: 12, borderRadius: 8, alignItems: 'center' },
  showBarcodeCheckoutBtnFullText: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  actionBtn: { backgroundColor: '#475569', padding: 12, borderRadius: 8, alignItems: 'center' },
  actionBtnText: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },

  confirmBtn: { backgroundColor: '#0F172A', padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  confirmBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  warningText: { fontSize: 13, color: '#DC2626', fontWeight: 'bold', textAlign: 'right', marginTop: 2 },

  // מודאל הצגת ברקוד
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