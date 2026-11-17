import { supabase } from '../lib/supabase'; // התאם לנתיב אצלך

export const walletCreditsService = {
  /**
   * שליפת כל הזיכויים והשוברים הפעילים (כולל יתרות חלקיות), ממוינים לפי תוקף קרוב
   */
  async getActiveCreditsAndVouchers() {
    const { data, error } = await supabase
      .from('wallet_items')
      .select(`
        *,
        item_brand_eligibility (
          id,
          brand_name,
          max_usage_pct
        )
      `)
      .eq('is_active', true)
      .gt('current_balance', 0)
      .order('expiry_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  /**
   * הוספת זיכוי חדש (כולל שיוך אופציונלי למותגים ב-item_brand_eligibility)
   */
  async addStoreCredit({
    title,
    amount,
    barcodeData,
    expiryDate = null,
    eligibleBrands = [],
    itemType = 'store_credit',
  }) {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      throw new Error('User not authenticated');
    }

    const { data: createdItem, error: insertError } = await supabase
      .from('wallet_items')
      .insert({
        user_id: authData.user.id,
        item_type: itemType,
        title: title.trim(),
        original_amount: amount,
        current_balance: amount,
        barcode_data: barcodeData?.trim() || null,
        expiry_date: expiryDate || null,
        is_active: true,
        is_locked: false,
        status: 'active',
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // אם הוגדרו רשתות ספציפיות לזיכוי, נשמור אותן בטבלת הזכאות הקיימת
    if (eligibleBrands.length > 0) {
      const eligibilityRows = eligibleBrands.map((b) => ({
        wallet_item_id: createdItem.id,
        brand_name: b.brandName.trim(),
        max_usage_pct: b.maxUsagePct ?? null,
      }));

      const { error: brandError } = await supabase
        .from('item_brand_eligibility')
        .insert(eligibilityRows);

      if (brandError) throw brandError;
    }

    return createdItem;
  },

  /**
   * קיזוז יתרה אטומי דרך פונקציית ה-RPC שהקמנו ב-Supabase
   */
  async deductBalance(itemId, amountToDeduct, brandName = null, notes = null) {
    const { data, error } = await supabase.rpc('deduct_wallet_item_balance', {
      p_item_id: itemId,
      p_amount: amountToDeduct,
      p_brand_name: brandName,
      p_notes: notes,
    });

    if (error) throw error;
    return data;
  },

  /**
   * שליפת היסטוריית הקיזוזים של זיכוי/שובר ספציפי
   */
  async getItemTransactions(itemId) {
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('wallet_item_id', itemId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  },
};