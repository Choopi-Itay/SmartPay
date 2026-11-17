import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../supabase';

export default function AuthScreen() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'verify'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);

  const translateAuthError = (msg = '') => {
    const lower = msg.toLowerCase();
    if (lower.includes('invalid login credentials')) return 'אימייל או סיסמה שגויים';
    if (lower.includes('email not confirmed')) return 'המייל טרם אומת. בדוק את תיבת הדואר שלך';
    if (lower.includes('user already registered')) return 'כתובת המייל כבר רשומה במערכת';
    if (lower.includes('password should be at least')) return 'הסיסמה חייבת להכיל לפחות 6 תווים';
    if (lower.includes('token has expired') || lower.includes('invalid')) return 'קוד האימות שגוי או שפג תוקפו';
    return msg || 'אירעה שגיאה בתהליך ההתחברות';
  };

  const handleLogin = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      Alert.alert('שגיאה', 'נא להזין אימייל וסיסמה');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        if (error.message.toLowerCase().includes('email not confirmed')) {
          setOtpCode('');
          setMode('verify');
          Alert.alert('נדרש אימות מייל', 'שלחנו אליך מייל אימות. אשר אותו או הזן את הקוד.');
          return;
        }
        throw error;
      }
    } catch (err) {
      Alert.alert('שגיאה בהתחברות', translateAuthError(err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      Alert.alert('שגיאה', 'נא להזין אימייל וסיסמה');
      return;
    }
    if (password.length < 6) {
      Alert.alert('שגיאה', 'הסיסמה חייבת להכיל לפחות 6 תווים');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('שגיאה', 'הסיסמאות אינן תואמות');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
      });

      if (error) throw error;

      if (!data.session) {
        setOtpCode('');
        setMode('verify');
      }
    } catch (err) {
      Alert.alert('שגיאה בהרשמה', translateAuthError(err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = otpCode.trim();
    if (!cleanCode) {
      Alert.alert('שגיאה', 'נא להזין את קוד האימות שנשלח למייל');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanCode,
        type: 'signup',
      });

      if (error) throw error;
    } catch (err) {
      Alert.alert('אימות נכשל', translateAuthError(err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleResendEmail = async () => {
    const cleanEmail = email.trim().toLowerCase();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: cleanEmail,
      });
      if (error) throw error;
      Alert.alert('נשלח שוב ✉️', `מייל אימות חדש נשלח אל ${cleanEmail}`);
    } catch (err) {
      Alert.alert('שגיאה', translateAuthError(err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerBox}>
            <Text style={styles.logoText}>SmartPay 💳</Text>
            <Text style={styles.subtitleText}>
              ניהול שוברים, זיכויים והטבות מועדון חכם
            </Text>
          </View>

          {mode === 'verify' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>✉️ אימות כתובת מייל</Text>
              <Text style={styles.verifyDesc}>
                שלחנו הודעת אימות לכתובת:{'\n'}
                <Text style={styles.emailHighlight}>{email.trim().toLowerCase()}</Text>
              </Text>

              <Text style={styles.label}>קוד אימות מהמייל:</Text>
              <TextInput
                style={[styles.input, styles.otpInput]}
                value={otpCode}
                onChangeText={setOtpCode}
                keyboardType="number-pad"
                maxLength={10}
                placeholder="הזן קוד אימות"
              />

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleVerifyOtp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>אמת קוד והיכנס</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleLogin}
                disabled={loading}
              >
                <Text style={styles.secondaryBtnText}>
                  לחצתי על הקישור במייל — המשך לכניסה
                </Text>
              </TouchableOpacity>

              <View style={styles.linksRow}>
                <TouchableOpacity onPress={handleResendEmail} disabled={loading}>
                  <Text style={styles.linkText}>שלח מייל שוב</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMode('login')} disabled={loading}>
                  <Text style={styles.linkText}>חזור למסך כניסה</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.modeTabs}>
                <TouchableOpacity
                  style={[styles.modeTab, mode === 'login' && styles.activeModeTab]}
                  onPress={() => setMode('login')}
                >
                  <Text
                    style={[
                      styles.modeTabText,
                      mode === 'login' && styles.activeModeTabText,
                    ]}
                  >
                    התחברות
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modeTab, mode === 'signup' && styles.activeModeTab]}
                  onPress={() => setMode('signup')}
                >
                  <Text
                    style={[
                      styles.modeTabText,
                      mode === 'signup' && styles.activeModeTabText,
                    ]}
                  >
                    הרשמה חדשה
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>כתובת אימייל</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="name@example.com"
              />

              <Text style={styles.label}>סיסמה</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="לפחות 6 תווים"
              />

              {mode === 'signup' && (
                <>
                  <Text style={styles.label}>אימות סיסמה</Text>
                  <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                    placeholder="הקלד סיסמה שוב"
                  />
                </>
              )}

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={mode === 'login' ? handleLogin : handleSignUp}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {mode === 'login' ? 'התחבר לארנק' : 'צור חשבון ושלח אימות'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1E293B',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  headerBox: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#38BDF8',
    marginBottom: 8,
  },
  subtitleText: {
    fontSize: 15,
    color: '#94A3B8',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 22,
    elevation: 5,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 10,
  },
  verifyDesc: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 18,
  },
  emailHighlight: {
    fontWeight: 'bold',
    color: '#0284C7',
  },
  modeTabs: {
    flexDirection: 'row-reverse',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 4,
    marginBottom: 18,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeModeTab: {
    backgroundColor: '#FFFFFF',
    elevation: 2,
  },
  modeTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  activeModeTabText: {
    color: '#0284C7',
    fontWeight: 'bold',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    textAlign: 'right',
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F8FAFC',
    marginBottom: 14,
    textAlign: 'right',
  },
  otpInput: {
    textAlign: 'center',
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 4,
  },
  primaryBtn: {
    backgroundColor: '#0284C7',
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryBtn: {
    backgroundColor: '#E0F2FE',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryBtnText: {
    color: '#0369A1',
    fontSize: 14,
    fontWeight: 'bold',
  },
  linksRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  linkText: {
    fontSize: 13,
    color: '#0284C7',
    fontWeight: '600',
  },
});