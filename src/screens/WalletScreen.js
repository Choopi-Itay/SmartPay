import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  Modal,
  Image,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import DeductCreditModal from '../components/DeductCreditModal';
import {
  scanAndBackupReceipt,
  resolveScannedBrand,
} from '../services/receiptScannerService';
import {
  fetchWalletShares,
  shareWalletWithEmail,
  removeWalletShare,
  shareSingleItemWithEmail,
  fetchItemShares,
  removeSingleItemShare,
} from '../services/shareService';

function getExpiryStatus(expiryDate) {
  if (!expiryDate || typeof expiryDate !== 'string') return null;
  const match = expiryDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const exp = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    23,
    59,
    59
  );
  if (isNaN(exp.getTime())) return null;

  const now = new Date();
  const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { level: 'expired', label: '⚠️ פג תוקף', diffDays };
  }
  if (diffDays <= 60) {
    return {
      level: 'soon',
      label: diffDays === 0 ? '🔥 פג היום!' : `⏳ פג בעוד ${diffDays} ימים`,
      diffDays,
    };
  }
  return { level: 'ok', label: null, diffDays };
}

export default function WalletScreen({
  userWallet,
  availableBrands,
  hasHistadrut = true,
  currentUser,
  onSignOut,
  onToggleHistadrut,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onToggleLock,
  onRefreshWallet,
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const [barcodeModalVisible, setBarcodeModalVisible] = useState(false);
  const [selectedItemForBarcode, setSelectedItemForBarcode] = useState(null);

  const [deductModalVisible, setDeductModalVisible] = useState(false);
  const [selectedItemForDeduct, setSelectedItemForDeduct] = useState(null);

  const [receiptImageUrl, setReceiptImageUrl] = useState(null);
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [receiptViewerUrl, setReceiptViewerUrl] = useState(null);

  const [editingItemId, setEditingItemId] = useState(null);

  const [cameraModalVisible, setCameraModalVisible] = useState(false);
  const [facing, setFacing] = useState('back');
  const [permission, requestPermission] = useCameraPermissions();

  const [activeFilter, setActiveFilter] = useState('all');

  // מצב שיתוף ארנק משפחתי
  const [shareExpanded, setShareExpanded] = useState(false);
  const [shareEmailInput, setShareEmailInput] = useState('');
  const [sharingLoading, setSharingLoading] = useState(false);
  const [sharesState, setSharesState] = useState({
    sharedByMe: [],
    sharedWithMe: [],
  });

  // מצב שיתוף שובר פרטני
  const [singleShareModalVisible, setSingleShareModalVisible] = useState(false);
  const [itemToShare, setItemToShare] = useState(null);
  const [singleShareEmail, setSingleShareEmail] = useState('');
  const [itemSharesList, setItemSharesList] = useState([]);

  const [name, setName] = useState('');
  const [itemType, setItemType] = useState('Voucher');
  const [balance, setBalance] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [barcode, setBarcode] = useState('');
  const [selectedBrands, setSelectedBrands] = useState([]);
  const [brandSearch, setBrandSearch] = useState('');

  const loadShares = async () => {
    const res = await fetchWalletShares();
    setSharesState(res);
  };

  useEffect(() => {
    loadShares();
  }, [currentUser?.id]);

  const handleAddShare = async () => {
    if (!shareEmailInput.trim()) {
      Alert.alert('שגיאה', 'נא להזין כתובת אימייל לשיתוף');
      return;
    }

    setSharingLoading(true);
    try {
      await shareWalletWithEmail(shareEmailInput);
      setShareEmailInput('');
      await loadShares();
      if (onRefreshWallet) await onRefreshWallet();
      Alert.alert('הארנק שותף! 🤝', 'המשתמש יראה את הפריטים שלך מיד כשיתחבר עם מייל זה.');
    } catch (err) {
      Alert.alert('שגיאה בשיתוף', err?.message || 'לא ניתן היה לשתף את הארנק');
    } finally {
      setSharingLoading(false);
    }
  };

  const handleRemoveShare = (share) => {
    Alert.alert(
      'ביטול שיתוף',
      `להפסיק לשתף את הארנק עם ${share.shared_with_email}?`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'הסר שיתוף',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeWalletShare(share.id);
              await loadShares();
            } catch (err) {
              Alert.alert('שגיאה', err?.message || 'לא ניתן להסיר שיתוף');
            }
          },
        },
      ]
    );
  };

  const openSingleShareModal = async (item) => {
    setItemToShare(item);
    setSingleShareEmail('');
    const existing = await fetchItemShares(item.id);
    setItemSharesList(existing);
    setSingleShareModalVisible(true);
  };

  const handleAddSingleShare = async () => {
    if (!singleShareEmail.trim() || !itemToShare) return;
    try {
      await shareSingleItemWithEmail(itemToShare.id, singleShareEmail);
      setSingleShareEmail('');
      const updated = await fetchItemShares(itemToShare.id);
      setItemSharesList(updated);
      Alert.alert('השובר שותף בהצלחה! 🤝');
    } catch (err) {
      Alert.alert('שגיאה', err?.message || 'לא ניתן לשתף שובר זה');
    }
  };

  const handleRemoveSingleShare = async (shareId) => {
    try {
      await removeSingleItemShare(shareId);
      const updated = await fetchItemShares(itemToShare.id);
      setItemSharesList(updated);
    } catch (err) {
      Alert.alert('שגיאה', 'לא ניתן להסיר שיתוף');
    }
  };

  const walletStats = useMemo(() => {
    let totalActiveBalance = 0;
    let storeCreditBalance = 0;
    let voucherGiftBalance = 0;
    let expiringSoonCount = 0;

    for (const item of userWallet) {
      if (item.type === 'CreditCard') continue;
      const bal = Number(item.balance) || 0;
      const exp = getExpiryStatus(item.expiryDate);

      if (!item.isLocked && bal > 0) {
        totalActiveBalance += bal;
        if (item.type === 'StoreCredit') {
          storeCreditBalance += bal;
        } else {
          voucherGiftBalance += bal;
        }
        if (exp && exp.level === 'soon') {
          expiringSoonCount += 1;
        }
      }
    }

    return {
      totalActiveBalance,
      storeCreditBalance,
      voucherGiftBalance,
      expiringSoonCount,
    };
  }, [userWallet]);

  const displayedWallet = useMemo(() => {
    const filtered = userWallet.filter((item) => {
      const exp = getExpiryStatus(item.expiryDate);
      if (exp?.level === 'expired' && activeFilter !== 'expiring') {
        return false;
      }

      if (activeFilter === 'all') return true;
      if (activeFilter === 'StoreCredit') return item.type === 'StoreCredit';
      if (activeFilter === 'Voucher')
        return item.type === 'Voucher' || item.type === 'GiftCard';
      if (activeFilter === 'expiring') {
        return exp && exp.level === 'soon';
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (Boolean(a.isLocked) !== Boolean(b.isLocked)) {
        return a.isLocked ? 1 : -1;
      }

      const aHasBal = a.type === 'CreditCard' || Number(a.balance) > 0;
      const bHasBal = b.type === 'CreditCard' || Number(b.balance) > 0;
      if (aHasBal !== bHasBal) {
        return aHasBal ? -1 : 1;
      }

      const aExp = getExpiryStatus(a.expiryDate);
      const bExp = getExpiryStatus(b.expiryDate);
      if (aExp && bExp) return aExp.diffDays - bExp.diffDays;
      if (aExp && !bExp) return -1;
      if (!aExp && bExp) return 1;

      return 0;
    });
  }, [userWallet, activeFilter]);

  const openAddModal = () => {
    setEditingItemId(null);
    setName('');
    setItemType('Voucher');
    setBalance('');
    setDiscountPct('');
    setExpiryDate('');
    setBarcode('');
    setSelectedBrands([]);
    setBrandSearch('');
    setReceiptImageUrl(null);
    setModalVisible(true);
  };

  const openEditModal = (item) => {
    setEditingItemId(item.id);
    setName(item.name || '');
    setItemType(item.type || 'Voucher');
    setBalance(item.balance !== undefined ? String(item.balance) : '');
    setDiscountPct(item.discount !== undefined ? String(item.discount) : '');
    setExpiryDate(item.expiryDate || '');
    setBarcode(item.code || '');
    setReceiptImageUrl(item.receiptImageUrl || null);
    setBrandSearch('');

    const mappedBrands = (item.applicableBrands || []).map((b) => {
      const found = availableBrands.find(
        (ab) => String(ab.id) === String(b) || ab.name === b
      );
      return found ? found.name : b;
    });
    setSelectedBrands(mappedBrands);

    setModalVisible(true);
  };

  const openDeductModal = (item) => {
    setSelectedItemForDeduct(item);
    setDeductModalVisible(true);
  };

  const addBrandToSelection = (brandName) => {
    const clean = (brandName || '').trim();
    if (!clean) return;
    setSelectedBrands((prev) => {
      const exists = prev.some((b) => b.toLowerCase() === clean.toLowerCase());
      return exists ? prev : [...prev, clean];
    });
  };

  const removeBrandFromSelection = (brandName) => {
    setSelectedBrands((prev) => prev.filter((b) => b !== brandName));
  };

  const handleScanReceipt = async (source = 'camera') => {
    try {
      setScanningReceipt(true);
      const result = await scanAndBackupReceipt(source, availableBrands);
      if (!result) return;

      setReceiptImageUrl(result.imageUrl);

      if (result.details) {
        const d = result.details;
        if (d.title) setName(d.title);
        if (d.itemType) setItemType(d.itemType);
        if (d.amount > 0) setBalance(String(d.amount));
        if (d.expiryDate) setExpiryDate(d.expiryDate);
        if (d.barcode) setBarcode(String(d.barcode));

        const detectedBrand =
          d.matchedBrand ||
          resolveScannedBrand(null, d.title, availableBrands);

        if (detectedBrand) {
          addBrandToSelection(detectedBrand);
        }

        Alert.alert(
          'הזיכוי נסרק וגובה בהצלחה!',
          detectedBrand
            ? `זוהתה הרשת "${detectedBrand}" - בדוק את הפרטים ולחץ שמור.`
            : 'בדוק שהפרטים תקינים ולחץ שמור.'
        );
      } else {
        Alert.alert(
          'התמונה גובתה בענן',
          `פירוט: ${result.aiError || 'המודל החזיר JSON ריק או ללא סכום'}`
        );
      }
    } catch (err) {
      Alert.alert(
        'שגיאה בסריקה',
        err?.message || 'לא ניתן היה לסרוק את התמונה'
      );
    } finally {
      setScanningReceipt(false);
    }
  };

  const quickPickBrands = useMemo(() => {
    const walletBrandNames = [];
    for (const item of userWallet) {
      for (const b of item.applicableBrands || []) {
        const found = availableBrands.find(
          (ab) => String(ab.id) === String(b) || ab.name === b
        );
        if (found && !walletBrandNames.includes(found.name)) {
          walletBrandNames.push(found.name);
        }
      }
    }

    const combined = [...walletBrandNames];
    for (const b of availableBrands) {
      if (combined.length >= 8) break;
      if (b?.name && !combined.includes(b.name)) {
        combined.push(b.name);
      }
    }
    return combined;
  }, [availableBrands, userWallet]);

  const filteredSearchBrands = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    if (!q) return [];
    return availableBrands
      .filter((b) => (b.name || '').toLowerCase().includes(q))
      .slice(0, 12);
  }, [availableBrands, brandSearch]);

  const exactSearchMatchExists = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      availableBrands.some((b) => (b.name || '').trim().toLowerCase() === q) ||
      selectedBrands.some((b) => b.trim().toLowerCase() === q)
    );
  }, [availableBrands, selectedBrands, brandSearch]);

  const resolveBrandNames = (rawBrands, itemName = '') => {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const cleanNames = (Array.isArray(rawBrands) ? rawBrands : [])
      .map((b) => {
        if (!b) return null;
        const found = availableBrands.find(
          (ab) =>
            String(ab.id) === String(b) ||
            (ab.name || '').trim().toLowerCase() === String(b).trim().toLowerCase()
        );
        if (found) return found.name;
        if (uuidRegex.test(String(b))) return null;
        return String(b);
      })
      .filter(Boolean);

    if (cleanNames.length > 0) {
      return [...new Set(cleanNames)].join(', ');
    }

    if (itemName) {
      const stripped = String(itemName)
        .replace(/^(זיכוי|שובר|גיפט\s*קארד|כרטיס\s*מתנה|תו\s*קנייה)\s+/i, '')
        .trim();
      if (stripped && stripped !== 'כללי') {
        return stripped;
      }
    }

    return 'לא מוגדר';
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
      discount_pct: itemType === 'StoreCredit' ? 0 : parseFloat(discountPct || 0),
      expiry_date: expiryDate.trim() || null,
      barcode: barcode.trim() || null,
      receipt_image_url: receiptImageUrl || null,
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

  const openBarcodeModal = (item) => {
    setSelectedItemForBarcode(item);
    setBarcodeModalVisible(true);
  };

  const handleBarCodeScanned = ({ data }) => {
    setBarcode(data);
    setCameraModalVisible(false);
    Alert.alert('ברקוד נקלט בהצלחה!', `הקוד: ${data}`);
  };

  const requestCameraAccess = async () => {
    if (!permission || !permission.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('שגיאה', 'אין הרשאת שימוש במצלמה');
        return;
      }
    }
    setCameraModalVisible(true);
  };

  const getItemTypeLabel = (type) => {
    switch (type) {
      case 'StoreCredit':
        return '🧾 זיכוי מחנות';
      case 'Voucher':
        return '🎫 שובר';
      case 'GiftCard':
        return '🎁 גיפט קארד';
      default:
        return '💳 כרטיס אשראי';
    }
  };

  return (
    <View style={styles.container}>
      {currentUser?.email && (
        <View style={styles.userBar}>
          <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut}>
            <Text style={styles.signOutBtnText}>התנתק</Text>
          </TouchableOpacity>
          <Text style={styles.userEmailText} numberOfLines={1}>
            👤 {currentUser.email}
          </Text>
        </View>
      )}

      <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
        <Text style={styles.addButtonText}>
          + הוסף / סרוק זיכוי, שובר או כרטיס
        </Text>
      </TouchableOpacity>

      {userWallet.length > 0 && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryMainRow}>
            <View>
              <Text style={styles.summaryLabel}>סה״כ יתרה זמינה בארנק</Text>
              <Text style={styles.summaryTotalAmount}>
                ₪{walletStats.totalActiveBalance.toFixed(2)}
              </Text>
            </View>

            {walletStats.expiringSoonCount > 0 && (
              <TouchableOpacity
                style={styles.summaryAlertBadge}
                onPress={() =>
                  setActiveFilter((prev) =>
                    prev === 'expiring' ? 'all' : 'expiring'
                  )
                }
              >
                <Text style={styles.summaryAlertText}>
                  ⏳ {walletStats.expiringSoonCount} לניצול דחוף
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.summaryBreakdownRow}>
            <Text style={styles.summarySubItem}>
              🧾 זיכויים: ₪{walletStats.storeCreditBalance.toFixed(0)}
            </Text>
            <Text style={styles.summaryDivider}>•</Text>
            <Text style={styles.summarySubItem}>
              🎫 שוברים וגיפט קארד: ₪{walletStats.voucherGiftBalance.toFixed(0)}
            </Text>
          </View>
        </View>
      )}

      {/* באנר ניהול פריטים שפג תוקפם */}
      {(() => {
        const expiredItems = userWallet.filter((item) => {
          const status = getExpiryStatus(item.expiryDate);
          return status?.level === 'expired';
        });

        if (expiredItems.length === 0) return null;

        return (
          <View style={styles.expiredAlertCard}>
            <Text style={styles.expiredAlertTitle}>
              ⚠️ {expiredItems.length === 1
                ? 'פריט אחד בארנק פג תוקף'
                : `${expiredItems.length} פריטים בארנק פגו תוקף`}
            </Text>
            <Text style={styles.expiredAlertSub}>
              פריטים אלו אינם נכללים בחישוב הקופה. תוכל להסירם או לעדכן תוקף:
            </Text>

            {expiredItems.map((item) => (
              <View key={item.id} style={styles.expiredItemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expiredItemName}>{item.name}</Text>
                  <Text style={styles.expiredItemDate}>
                    פג בתאריך {item.expiryDate} • יתרה ₪{Number(item.balance || 0).toFixed(0)}
                  </Text>
                </View>

                <View style={styles.expiredActionsRow}>
                  <TouchableOpacity
                    style={styles.extendExpiredBtn}
                    onPress={() => openEditModal(item)}
                  >
                    <Text style={styles.extendExpiredText}>📅 עדכן</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.removeExpiredBtn}
                    onPress={() => onDeleteItem(item.id)}
                  >
                    <Text style={styles.removeExpiredText}>🗑️ הסר</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        );
      })()}

      {/* כרטיס שיתוף ארנק משפחתי מלא */}
      <View style={styles.shareCard}>
        <TouchableOpacity
          style={styles.shareHeaderRow}
          onPress={() => setShareExpanded((prev) => !prev)}
        >
          <Text style={styles.shareToggleText}>
            {shareExpanded ? '▲ סגור' : '▼ נהל שיתוף'}
          </Text>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={styles.shareTitle}>🤝 שיתוף ארנק משפחתי מלא</Text>
            <Text style={styles.shareSubtitle}>
              {sharesState.sharedByMe.length > 0 || sharesState.sharedWithMe.length > 0
                ? `משותף עם ${sharesState.sharedByMe.length} • משותף איתך ${sharesState.sharedWithMe.length}`
                : 'שתף את כל הארנק שלך עם בן/בת הזוג'}
            </Text>
          </View>
        </TouchableOpacity>

        {shareExpanded && (
          <View style={styles.shareBody}>
            <Text style={styles.shareLabel}>הוסף שותף/ה לפי כתובת אימייל:</Text>
            <View style={styles.shareInputRow}>
              <TouchableOpacity
                style={styles.shareSubmitBtn}
                onPress={handleAddShare}
                disabled={sharingLoading}
              >
                {sharingLoading ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.shareSubmitBtnText}>שתף</Text>
                )}
              </TouchableOpacity>

              <TextInput
                style={styles.shareInput}
                value={shareEmailInput}
                onChangeText={setShareEmailInput}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="partner@gmail.com"
              />
            </View>

            {sharesState.sharedByMe.length > 0 && (
              <View style={styles.shareListSection}>
                <Text style={styles.shareListHeading}>אנשים שרואים את הארנק שלך:</Text>
                {sharesState.sharedByMe.map((s) => (
                  <View key={s.id} style={styles.sharePersonRow}>
                    <TouchableOpacity
                      style={styles.removeShareBtn}
                      onPress={() => handleRemoveShare(s)}
                    >
                      <Text style={styles.removeShareText}>הסר</Text>
                    </TouchableOpacity>
                    <Text style={styles.sharePersonEmail}>{s.shared_with_email}</Text>
                  </View>
                ))}
              </View>
            )}

            {sharesState.sharedWithMe.length > 0 && (
              <View style={styles.shareListSection}>
                <Text style={styles.shareListHeading}>ארנקים ששותפו איתך:</Text>
                {sharesState.sharedWithMe.map((s) => (
                  <View key={s.id} style={styles.sharePersonRow}>
                    <View style={styles.sharedBadgePill}>
                      <Text style={styles.sharedBadgePillText}>פעיל</Text>
                    </View>
                    <Text style={styles.sharePersonEmail}>{s.owner_email}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      <View
        style={[
          styles.clubMembershipCard,
          !hasHistadrut && styles.clubMembershipCardInactive,
        ]}
      >
        <View style={styles.clubMembershipRow}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={styles.clubMembershipTitle}>
              🏛️ מועדון ביחד בשבילך (הסתדרות)
            </Text>
            <Text style={styles.clubMembershipSub}>
              {hasHistadrut
                ? 'פעיל - ארנקי ההנחה ומבצעי הרשתות מוצגים במחשבון הקופה'
                : 'כבוי - הפעל אם ברשותך כרטיס מועדון של ההסתדרות'}
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

      {userWallet.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterBar}
        >
          {[
            { id: 'all', label: `הכל (${userWallet.length})` },
            { id: 'StoreCredit', label: '🧾 זיכויים' },
            { id: 'Voucher', label: '🎫 שוברים וגיפט קארד' },
            {
              id: 'expiring',
              label:
                walletStats.expiringSoonCount > 0
                  ? `⏳ פג בקרוב (${walletStats.expiringSoonCount})`
                  : '⏳ פג בקרוב',
            },
          ].map((tab) => {
            const isActive = activeFilter === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.filterPill, isActive && styles.activeFilterPill]}
                onPress={() => setActiveFilter(tab.id)}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    isActive && styles.activeFilterPillText,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {displayedWallet.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            {userWallet.length === 0
              ? 'הארנק שלך ריק כרגע.'
              : 'אין פריטים התואמים לסינון שנבחר.'}
          </Text>
          <Text style={styles.emptySubText}>
            {userWallet.length === 0
              ? 'לחץ על הכפתור למעלה כדי לצלם זיכוי או להוסיף שוברים.'
              : 'בחר קטגוריה אחרת בסרגל הסינון למעלה.'}
          </Text>
        </View>
      ) : (
        displayedWallet.map((item) => {
          const expiryStatus = getExpiryStatus(item.expiryDate);
          const isExpiringSoon = expiryStatus?.level === 'soon';
          const isSharedItem =
            Boolean(item.userId) &&
            Boolean(currentUser?.id) &&
            item.userId !== currentUser.id;

          return (
            <View
              key={item.id}
              style={[
                styles.card,
                item.isLocked && styles.lockedCard,
                isExpiringSoon && !item.isLocked && styles.expiringSoonCard,
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <View style={styles.titleBadgeRow}>
                    <Text style={styles.cardTitle}>{item.name}</Text>
                    {isSharedItem && (
                      <View style={styles.sharedItemBadge}>
                        <Text style={styles.sharedItemBadgeText}>🤝 משותף</Text>
                      </View>
                    )}
                    {expiryStatus?.label && (
                      <View style={[styles.expiryBadge, styles.expiryBadgeSoon]}>
                        <Text style={[styles.expiryBadgeText, styles.expiryBadgeTextSoon]}>
                          {expiryStatus.label}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.cardType}>
                    {getItemTypeLabel(item.type)}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {!isSharedItem && (
                    <TouchableOpacity
                      style={styles.singleShareIconBtn}
                      onPress={() => openSingleShareModal(item)}
                    >
                      <Text style={{ fontSize: 14 }}>🔗</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.editButton}
                    onPress={() => openEditModal(item)}
                  >
                    <Text style={styles.editButtonText}>✏️</Text>
                  </TouchableOpacity>

                  {!isSharedItem && (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => onDeleteItem(item.id)}
                    >
                      <Text style={styles.deleteButtonText}>🗑️</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <View style={styles.cardBody}>
                {item.type !== 'CreditCard' && (
                  <View style={styles.balanceRow}>
                    <Text style={styles.cardDetail}>
                      <Text style={styles.bold}>יתרה:</Text> ₪
                      {Number(item.balance).toFixed(2)}
                      {item.originalAmount &&
                      Number(item.originalAmount) > Number(item.balance)
                        ? ` (מתוך ₪${Number(item.originalAmount).toFixed(2)})`
                        : ''}
                    </Text>

                    <TouchableOpacity
                      style={styles.deductButton}
                      onPress={() => openDeductModal(item)}
                    >
                      <Text style={styles.deductButtonText}>✂️ קזז יתרה</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {item.discount > 0 && (
                  <Text style={styles.cardDetail}>
                    <Text style={styles.bold}>הנחת מועדון:</Text> {item.discount}%
                  </Text>
                )}
                {item.expiryDate && (
                  <Text
                    style={[
                      styles.cardDetail,
                      isExpiringSoon && { color: '#D97706', fontWeight: '600' },
                    ]}
                  >
                    <Text style={styles.bold}>תוקף:</Text> {item.expiryDate}
                  </Text>
                )}
                <Text style={styles.cardDetail}>
                  <Text style={styles.bold}>רשתות תואמות:</Text>{' '}
                  {resolveBrandNames(item.applicableBrands, item.name)}
                </Text>

                {item.receiptImageUrl ? (
                  <TouchableOpacity
                    style={styles.viewReceiptButton}
                    onPress={() => setReceiptViewerUrl(item.receiptImageUrl)}
                  >
                    <Text style={styles.viewReceiptButtonText}>
                      🧾 צפה בצילום הזיכוי המקורי
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {item.code ? (
                <View style={styles.codeContainer}>
                  <Text style={styles.codeText} numberOfLines={1}>
                    קוד: {item.code}
                  </Text>

                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      style={styles.showBarcodeButton}
                      onPress={() => openBarcodeModal(item)}
                    >
                      <Text style={styles.showBarcodeButtonText}>
                        🔍 הצג לקופה
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.copyButton}
                      onPress={async () => {
                        await Clipboard.setStringAsync(item.code);
                        Alert.alert(
                          'הועתק!',
                          `הקוד ${item.code} הועתק ללוח הגזירים`
                        );
                      }}
                    >
                      <Text style={styles.copyButtonText}>📋 העתק</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              <View style={styles.lockRow}>
                <Text style={styles.lockLabel}>
                  נעול לשימוש במחשבון (לא לשימוש קיימת)
                </Text>
                <Switch
                  value={item.isLocked}
                  onValueChange={() => onToggleLock(item.id)}
                  trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
                  thumbColor={item.isLocked ? '#0284C7' : '#F1F5F9'}
                />
              </View>
            </View>
          );
        })
      )}

      {/* מודאל ברקוד */}
      <Modal
        visible={barcodeModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setBarcodeModalVisible(false)}
      >
        <View style={styles.barcodeModalOverlay}>
          <View style={styles.barcodeCard}>
            <Text style={styles.barcodeModalTitle}>
              {selectedItemForBarcode?.name}
            </Text>
            <Text style={styles.barcodeModalSubtitle}>
              הצג ברקוד זה לקופאי בסיום הקנייה
            </Text>

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

            {selectedItemForBarcode?.balance !== undefined &&
              selectedItemForBarcode?.type !== 'CreditCard' && (
                <Text style={styles.barcodeBalanceText}>
                  יתרה עדכנית: ₪
                  {Number(selectedItemForBarcode.balance).toFixed(2)}
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

     {/* מודאל שיתוף שובר פרטני */}
      <Modal
        visible={singleShareModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setSingleShareModalVisible(false)}
      >
        <View style={styles.barcodeModalOverlay}>
          <View style={{ backgroundColor: '#FFF', width: '90%', borderRadius: 20, padding: 24, alignItems: 'center', elevation: 5 }}>
            <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#1E293B', marginBottom: 4, textAlign: 'center' }}>שיתוף השובר: {itemToShare?.name}</Text>
            <Text style={{ fontSize: 13, color: '#64748B', marginBottom: 16, textAlign: 'center' }}>אפשר לשתף פריט זה ספציפית עם אדם נוסף</Text>

            <TextInput
              style={[styles.input, { width: '100%', marginBottom: 12 }]}
              placeholder="הכנס מייל לשיתוף השובר..."
              value={singleShareEmail}
              onChangeText={setSingleShareEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={{ backgroundColor: '#0284C7', width: '100%', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginBottom: 14 }}
              onPress={handleAddSingleShare}
            >
              <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 16 }}>שתף שובר זה</Text>
            </TouchableOpacity>

            {itemSharesList.length > 0 && (
              <View style={{ width: '100%', marginBottom: 14, maxHeight: 120 }}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#475569', textAlign: 'right', marginBottom: 4 }}>
                  משותף כרגע עם:
                </Text>
                <ScrollView nestedScrollEnabled={true}>
                  {itemSharesList.map((sh) => (
                    <View key={sh.id} style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F1F5F9', padding: 8, borderRadius: 6, marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, color: '#1E293B' }}>{sh.shared_with_email}</Text>
                      <TouchableOpacity onPress={() => handleRemoveSingleShare(sh.id)}>
                        <Text style={{ color: '#DC2626', fontWeight: 'bold', fontSize: 12 }}>הסר</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            <TouchableOpacity
              style={{ backgroundColor: '#334155', width: '100%', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
              onPress={() => setSingleShareModalVisible(false)}
            >
              <Text style={{ color: '#FFF', fontSize: 16, fontWeight: 'bold' }}>סגור</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* מודאל הוספה / עריכה */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingItemId ? '✏️ עריכת פריט בארנק' : '➕ הוספת פריט חדש לארנק'}
            </Text>

            <ScrollView
              contentContainerStyle={{ paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.scanReceiptRow}>
                <TouchableOpacity
                  style={styles.scanReceiptCameraBtn}
                  onPress={() => handleScanReceipt('camera')}
                  disabled={scanningReceipt}
                >
                  <Text style={styles.scanReceiptCameraText}>
                    {scanningReceipt
                      ? '⏳ מפענח ומגבה...'
                      : '📸 צלם זיכוי למילוי אוטומטי'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.scanReceiptGalleryBtn}
                  onPress={() => handleScanReceipt('gallery')}
                  disabled={scanningReceipt}
                >
                  <Text style={styles.scanReceiptGalleryText}>🖼️ מהגלריה</Text>
                </TouchableOpacity>
              </View>

              {scanningReceipt && (
                <ActivityIndicator
                  size="small"
                  color="#0284C7"
                  style={{ marginBottom: 10 }}
                />
              )}

              {receiptImageUrl ? (
                <View style={styles.receiptPreviewBox}>
                  <Image
                    source={{ uri: receiptImageUrl }}
                    style={styles.receiptPreviewImage}
                    resizeMode="cover"
                  />
                  <Text style={styles.receiptPreviewBadge}>
                    ✅ צילום הזיכוי מגובה בענן
                  </Text>
                </View>
              ) : null}

              <Text style={styles.label}>שם הפריט</Text>
              <TextInput
                style={styles.input}
                placeholder="הכנס שם..."
                value={name}
                onChangeText={setName}
              />

              <Text style={styles.label}>סוג פריט</Text>
              <View style={styles.typeRow}>
                {['Voucher', 'StoreCredit', 'GiftCard', 'CreditCard'].map(
                  (t) => (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.typeButton,
                        itemType === t && styles.activeTypeButton,
                      ]}
                      onPress={() => setItemType(t)}
                    >
                      <Text
                        style={[
                          styles.typeButtonText,
                          itemType === t && styles.activeTypeButtonText,
                        ]}
                      >
                        {t === 'Voucher'
                          ? 'שובר'
                          : t === 'StoreCredit'
                          ? 'זיכוי'
                          : t === 'GiftCard'
                          ? 'גיפט קארד'
                          : 'אשראי'}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </View>

              {itemType !== 'CreditCard' && (
                <>
                  <Text style={styles.label}>
                    {itemType === 'StoreCredit'
                      ? 'סכום הזיכוי / יתרה (₪)'
                      : 'יתרה (₪)'}
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0.00"
                    keyboardType="numeric"
                    value={balance}
                    onChangeText={setBalance}
                  />
                </>
              )}

              {itemType !== 'StoreCredit' && (
                <>
                  <Text style={styles.label}>אחוז הנחה (אופציונלי)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    keyboardType="numeric"
                    value={discountPct}
                    onChangeText={setDiscountPct}
                  />
                </>
              )}

              <Text style={styles.label}>תאריך תוקף</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                value={expiryDate}
                onChangeText={setExpiryDate}
              />

              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 12,
                }}
              >
                <Text style={styles.label}>ברקוד / קוד קופון (אופציונלי)</Text>
                <TouchableOpacity
                  style={styles.scanButtonInline}
                  onPress={requestCameraAccess}
                >
                  <Text style={styles.scanButtonInlineText}>
                    📷 סרוק ברקוד בלבד
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.input}
                placeholder="הקלד קוד או סרוק ברקוד..."
                value={barcode}
                onChangeText={setBarcode}
              />

              <Text style={styles.label}>רשתות תואמות</Text>

              {selectedBrands.length > 0 && (
                <View style={styles.selectedBrandsBox}>
                  {selectedBrands.map((bName) => (
                    <TouchableOpacity
                      key={bName}
                      style={styles.selectedTagChip}
                      onPress={() => removeBrandFromSelection(bName)}
                    >
                      <Text style={styles.selectedTagText}>✓ {bName} ✕</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <TextInput
                style={styles.brandSearchInput}
                placeholder="🔍 חפש רשת מתוך המאגר או הוסף חדשה..."
                value={brandSearch}
                onChangeText={setBrandSearch}
              />

              {brandSearch.trim().length > 0 ? (
                <View style={styles.brandSearchResultsBox}>
                  {filteredSearchBrands.map((b) => {
                    const isSelected = selectedBrands.some(
                      (sb) => sb.toLowerCase() === b.name.toLowerCase()
                    );
                    return (
                      <TouchableOpacity
                        key={b.id}
                        style={styles.brandSearchResultRow}
                        onPress={() => {
                          if (isSelected) {
                            removeBrandFromSelection(b.name);
                          } else {
                            addBrandToSelection(b.name);
                          }
                          setBrandSearch('');
                        }}
                      >
                        <Text style={styles.brandSearchResultStatus}>
                          {isSelected ? '✓ נבחר' : '+ בחר'}
                        </Text>
                        <Text style={styles.brandSearchResultName}>{b.name}</Text>
                      </TouchableOpacity>
                    );
                  })}

                  {!exactSearchMatchExists && (
                    <TouchableOpacity
                      style={styles.addNewBrandRow}
                      onPress={() => {
                        addBrandToSelection(brandSearch.trim());
                        setBrandSearch('');
                      }}
                    >
                      <Text style={styles.addNewBrandText}>
                        ➕ הוסף את "{brandSearch.trim()}" למאגר הרשתות ובחר
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <View style={styles.quickBrandsRow}>
                  {quickPickBrands.map((bName) => {
                    const isSelected = selectedBrands.some(
                      (sb) => sb.toLowerCase() === bName.toLowerCase()
                    );
                    return (
                      <TouchableOpacity
                        key={bName}
                        style={[
                          styles.brandChip,
                          isSelected && styles.activeBrandChip,
                        ]}
                        onPress={() =>
                          isSelected
                            ? removeBrandFromSelection(bName)
                            : addBrandToSelection(bName)
                        }
                      >
                        <Text
                          style={[
                            styles.brandChipText,
                            isSelected && styles.activeBrandChipText,
                          ]}
                        >
                          {bName}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

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
                  <Text style={styles.saveButtonText}>
                    {editingItemId ? 'שמור שינויים' : 'שמור בארנק'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* מודאל מצלמה לברקוד */}
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
              barcodeTypes: ['qr', 'pdf417', 'code128', 'ean13', 'ean8'],
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

      <DeductCreditModal
        visible={deductModalVisible}
        item={selectedItemForDeduct}
        onClose={() => setDeductModalVisible(false)}
        onSuccess={onRefreshWallet}
      />

      <Modal
        visible={Boolean(receiptViewerUrl)}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setReceiptViewerUrl(null)}
      >
        <View style={styles.receiptViewerOverlay}>
          {receiptViewerUrl ? (
            <Image
              source={{ uri: receiptViewerUrl }}
              style={styles.receiptViewerImage}
              resizeMode="contain"
            />
          ) : null}
          <TouchableOpacity
            style={styles.closeReceiptViewerBtn}
            onPress={() => setReceiptViewerUrl(null)}
          >
            <Text style={styles.closeReceiptViewerText}>סגור תמונה</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingBottom: 20 },
  userBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  userEmailText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    flex: 1,
    textAlign: 'right',
    marginLeft: 10,
  },
  signOutBtn: {
    backgroundColor: '#FFF',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  signOutBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#DC2626',
  },
  addButton: {
    backgroundColor: '#0284C7',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 14,
    elevation: 2,
  },
  addButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  summaryCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
  },
  summaryMainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  summaryTotalAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#38BDF8',
    marginTop: 2,
  },
  summaryAlertBadge: {
    backgroundColor: '#FEF3C7',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  summaryAlertText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: 'bold',
  },
  summaryBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    gap: 8,
  },
  summarySubItem: {
    fontSize: 12,
    color: '#CBD5E1',
  },
  summaryDivider: {
    color: '#475569',
    fontSize: 12,
  },

  expiredAlertCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  expiredAlertTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#991B1B',
    textAlign: 'right',
  },
  expiredAlertSub: {
    fontSize: 12,
    color: '#7F1D1D',
    textAlign: 'right',
    marginTop: 2,
    marginBottom: 10,
  },
  expiredItemRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 10,
    borderRadius: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  expiredItemName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1E293B',
    textAlign: 'right',
  },
  expiredItemDate: {
    fontSize: 12,
    color: '#DC2626',
    textAlign: 'right',
    marginTop: 2,
  },
  expiredActionsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  extendExpiredBtn: {
    backgroundColor: '#E0F2FE',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  extendExpiredText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#0369A1',
  },
  removeExpiredBtn: {
    backgroundColor: '#FEE2E2',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  removeExpiredText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#B91C1C',
  },

  shareCard: {
    backgroundColor: '#F5F3FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  shareHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  shareToggleText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#6D28D9',
    marginRight: 8,
  },
  shareTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#4C1D95',
    textAlign: 'right',
  },
  shareSubtitle: {
    fontSize: 12,
    color: '#6D28D9',
    textAlign: 'right',
    marginTop: 2,
  },
  shareBody: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#EDE9FE',
  },
  shareLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4C1D95',
    textAlign: 'right',
    marginBottom: 6,
  },
  shareInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  shareInput: {
    flex: 1,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#C4B5FD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    textAlign: 'right',
  },
  shareSubmitBtn: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareSubmitBtnText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  shareListSection: {
    marginTop: 12,
  },
  shareListHeading: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#5B21B6',
    textAlign: 'right',
    marginBottom: 6,
  },
  sharePersonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#EDE9FE',
  },
  sharePersonEmail: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
  removeShareBtn: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  removeShareText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#B91C1C',
  },
  sharedBadgePill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sharedBadgePillText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#166534',
  },

  clubMembershipCard: {
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
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

  filterBar: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 14,
  },
  filterPill: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#E2E8F0',
  },
  activeFilterPill: {
    backgroundColor: '#0284C7',
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  activeFilterPillText: {
    color: '#FFF',
  },

  emptyContainer: { alignItems: 'center', marginTop: 40, padding: 20 },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#475569',
    marginBottom: 8,
  },
  emptySubText: { fontSize: 14, color: '#94A3B8', textAlign: 'center' },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 1,
  },
  lockedCard: { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
  expiringSoonCard: { borderColor: '#F59E0B', borderWidth: 1.5 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  titleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#1E293B' },
  sharedItemBadge: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  sharedItemBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#6D28D9',
  },
  expiryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  expiryBadgeSoon: { backgroundColor: '#FEF3C7' },
  expiryBadgeText: { fontSize: 11, fontWeight: 'bold' },
  expiryBadgeTextSoon: { color: '#B45309' },
  cardType: { fontSize: 12, color: '#64748B', marginTop: 2 },
  singleShareIconBtn: { padding: 4, marginRight: 2 },
  editButton: { padding: 4, marginRight: 4 },
  editButtonText: { fontSize: 16 },
  deleteButton: { padding: 4 },
  deleteButtonText: { fontSize: 16 },
  cardBody: { marginBottom: 10 },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  deductButton: {
    backgroundColor: '#DCFCE7',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  deductButtonText: { color: '#166534', fontSize: 12, fontWeight: 'bold' },
  cardDetail: { fontSize: 14, color: '#334155', marginBottom: 4 },
  bold: { fontWeight: '600', color: '#0F172A' },
  viewReceiptButton: {
    backgroundColor: '#FEF3C7',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  viewReceiptButtonText: { color: '#92400E', fontSize: 12, fontWeight: 'bold' },
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
  lockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  lockLabel: { fontSize: 12, color: '#64748B', flex: 1, marginRight: 10 },

  barcodeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  barcodeCard: {
    backgroundColor: '#FFF',
    width: '100%',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    elevation: 5,
  },
  barcodeModalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 4,
    textAlign: 'center',
  },
  barcodeModalSubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 24,
    textAlign: 'center',
  },
  barcodeVisualBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  barcodeLines: {
    flexDirection: 'row',
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 12,
  },
  barLine: { backgroundColor: '#0F172A', height: '100%', borderRadius: 1 },
  barcodeLargeText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0F172A',
    letterSpacing: 2,
  },
  barcodeBalanceText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0284C7',
    marginBottom: 20,
  },
  closeBarcodeButton: {
    backgroundColor: '#334155',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  closeBarcodeButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '90%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 14,
    textAlign: 'center',
  },
  scanReceiptRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  scanReceiptCameraBtn: {
    flex: 2,
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  scanReceiptCameraText: { color: '#FFF', fontWeight: 'bold', fontSize: 13 },
  scanReceiptGalleryBtn: {
    flex: 1,
    backgroundColor: '#E0F2FE',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  scanReceiptGalleryText: { color: '#0284C7', fontWeight: 'bold', fontSize: 13 },
  receiptPreviewBox: {
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  receiptPreviewImage: { width: '100%', height: 130, borderRadius: 8 },
  receiptPreviewBadge: {
    fontSize: 12,
    color: '#16A34A',
    fontWeight: 'bold',
    marginTop: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    marginTop: 12,
    textAlign: 'right',
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    backgroundColor: '#F8FAFC',
    textAlign: 'right',
  },
  scanButtonInline: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  scanButtonInlineText: { fontSize: 12, color: '#0284C7', fontWeight: 'bold' },
  typeRow: { flexDirection: 'row', gap: 6 },
  typeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  activeTypeButton: { backgroundColor: '#0284C7', borderColor: '#0284C7' },
  typeButtonText: { color: '#64748B', fontWeight: '600', fontSize: 12 },
  activeTypeButtonText: { color: '#FFF' },

  selectedBrandsBox: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  selectedTagChip: {
    backgroundColor: '#0284C7',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  selectedTagText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  brandSearchInput: {
    borderWidth: 1,
    borderColor: '#94A3B8',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    backgroundColor: '#FFF',
    textAlign: 'right',
    marginBottom: 8,
  },
  brandSearchResultsBox: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
    marginBottom: 6,
  },
  brandSearchResultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  brandSearchResultName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  brandSearchResultStatus: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#0284C7',
  },
  addNewBrandRow: {
    backgroundColor: '#DCFCE7',
    padding: 12,
    alignItems: 'center',
  },
  addNewBrandText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: 'bold',
  },
  quickBrandsRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  brandChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
  },
  activeBrandChip: { backgroundColor: '#0284C7', borderColor: '#0284C7' },
  brandChipText: { fontSize: 12, color: '#475569' },
  activeBrandChipText: { color: '#FFF', fontWeight: 'bold' },

  modalActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  actionButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: { backgroundColor: '#F1F5F9' },
  cancelButtonText: { color: '#475569', fontWeight: 'bold' },
  saveButton: { backgroundColor: '#0284C7' },
  saveButtonText: { color: '#FFF', fontWeight: 'bold' },
  closeCameraButton: {
    backgroundColor: '#EF4444',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeCameraButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  receiptViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  receiptViewerImage: { width: '100%', height: '78%', borderRadius: 12 },
  closeReceiptViewerBtn: {
    backgroundColor: '#FFF',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 10,
    marginTop: 16,
  },
  closeReceiptViewerText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 16,
  },
});