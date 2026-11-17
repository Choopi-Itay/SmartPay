import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { updateItemBalance } from '../services/walletService';

export default function DeductCreditModal({ visible, item, onClose, onSuccess }) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setAmount('');
      setNotes('');
    }
  }, [visible, item]);

  if (!item) return null;

  const currentBalance = Number(item.balance || 0);

  const handleConfirm = async () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('שגיאה', 'נא להזין סכום תקין לקיזוז');
      return;
    }
    if (numAmount > currentBalance) {
      Alert.alert('שגיאה', `הסכום שהוזן גדול מהיתרה הקיימת (₪${currentBalance.toFixed(2)})`);
      return;
    }

    try {
      setLoading(true);
      await updateItemBalance(
        item.id,
        numAmount,
        null,
        notes.trim() || 'קיזוז יתרה ידני'
      );

      const remaining = Math.max(0, currentBalance - numAmount);
      onClose();
      if (onSuccess) await onSuccess();

      Alert.alert(
        'היתרה עודכנה ✅',
        remaining > 0
          ? `קוזזו ₪${numAmount.toFixed(2)}. יתרה נותרת: ₪${remaining.toFixed(2)}`
          : `נוצלה מלוא היתרה (₪${numAmount.toFixed(2)}) והפריט סומן כממומש.`
      );
    } catch (err) {
      Alert.alert('שגיאה בעדכון היתרה', err?.message || 'אירעה שגיאה לא צפויה');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>✂️ קיזוז יתרה חלקית</Text>
          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.balanceInfo}>
            יתרה נוכחית: ₪{currentBalance.toFixed(2)}
          </Text>

          <View style={styles.labelRow}>
            <Text style={styles.label}>סכום לקיזוז (₪)</Text>
            <TouchableOpacity
              style={styles.fullBtn}
              onPress={() => setAmount(String(currentBalance))}
            >
              <Text style={styles.fullBtnText}>קזז הכל</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            placeholder="0.00"
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
          />

          <Text style={styles.label}>הערה (אופציונלי)</Text>
          <TextInput
            style={styles.input}
            placeholder="למשל: קנייה בסניף / השלמה"
            value={notes}
            onChangeText={setNotes}
          />

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn]}
              onPress={onClose}
              disabled={loading}
            >
              <Text style={styles.cancelText}>ביטול</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.confirmBtn]}
              onPress={handleConfirm}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.confirmText}>אשר קיזוז</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#FFF',
    width: '100%',
    borderRadius: 16,
    padding: 20,
    elevation: 5,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'center',
  },
  balanceInfo: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0284C7',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  fullBtn: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  fullBtnText: {
    color: '#0284C7',
    fontSize: 12,
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    backgroundColor: '#F8FAFC',
    marginBottom: 14,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    padding: 13,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: '#F1F5F9',
  },
  cancelText: {
    color: '#475569',
    fontWeight: 'bold',
  },
  confirmBtn: {
    backgroundColor: '#16A34A',
  },
  confirmText: {
    color: '#FFF',
    fontWeight: 'bold',
  },
});