import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  Keyboard,
  StatusBar,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase } from './supabase';

// ייבוא המסכים
import AuthScreen from './src/screens/AuthScreen';
import CheckoutScreen from './src/screens/CheckoutScreen';
import WalletScreen from './src/screens/WalletScreen';

// ייבוא פונקציות השרות של הארנק והמועדונים
import {
  fetchBrands,
  fetchWalletItems,
  updateItemLockStatus,
  updateItemBalance,
  deleteWalletItemFromDb,
  saveNewWalletItem,
  ensureBrandsExist,
} from './src/services/walletService';
import { fetchAllActiveClubChains } from './src/services/clubBenefits';

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [hasHistadrut, setHasHistadrut] = useState(true);
  const [isBiometricUnlocked, setIsBiometricUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState('checkout');
  const [availableBrands, setAvailableBrands] = useState([]);
  const [userWallet, setUserWallet] = useState([]);
  const realtimeTimerRef = useRef(null);

  useEffect(() => {
    LocalAuthentication.hasHardwareAsync().catch(() => {});

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'SIGNED_IN') {
        setIsBiometricUnlocked(true);
      }
      if (event === 'SIGNED_OUT') {
        setIsBiometricUnlocked(false);
        setUserWallet([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !isBiometricUnlocked) return;

    loadInitialData();

    const channel = supabase
      .channel('wallet_realtime_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallet_items' },
        () => {
          if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
          realtimeTimerRef.current = setTimeout(() => {
            loadWallet();
          }, 600);
        }
      )
      .subscribe();

    return () => {
      if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [session, isBiometricUnlocked]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [brandsData, walletData] = await Promise.all([
        fetchBrands().catch((err) => {
          console.log('Error fetching brands:', err);
          return [];
        }),
        fetchWalletItems().catch((err) => {
          console.log('Error fetching wallet items:', err);
          Alert.alert(
            'שגיאה בטעינת הארנק',
            err?.message || 'בדוק חיבור ל-Supabase'
          );
          return [];
        }),
        fetchAllActiveClubChains().catch(() => []),
      ]);

      setAvailableBrands(brandsData || []);
      setUserWallet(walletData || []);
    } finally {
      setLoading(false);
    }
  };

  const loadWallet = async () => {
    try {
      const [walletData, brandsData] = await Promise.all([
        fetchWalletItems(),
        fetchBrands().catch(() => null),
      ]);
      setUserWallet(walletData);
      if (brandsData) setAvailableBrands(brandsData);
    } catch (err) {
      console.log('Error loading wallet:', err);
    }
  };

  const handleBiometricAuth = async () => {
    try {
      const hasEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasEnrolled) {
        setIsBiometricUnlocked(true);
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'אימות ביומטרי ל-SmartPay',
      });
      if (result.success) {
        setIsBiometricUnlocked(true);
      } else {
        Alert.alert('אימות נכשל', 'לא ניתן היה לאמת את הזהות');
      }
    } catch (error) {
      setIsBiometricUnlocked(true);
    }
  };

  const handleSignOut = async () => {
    Alert.alert('התנתקות', 'להתנתק מהחשבון במכשיר זה?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'התנתק',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  const handleToggleLock = async (id) => {
    const updated = userWallet.map((item) =>
      item.id === id ? { ...item, isLocked: !item.isLocked } : item
    );
    setUserWallet(updated);
    const target = userWallet.find((i) => i.id === id);
    if (target) {
      await updateItemLockStatus(id, !target.isLocked);
    }
  };

  const handleConfirmPurchase = async (recommendation) => {
    if (!recommendation) return;

    for (const planItem of recommendation.plan) {
      if (['Voucher', 'GiftCard', 'StoreCredit'].includes(planItem.type)) {
        try {
          await updateItemBalance(planItem.id, planItem.amount, planItem.name);
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
      await loadWallet();
      Alert.alert(
        'הצלחה 🎉',
        `הפריט "${payload.name || payload.title}" נוסף בהצלחה!`
      );
    } catch (e) {
      console.error('Add item error:', e);
      Alert.alert(
        'שגיאה בשמירת הפריט',
        e?.message || 'אירעה שגיאה בעת שמירת הפריט'
      );
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
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) throw updateError;

      if (payload.receipt_image_url) {
        await supabase
          .from('wallet_items')
          .update({ receipt_image_url: payload.receipt_image_url })
          .eq('id', id);
      }

      const { error: deleteError } = await supabase
        .from('item_brands')
        .delete()
        .eq('item_id', id);

      if (deleteError) {
        console.log('Error clearing old item_brands:', deleteError);
      }

      if (selectedBrands && selectedBrands.length > 0) {
        const resolvedBrands = await ensureBrandsExist(
          selectedBrands,
          availableBrands
        );
        const brandInserts = resolvedBrands.map((b) => ({
          item_id: id,
          brand_id: b.id,
        }));

        if (brandInserts.length > 0) {
          const { error: insertError } = await supabase
            .from('item_brands')
            .insert(brandInserts);

          if (insertError) throw insertError;
        }
      }

      await loadWallet();
      Alert.alert('הצלחה 🎉', 'הפריט עודכן בהצלחה!');
    } catch (e) {
      console.log('General update error:', e);
      Alert.alert(
        'שגיאה בעדכון',
        e?.message || 'אירעה שגיאה בעת עדכון הפריט בענן'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (id) => {
    Alert.alert('מחיקת פריט', 'האם אתה בטוח שברצונך למחוק פריט זה מהארנק?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: async () => {
          setUserWallet(userWallet.filter((item) => item.id !== id));
          await deleteWalletItemFromDb(id);
        },
      },
    ]);
  };

  if (authLoading) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.lockSafeArea}>
          <View style={styles.lockContainer}>
            <ActivityIndicator size="large" color="#38BDF8" />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!session) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#1E293B" />
        <AuthScreen />
      </SafeAreaProvider>
    );
  }

  if (!isBiometricUnlocked) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.lockSafeArea}>
          <StatusBar barStyle="light-content" backgroundColor="#1E293B" />
          <View style={styles.lockContainer}>
            <Text style={styles.logoText}>SmartPay 🔒</Text>
            <Text style={styles.subTitleText}>
              מחובר בתור {session.user?.email}
            </Text>
            <TouchableOpacity
              style={styles.authButton}
              onPress={handleBiometricAuth}
            >
              <Text style={styles.authButtonText}>
                התחבר באמצעות זיהוי ביומטרי
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.switchUserBtn}
              onPress={handleSignOut}
            >
              <Text style={styles.switchUserText}>החלף משתמש / התנתק</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

        <View style={styles.tabNav}>
          <TouchableOpacity
            style={[
              styles.tabButton,
              currentTab === 'checkout' && styles.activeTabButton,
            ]}
            onPress={() => {
              Keyboard.dismiss();
              setCurrentTab('checkout');
            }}
          >
            <Text
              style={[
                styles.tabText,
                currentTab === 'checkout' && styles.activeTabText,
              ]}
            >
              🛒 מחשבון קופה
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              currentTab === 'wallet' && styles.activeTabButton,
            ]}
            onPress={() => {
              Keyboard.dismiss();
              setCurrentTab('wallet');
            }}
          >
            <Text
              style={[
                styles.tabText,
                currentTab === 'wallet' && styles.activeTabText,
              ]}
            >
              💳 ניהול ארנק ({userWallet.length})
            </Text>
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
                <Text style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                  מסנכרן נתונים...
                </Text>
              </View>
            )}

            {currentTab === 'checkout' ? (
              <CheckoutScreen
                userWallet={userWallet}
                availableBrands={availableBrands}
                hasHistadrut={hasHistadrut}
                onToggleLock={handleToggleLock}
                onConfirmPurchase={handleConfirmPurchase}
              />
            ) : (
              <WalletScreen
                userWallet={userWallet}
                availableBrands={availableBrands}
                hasHistadrut={hasHistadrut}
                currentUser={session.user}
                onSignOut={handleSignOut}
                onToggleHistadrut={() => setHasHistadrut((prev) => !prev)}
                onAddItem={handleAddItem}
                onUpdateItem={handleUpdateItem}
                onDeleteItem={handleDeleteItem}
                onToggleLock={handleToggleLock}
                onRefreshWallet={loadWallet}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  lockSafeArea: {
    flex: 1,
    backgroundColor: '#1E293B',
  },
  lockContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: 20,
  },
  logoText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#38BDF8',
    marginBottom: 10,
  },
  subTitleText: {
    fontSize: 15,
    color: '#94A3B8',
    marginBottom: 34,
    textAlign: 'center',
  },
  authButton: {
    backgroundColor: '#0EA5E9',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 12,
  },
  authButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  switchUserBtn: {
    marginTop: 20,
    padding: 10,
  },
  switchUserText: {
    color: '#94A3B8',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 120,
  },
  tabNav: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    padding: 4,
    marginTop: 5,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTabButton: {
    backgroundColor: '#FFF',
    borderRadius: 8,
    elevation: 2,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748B',
  },
  activeTabText: {
    color: '#0284C7',
    fontWeight: 'bold',
  },
});