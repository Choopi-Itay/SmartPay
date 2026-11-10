import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, Text, View, TouchableOpacity, ScrollView, 
  Alert, SafeAreaView, Keyboard, StatusBar, Platform, 
  ActivityIndicator, KeyboardAvoidingView 
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase } from './supabase';

// ייבוא המסכים
import CheckoutScreen from './src/screens/CheckoutScreen';
import WalletScreen from './src/screens/WalletScreen';

// ייבוא פונקציות השרות של הארנק
import { 
  fetchBrands, fetchWalletItems, updateItemLockStatus, 
  updateItemBalance, deleteWalletItemFromDb, saveNewWalletItem 
} from './src/services/walletService';

// ייבוא צינור היבוא/הסנכרון של המועדונים
//import { runInitialClubIngestion } from './src/services/clubIngestionService';
//ייבוא נתוני BUYME
import { fetchLiveBuyMeData } from './src/services/buymeService';

const DEFAULT_BRANDS = ['שופרסל', 'Fox', 'BuyMe', 'המשביר', 'רמי לוי', 'סופר-פארם', 'קסטרו', 'כללי'];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState('checkout');
  const [availableBrands, setAvailableBrands] = useState([]);
  const [userWallet, setUserWallet] = useState([]);

  // בדיקת תמיכה בחומרה ביומטרית בעליית האפליקציה
  useEffect(() => {
    (async () => {
      await LocalAuthentication.hasHardwareAsync();
    })();
  }, []);

  // טעינת נתונים והפעלת סנכרון בזמן אמת לאחר אימות ביומטרי
  useEffect(() => {
    if (!isAuthenticated) return;

    loadInitialData();

    // ⚡ שליפת מותגים והנחות בלייב מ-BuyMe והזרקתם ל-Supabase
    fetchLiveBuyMeData()
      .then(res => console.log('✅ BuyMe Live Ingestion completed:', res))
      .catch(err => console.log('❌ BuyMe Ingestion error:', err));

    // ⚡ הפעלת הזרקת המועדונים (רץ פעם אחת ברקע ומעדכן את DB ב-Supabase)
   // runInitialClubIngestion()
    //  .then(res => console.log('✅ Club rules ingestion status:', res))
    //  .catch(err => console.log('❌ Ingestion error:', err));

    // האזנה לשינויים בזמן אמת בטבלת wallet_items
    const channel = supabase
      .channel('wallet_realtime_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallet_items' },
        () => loadWallet()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const brandsData = await fetchBrands();
      if (brandsData.length > 0) {
        setAvailableBrands(brandsData);
      } else {
        setAvailableBrands(DEFAULT_BRANDS.map(name => ({ id: name, name })));
      }
      await loadWallet();
    } catch (err) {
      console.log('Error loading initial data:', err);
      setAvailableBrands(DEFAULT_BRANDS.map(name => ({ id: name, name })));
    } finally {
      setLoading(false);
    }
  };

  const loadWallet = async () => {
    try {
      const walletData = await fetchWalletItems();
      setUserWallet(walletData);
    } catch (err) {
      console.log('Error loading wallet:', err);
    }
  };

  const handleBiometricAuth = async () => {
    try {
      const hasEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasEnrolled) {
        setIsAuthenticated(true);
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'אימות ביומטרי ל-SmartPay',
      });
      if (result.success) {
        setIsAuthenticated(true);
      } else {
        Alert.alert('אימות נכשל', 'לא ניתן היה לאמת את הזהות');
      }
    } catch (error) {
      setIsAuthenticated(true);
    }
  };

  const handleToggleLock = async (id) => {
    const updated = userWallet.map(item => item.id === id ? { ...item, isLocked: !item.isLocked } : item);
    setUserWallet(updated);
    const target = userWallet.find(i => i.id === id);
    if (target) {
      await updateItemLockStatus(id, !target.isLocked);
    }
  };

  const handleConfirmPurchase = async (recommendation) => {
    if (!recommendation) return;

    for (const planItem of recommendation.plan) {
      if (planItem.type === 'Voucher') {
        try {
          await updateItemBalance(planItem.id, planItem.amount);
        } catch (e) {
          console.log('RPC deduct balance sync error:', e);
        }
      }
    }

    await loadWallet();
    Alert.alert('הצלחה 🎉', 'הקנייה אושרה והיתרות עודכנו בענן!');
  };

  const handleAddItem = async (payload, selectedBrands) => {
    setLoading(true);
    try {
      await saveNewWalletItem(payload, selectedBrands, availableBrands);
      Alert.alert('הצלחה 🎉', `התו "${payload.name || payload.title}" נוסף בהצלחה!`);
      await loadWallet();
    } catch (e) {
      Alert.alert('שגיאה', 'אירעה שגיאה בעת שמירת הפריט');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateItem = async (id, payload, selectedBrands) => {
    setLoading(true);
    try {
      const { error: updateError } = await supabase
        .from('wallet_items')
        .update({
          title: payload.name || payload.title,
          item_type: payload.item_type || payload.type,
          current_balance: payload.balance ?? payload.current_balance ?? 0,
          original_amount: payload.original_amount || payload.balance || 0,
          expiry_date: payload.expiry_date || payload.expiryDate || null,
          barcode_data: payload.barcode || payload.barcode_data || '',
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (updateError) throw updateError;

      const { error: deleteError } = await supabase
        .from('item_brands')
        .delete()
        .eq('item_id', id);

      if (deleteError) console.log('Error clearing old item_brands:', deleteError);

      if (selectedBrands && selectedBrands.length > 0) {
        const brandInserts = selectedBrands.map(brandName => {
          const brandObj = availableBrands.find(b => b.name === brandName);
          return {
            item_id: id,
            brand_id: brandObj ? brandObj.id : brandName
          };
        });

        const { error: insertError } = await supabase
          .from('item_brands')
          .insert(brandInserts);

        if (insertError) throw insertError;
      }

      await loadWallet();
      Alert.alert('הצלחה 🎉', `התו עודכן בהצלחה!`);
    } catch (e) {
      console.log('General update error:', e);
      Alert.alert('שגיאה', 'אירעה שגיאה בעת עדכון הפריט בענן');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (id) => {
    Alert.alert(
      'מחיקת פריט',
      'האם אתה בטוח שברצונך למחוק פריט זה מהארנק?',
      [
        { text: 'ביטול', style: 'cancel' },
        { 
          text: 'מחק', 
          style: 'destructive',
          onPress: async () => {
            setUserWallet(userWallet.filter(item => item.id !== id));
            await deleteWalletItemFromDb(id);
          } 
        }
      ]
    );
  };

  // מסך נעילה ביומטרי
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.lockSafeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#1E293B" />
        <View style={styles.lockContainer}>
          <Text style={styles.logoText}>SmartPay 🔒</Text>
          <Text style={styles.subTitleText}>ארנק חכם לחיסכון במעמד הקופה</Text>
          <TouchableOpacity style={styles.authButton} onPress={handleBiometricAuth}>
            <Text style={styles.authButtonText}>התחבר באמצעות זיהוי ביומטרי</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // המסך הראשי
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      {/* תפריט לשוניות עליון */}
      <View style={styles.tabNav}>
        <TouchableOpacity 
          style={[styles.tabButton, currentTab === 'checkout' && styles.activeTabButton]}
          onPress={() => { Keyboard.dismiss(); setCurrentTab('checkout'); }}
        >
          <Text style={[styles.tabText, currentTab === 'checkout' && styles.activeTabText]}>🛒 מחשבון קופה</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.tabButton, currentTab === 'wallet' && styles.activeTabButton]}
          onPress={() => { Keyboard.dismiss(); setCurrentTab('wallet'); }}
        >
          <Text style={[styles.tabText, currentTab === 'wallet' && styles.activeTabText]}>💳 ניהול ארנק ({userWallet.length})</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView 
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent} 
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled={true}
          showsVerticalScrollIndicator={true}
        >
          {loading && (
            <View style={{ padding: 10, alignItems: 'center' }}>
              <ActivityIndicator size="small" color="#0284C7" />
              <Text style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>מסנכרן נתונים...</Text>
            </View>
          )}

          {currentTab === 'checkout' ? (
            <CheckoutScreen 
              userWallet={userWallet}
              availableBrands={availableBrands}
              onToggleLock={handleToggleLock}
              onConfirmPurchase={handleConfirmPurchase}
            />
          ) : (
            <WalletScreen 
              userWallet={userWallet}
              availableBrands={availableBrands}
              onAddItem={handleAddItem}
              onUpdateItem={handleUpdateItem}
              onDeleteItem={handleDeleteItem}
              onToggleLock={handleToggleLock}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  lockSafeArea: { flex: 1, backgroundColor: '#1E293B', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  lockContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1E293B', padding: 20 },
  logoText: { fontSize: 36, fontWeight: 'bold', color: '#38BDF8', marginBottom: 10 },
  subTitleText: { fontSize: 16, color: '#94A3B8', marginBottom: 40, textAlign: 'center' },
  authButton: { backgroundColor: '#0EA5E9', paddingVertical: 15, paddingHorizontal: 30, borderRadius: 12 },
  authButtonText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  container: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  scrollContent: { 
    paddingHorizontal: 20, 
    paddingTop: 10, 
    paddingBottom: 120 
  },
  tabNav: { flexDirection: 'row', backgroundColor: '#E2E8F0', padding: 4, marginTop: 5 },
  tabButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  activeTabButton: { backgroundColor: '#FFF', borderRadius: 8, elevation: 2 },
  tabText: { fontSize: 15, fontWeight: '600', color: '#64748B' },
  activeTabText: { color: '#0284C7', fontWeight: 'bold' },
});