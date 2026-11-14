import React, { useState } from 'react';
import { 
  StyleSheet, Text, View, TextInput, TouchableOpacity, 
  ScrollView, Alert, Switch, Modal, Dimensions 
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Camera, CameraView, useCameraPermissions } from 'expo-camera';

const { width } = Dimensions.get('window');

export default function WalletScreen({ 
  userWallet, 
  availableBrands, 
  hasHistadrut = true,
  onToggleHistadrut,
  onAddItem, 
  onUpdateItem,
  onDeleteItem, 
  onToggleLock 
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const [barcodeModalVisible, setBarcodeModalVisible] = useState(false);
  const [selectedItemForBarcode, setSelectedItemForBarcode] = useState(null);

  // סטייטים למצב עריכה
  const [editingItemId, setEditingItemId] = useState(null);

  // סטייטים למצלמה וסריקה
  const [cameraModalVisible, setCameraModalVisible] = useState(false);
  const [facing, setFacing] = useState('back');
  const [permission, requestPermission] = useCameraPermissions();

  const [name, setName] = useState('');
  const [itemType, setItemType] = useState('Voucher'); // Voucher, GiftCard, CreditCard
  const [balance, setBalance] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [barcode, setBarcode] = useState('');
  const [selectedBrands, setSelectedBrands] = useState([]);

  // פתיחת מודאל להוספה חדשה
  const openAddModal = () => {
    setEditingItemId(null);
    setName('');
    setItemType('Voucher');
    setBalance('');
    setDiscountPct('');
    setExpiryDate('');
    setBarcode('');
    setSelectedBrands([]);
    setModalVisible(true);
  };

  // פתיחת מודאל לעריכת פריט קיים
  const openEditModal = (item) => {
    setEditingItemId(item.id);
    setName(item.name || '');
    setItemType(item.type || 'Voucher');
    setBalance(item.balance !== undefined ? String(item.balance) : '');
    setDiscountPct(item.discount !== undefined ? String(item.discount) : '');
    setExpiryDate(item.expiryDate || '');
    setBarcode(item.code || '');
    
    // המרת מזהי מותג שמורים לשמות תואמים מתוך רשימת המותגים
    const mappedBrands = (item.applicableBrands || []).map(b => {
      const found = availableBrands.find(ab => String(ab.id) === String(b) || ab.name === b);
      return found ? found.name : b;
    });
    setSelectedBrands(mappedBrands);
    
    setModalVisible(true);
  };

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

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('שגיאה', 'נא להזין שם לפריט');
      return;
    }

    const payload = {
      name: name.trim(),
      item_type: itemType,
      balance: itemType === 'CreditCard' ? null : parseFloat(balance || 0),
      discount_pct: parseFloat(discountPct || 0),
      expiry_date: expiryDate.trim() || null,
      barcode: barcode.trim() || null,
    };

    if (editingItemId) {
      if (onUpdateItem) {
        onUpdateItem(editingItemId, payload, selectedBrands);
      } else {
        Alert.alert('עדכון', 'פונקציית עדכון טרם הוגדרה בקומפוננטת האב');
      }
    } else {
      onAddItem({ ...payload, is_locked: false }, selectedBrands);
    }
    
    setModalVisible(false);
  };

  const toggleBrandSelection = (brandName) => {
    if (selectedBrands.includes(brandName)) {
      setSelectedBrands(selectedBrands.filter(b => b !== brandName));
    } else {
      setSelectedBrands([...selectedBrands, brandName]);
    }
  };

  const openBarcodeModal = (item) => {
    setSelectedItemForBarcode(item);
    setBarcodeModalVisible(true);
  };

  const handleBarCodeScanned = ({ type, data }) => {
    setBarcode(data);
    setCameraModalVisible(false);
    Alert.alert('ברקוד נקלט בהצלחה! 📷', `הקוד: ${data}`);
  };

  const requestCameraAccess = async () => {
    if (!permission || !permission.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('שגיאה', 'אין הרשאה שימוש במצלמה');
        return;
      }
    }
    setCameraModalVisible(true);
  };

  return (
    <View style={styles.container}>
      {/* כפתור הוספת פריט חדש */}
      <TouchableOpacity 
        style={styles.addButton} 
        onPress={openAddModal}
      >
        <Text style={styles.addButtonText}>+ הוסף שובר או כרטיס לארנק</Text>
      </TouchableOpacity>

      {/* כרטיסיית מועדון צרכנות ("ביחד בשבילך") */}
      <View style={[styles.clubMembershipCard, !hasHistadrut && styles.clubMembershipCardInactive]}>
        <View style={styles.clubMembershipRow}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={styles.clubMembershipTitle}>🏛️ מועדון "ביחד בשבילך" (הסתדרות)</Text>
            <Text style={styles.clubMembershipSub}>
              {hasHistadrut 
                ? 'פעיל — ארנקי ההנחה ומבצעי הרשתות מוצגים במחשבון הקופה' 
                : 'כבוי — הפעל אם ברשותך כרטיס מועדון של ההסתדרות'}
            </Text>
          </View>
          <Switch
            value={hasHistadrut}
            onValueChange={onToggleHistadrut}
            trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
            thumbColor={hasHistadrut ? '#0284C7' : '#F1F5F9'}
          />
        </View>
      </View>

      {/* רשימת הפריטים בארנק */}
      {userWallet.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>הארנק שלך ריק כרגע.</Text>
          <Text style={styles.emptySubText}>לחץ על הכפתור למעלה כדי להוסיף שוברים וכרטיסים.</Text>
        </View>
      ) : (
        userWallet.map(item => (
          <View key={item.id} style={[styles.card, item.isLocked && styles.lockedCard]}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.cardType}>
                  {item.type === 'Voucher' ? '🎫 שובר זיכוי' : item.type === 'GiftCard' ? '🎁 גיפט קארד' : '💳 כרטיס אשראי'}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                {/* כפתור עריכה */}
                <TouchableOpacity 
                  style={styles.editButton} 
                  onPress={() => openEditModal(item)}
                >
                  <Text style={styles.editButtonText}>✏️</Text>
                </TouchableOpacity>

                {/* כפתור מחיקה */}
                <TouchableOpacity 
                  style={styles.deleteButton} 
                  onPress={() => onDeleteItem(item.id)}
                >
                  <Text style={styles.deleteButtonText}>🗑️</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.cardBody}>
              {item.type !== 'CreditCard' && (
                <Text style={styles.cardDetail}>
                  <Text style={styles.bold}>יתרה:</Text> ₪{Number(item.balance).toFixed(2)}
                </Text>
              )}
              {item.discount > 0 && (
                <Text style={styles.cardDetail}>
                  <Text style={styles.bold}>הנחת מועדון:</Text> {item.discount}%
                </Text>
              )}
              {item.expiryDate && (
                <Text style={styles.cardDetail}>
                  <Text style={styles.bold}>תוקף:</Text> {item.expiryDate}
                </Text>
              )}
              {item.applicableBrands && item.applicableBrands.length > 0 && (
              <Text style={styles.cardDetail}>
              <Text style={styles.bold}>רשתות תואמות:</Text> {resolveBrandNames(item.applicableBrands)}
                </Text>
              )}
            </View>

            {/* כפתורי פעולה מהירים (העתקה + הצגת ברקוד לקופה) */}
            {item.code ? (
              <View style={styles.codeContainer}>
                <Text style={styles.codeText} numberOfLines={1}>קוד: {item.code}</Text>
                
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity 
                    style={styles.showBarcodeButton} 
                    onPress={() => openBarcodeModal(item)}
                  >
                    <Text style={styles.showBarcodeButtonText}>🔍 הצג לקופה</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.copyButton} 
                    onPress={async () => {
                      await Clipboard.setStringAsync(item.code);
                      Alert.alert('הועתק! 📋', `הקוד "${item.code}" הועתק ללוח הגזירים`);
                    }}
                  >
                    <Text style={styles.copyButtonText}>📋 העתק</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* נעילת פריט */}
            <View style={styles.lockRow}>
              <Text style={styles.lockLabel}>נעול לשימוש במחשבון (לא לשימוש קיימת)</Text>
              <Switch 
                value={item.isLocked} 
                onValueChange={() => onToggleLock(item.id)}
                trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
                thumbColor={item.isLocked ? '#0284C7' : '#F1F5F9'}
              />
            </View>
          </View>
        ))
      )}

      {/* מודאל הצגת ברקוד לקופה (מסך מלא ומואר) */}
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

            {selectedItemForBarcode?.balance !== undefined && selectedItemForBarcode?.type !== 'CreditCard' && (
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

      {/* מודאל הוספה / עריכת פריט */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingItemId ? '✏️ עריכת שובר או כרטיס' : '➕ הוספת שובר או כרטיס חדש'}
            </Text>

            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={styles.label}>שם הפריט (למשל: שובר שופרסל)</Text>
              <TextInput 
                style={styles.input} 
                placeholder="הכנס שם..." 
                value={name} 
                onChangeText={setName} 
              />

              <Text style={styles.label}>סוג פריט</Text>
              <View style={styles.typeRow}>
                {['Voucher', 'GiftCard', 'CreditCard'].map(t => (
                  <TouchableOpacity 
                    key={t}
                    style={[styles.typeButton, itemType === t && styles.activeTypeButton]}
                    onPress={() => setItemType(t)}
                  >
                    <Text style={[styles.typeButtonText, itemType === t && styles.activeTypeButtonText]}>
                      {t === 'Voucher' ? 'שובר' : t === 'GiftCard' ? 'גיפט קארד' : 'אשראי'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {itemType !== 'CreditCard' && (
                <>
                  <Text style={styles.label}>יתרה (₪)</Text>
                  <TextInput 
                    style={styles.input} 
                    placeholder="0.00" 
                    keyboardType="numeric" 
                    value={balance} 
                    onChangeText={setBalance} 
                  />
                </>
              )}

              <Text style={styles.label}>אחוז הנחה (אם יש, למשל 15)</Text>
              <TextInput 
                style={styles.input} 
                placeholder="0" 
                keyboardType="numeric" 
                value={discountPct} 
                onChangeText={setDiscountPct} 
              />

              <Text style={styles.label}>תאריך תוקף (למשל: 2027-12-31)</Text>
              <TextInput 
                style={styles.input} 
                placeholder="YYYY-MM-DD" 
                value={expiryDate} 
                onChangeText={setExpiryDate} 
              />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <Text style={styles.label}>ברקוד / קוד קופון</Text>
                <TouchableOpacity style={styles.scanButtonInline} onPress={requestCameraAccess}>
                  <Text style={styles.scanButtonInlineText}>📷 סרוק עם מצלמה</Text>
                </TouchableOpacity>
              </View>
              <TextInput 
                style={styles.input} 
                placeholder="הקלד קוד או סרוק ברקוד..." 
                value={barcode} 
                onChangeText={setBarcode} 
              />

              <Text style={styles.label}>רשתות תואמות (בחר מתוך הרשימה)</Text>
              <View style={styles.brandsGrid}>
                {availableBrands.map(b => {
                  const isSelected = selectedBrands.includes(b.name);
                  return (
                    <TouchableOpacity
                      key={b.id}
                      style={[styles.brandChip, isSelected && styles.activeBrandChip]}
                      onPress={() => toggleBrandSelection(b.name)}
                    >
                      <Text style={[styles.brandChipText, isSelected && styles.activeBrandChipText]}>
                        {b.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={[styles.actionButton, styles.cancelButton]} 
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.cancelButtonText}>ביטול</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.actionButton, styles.saveButton]} 
                  onPress={handleSave}
                >
                  <Text style={styles.saveButtonText}>{editingItemId ? 'שמור שינויים' : 'שמור בארנק'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* מודאל סריקת ברקוד במצלמה */}
      <Modal
        visible={cameraModalVisible}
        animationType="slide"
        onRequestClose={() => setCameraModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            facing={facing}
            onBarcodeScanned={handleBarCodeScanned}
            barcodeScannerSettings={{
              barcodeTypes: ["qr", "pdf417", "code128", "ean13", "ean8"],
            }}
          >
            <View style={{ flex: 1, justifyContent: 'flex-end', padding: 30 }}>
              <TouchableOpacity 
                style={styles.closeCameraButton}
                onPress={() => setCameraModalVisible(false)}
              >
                <Text style={styles.closeCameraButtonText}>סגור מצלמה</Text>
              </TouchableOpacity>
            </View>
          </CameraView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingBottom: 20 },
  addButton: { 
    backgroundColor: '#0284C7', 
    padding: 15, 
    borderRadius: 12, 
    alignItems: 'center', 
    marginBottom: 14,
    elevation: 2 
  },
  addButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  // כרטיסיית מועדון צרכנות
  clubMembershipCard: {
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  clubMembershipCardInactive: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  clubMembershipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clubMembershipTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  clubMembershipSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 3,
  },

  emptyContainer: { alignItems: 'center', marginTop: 40, padding: 20 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#475569', marginBottom: 8 },
  emptySubText: { fontSize: 14, color: '#94A3B8', textAlign: 'center' },
  card: { 
    backgroundColor: '#FFF', 
    borderRadius: 12, 
    padding: 16, 
    marginBottom: 16, 
    borderWidth: 1, 
    borderColor: '#E2E8F0',
    elevation: 1 
  },
  lockedCard: { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#1E293B' },
  cardType: { fontSize: 12, color: '#64748B', marginTop: 2 },
  editButton: { padding: 4, marginRight: 4 },
  editButtonText: { fontSize: 16 },
  deleteButton: { padding: 4 },
  deleteButtonText: { fontSize: 16 },
  cardBody: { marginBottom: 10 },
  cardDetail: { fontSize: 14, color: '#334155', marginBottom: 4 },
  bold: { fontWeight: '600', color: '#0F172A' },
  codeContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    backgroundColor: '#F8FAFC', 
    padding: 8, 
    borderRadius: 8, 
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  codeText: { fontSize: 13, color: '#475569', flex: 1, marginRight: 6 },
  showBarcodeButton: {
    backgroundColor: '#0284C7',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  showBarcodeButtonText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  copyButton: { 
    backgroundColor: '#E0F2FE', 
    paddingVertical: 6, 
    paddingHorizontal: 10, 
    borderRadius: 6, 
  },
  copyButtonText: { color: '#0284C7', fontSize: 12, fontWeight: 'bold' },
  lockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10 },
  lockLabel: { fontSize: 12, color: '#64748B', flex: 1, marginRight: 10 },
  
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

  // מודאל הוספה / עריכה
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1E293B', marginBottom: 16, textAlign: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 10, fontSize: 16, backgroundColor: '#F8FAFC' },
  scanButtonInline: { backgroundColor: '#E0F2FE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  scanButtonInlineText: { fontSize: 12, color: '#0284C7', fontWeight: 'bold' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeButton: { flex: 1, padding: 10, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, alignItems: 'center', backgroundColor: '#F8FAFC' },
  activeTypeButton: { backgroundColor: '#0284C7', borderColor: '#0284C7' },
  typeButtonText: { color: '#64748B', fontWeight: '600' },
  activeTypeButtonText: { color: '#FFF' },
  brandsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  brandChip: { paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 16, backgroundColor: '#F8FAFC' },
  activeBrandChip: { backgroundColor: '#0284C7', borderColor: '#0284C7' },
  brandChipText: { fontSize: 12, color: '#475569' },
  activeBrandChipText: { color: '#FFF', fontWeight: 'bold' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  actionButton: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center' },
  cancelButton: { backgroundColor: '#F1F5F9' },
  cancelButtonText: { color: '#475569', fontWeight: 'bold' },
  saveButton: { backgroundColor: '#0284C7' },
  saveButtonText: { color: '#FFF', fontWeight: 'bold' },
  closeCameraButton: { backgroundColor: '#EF4444', padding: 14, borderRadius: 10, alignItems: 'center' },
  closeCameraButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
});