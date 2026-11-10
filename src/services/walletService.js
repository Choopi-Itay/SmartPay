import { supabase } from '../../supabase';

/**
 * שליפת מותגים עבור Dropdown / שיוך מותגים בארנק
 */
export const fetchBrands = async () => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('brands')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
};

/**
 * שליפת כל הפריטים בארנק עם התאמה מלאה לסכמה הנקייה ול-UI
 */
export const fetchWalletItems = async () => {
  if (!supabase) return [];
  
  const { data, error } = await supabase
    .from('wallet_items')
    .select(`
      id,
      title,
      item_type,
      original_amount,
      current_balance,
      expiry_date,
      barcode_data,
      is_locked,
      is_active,
      club_id,
      item_brands (
        brand_id
      )
    `)
    .eq('is_active', true)
    .order('expiry_date', { ascending: true, nullsFirst: false });

  if (error) throw error;

  return (data || []).map(item => {
    // חילוץ שמות/מזהי המותגים התואמים לפריט מתוך item_brands
    const brands = item.item_brands 
      ? item.item_brands.map(ib => ib.brand_id).filter(Boolean)
      : [];

    const currentBal = parseFloat(item.current_balance ?? 0);

    return {
      id: item.id,
      name: item.title || '',
      type: item.item_type,
      originalAmount: parseFloat(item.original_amount ?? 0),
      balance: item.item_type === 'CreditCard' ? Infinity : currentBal,
      expiryDate: item.expiry_date,
      code: item.barcode_data || '',
      isLocked: item.is_locked || false,
      clubId: item.club_id || null,
      applicableBrands: brands,
    };
  });
};

/**
 * שליפת פריטי ארנק וחוקי מועדון ייעודיים לרשת ספציפית בקופה (למשל 'קסטרו')
 */
export const fetchCheckoutItemsForBrand = async (brandName) => {
  if (!supabase) return { items: [], clubRules: [] };

  // 1. שליפת שוברים/זיכויים שמתאימים לרשת ומסודרים לפי FIFO
  const { data: items, error: itemsError } = await supabase
    .from('wallet_items')
    .select(`
      id,
      title,
      item_type,
      current_balance,
      original_amount,
      barcode_data,
      expiry_date,
      is_locked,
      item_brands!inner ( brand_id )
    `)
    .eq('is_active', true)
    .eq('is_locked', false)
    .gt('current_balance', 0)
    .order('expiry_date', { ascending: true });

  if (itemsError) throw itemsError;

  // 2. שליפת מועדוני צרכנות והטבות אשראי מתאימות לרשת
  const { data: clubRules, error: rulesError } = await supabase
    .from('club_brand_rules')
    .select(`
      discount_percentage,
      stacks_with_sales,
      priority_order,
      special_notes,
      global_clubs ( display_name, club_type )
    `)
    .eq('brand_name', brandName)
    .order('priority_order', { ascending: true });

  if (rulesError) throw rulesError;

  return { items, clubRules };
};

/**
 * נעילת פריט (כדי שלא ייפתח מחדש בטעות בקופה)
 */
export const updateItemLockStatus = async (id, isLocked) => {
  if (!supabase) return;
  const { error } = await supabase
    .from('wallet_items')
    .update({ is_locked: isLocked, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) console.error('Error updating lock status:', error.message);
};

/**
 * עדכון יתרה בענן דרך פונקציית ה-RPC המאובטחת או Fallback ישיר
 */
export const updateItemBalance = async (id, amountToDeduct) => {
  if (!supabase) return;
  
  // ניסיון הרצה ראשון דרך פרוצדורת RPC מאובטחת
  const { data, error } = await supabase.rpc('deduct_voucher_balance', {
    p_item_id: id,
    p_amount_to_deduct: amountToDeduct,
  });

  if (error) {
    console.warn('RPC deduct failed, performing fallback update:', error.message);

    // Fallback: שליפת היתרה הנוכחית ועדכון ישיר בסכמה הנקייה
    const { data: currentItem, error: fetchErr } = await supabase
      .from('wallet_items')
      .select('current_balance')
      .eq('id', id)
      .single();

    if (fetchErr) throw fetchErr;

    const newBalance = Math.max(0, (currentItem.current_balance || 0) - amountToDeduct);
    const { data: updated, error: updateErr } = await supabase
      .from('wallet_items')
      .update({
        current_balance: newBalance,
        is_active: newBalance > 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select();

    if (updateErr) throw updateErr;
    return updated;
  }

  return data;
};

/**
 * מחיקת פריט מהארנק (Soft Delete או Hard Delete)
 */
export const deleteWalletItemFromDb = async (id) => {
  if (!supabase) return;
  const { error } = await supabase
    .from('wallet_items')
    .delete()
    .eq('id', id);

  if (error) console.error('Error deleting item:', error.message);
};

/**
 * שמירת פריט ארנק חדש (זיכוי תרמי/שובר דיגיטלי/כרטיס מועדון) ושיוך מותגים
 */
export const saveNewWalletItem = async (payload, selectedBrands = [], availableBrands = []) => {
  if (!supabase) return;

  // 1. חילוץ מזהה המשתמש המחובר (אם קיים בסשן)
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id || '00000000-0000-0000-0000-000000000000';

  // 2. התאמת השדות מנתוני ה-Form לסכמה הנקייה של Supabase
  const dbPayload = {
    user_id: userId,
    title: payload.name || payload.title || 'שובר ללא שם',
    item_type: payload.item_type || payload.type || 'digital_voucher',
    original_amount: payload.original_amount || payload.balance || 0,
    current_balance: payload.balance ?? payload.current_balance ?? 0,
    barcode_data: payload.barcode || payload.barcode_data || '',
    expiry_date: payload.expiry_date || payload.expiryDate || null,
    club_id: payload.club_id || null,
    is_locked: payload.is_locked || false,
    is_active: true,
  };

  const { data: itemData, error: itemError } = await supabase
    .from('wallet_items')
    .insert([dbPayload])
    .select('id')
    .single();

  if (itemError) throw itemError;

  // 3. הוספת שורות לקשר המותגים (item_brands)
  if (selectedBrands.length > 0 && itemData) {
    const selectedBrandObjects = availableBrands.filter(b => selectedBrands.includes(b.name));
    
    // אם לא נמצא מותג קיים בטבלה, שומרים לפי שם המותג/ID
    const junctionRows = selectedBrandObjects.length > 0
      ? selectedBrandObjects.map(b => ({ item_id: itemData.id, brand_id: b.id }))
      : selectedBrands.map(brandName => ({ item_id: itemData.id, brand_id: brandName }));

    if (junctionRows.length > 0) {
      const { error: junctionError } = await supabase
        .from('item_brands')
        .insert(junctionRows);
        
      if (junctionError) console.error('Junction insert error:', junctionError.message);
    }
  }

  return itemData;
};