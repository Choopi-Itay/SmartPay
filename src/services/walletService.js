import { supabase } from '../../supabase';

const mapWalletRow = (item) => {
  const brands = item.item_brands
    ? item.item_brands.map((ib) => ib.brand_id).filter(Boolean)
    : [];

  const currentBal = parseFloat(item.current_balance ?? 0);

  return {
    id: item.id,
    userId: item.user_id,
    name: item.title || '',
    type: item.item_type,
    originalAmount: parseFloat(item.original_amount ?? 0),
    balance: item.item_type === 'CreditCard' ? Infinity : currentBal,
    discount: 0,
    expiryDate: item.expiry_date,
    code: item.barcode_data || '',
    receiptImageUrl: item.receipt_image_url || null,
    isLocked: item.is_locked || false,
    applicableBrands: brands,
  };
};

export const fetchBrands = async () => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('brands')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
};

export const fetchWalletItems = async () => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('wallet_items')
    .select(`
      id,
      user_id,
      title,
      item_type,
      original_amount,
      current_balance,
      expiry_date,
      barcode_data,
      receipt_image_url,
      is_locked,
      is_active,
      item_brands (
        brand_id
      )
    `)
    .neq('is_active', false)
    .order('expiry_date', { ascending: true, nullsFirst: false });

  if (error) throw error;

  return (data || []).map(mapWalletRow);
};

export const updateItemLockStatus = async (id, isLocked) => {
  if (!supabase) return;
  const { error } = await supabase
    .from('wallet_items')
    .update({ is_locked: isLocked, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) console.error('Error updating lock status:', error.message);
};

export const updateItemBalance = async (id, amountToDeduct, brandName = null, notes = 'מימוש בקופה') => {
  if (!supabase) return;

  const { data, error } = await supabase.rpc('deduct_wallet_item_balance', {
    p_item_id: id,
    p_amount: amountToDeduct,
    p_brand_name: brandName,
    p_notes: notes,
  });

  if (error) throw error;
  return data;
};

export const deleteWalletItemFromDb = async (id) => {
  if (!supabase) return;
  const { error } = await supabase
    .from('wallet_items')
    .delete()
    .eq('id', id);

  if (error) console.error('Error deleting item:', error.message);
};

/**
 * וידוא שכל המותגים שנבחרו (כולל חדשים שזוהו בסריקה כמו "דלתא") קיימים בטבלת brands ומחזירים UUID תקין
 */
export const ensureBrandsExist = async (selectedBrands = [], availableBrands = []) => {
  if (!supabase || !selectedBrands || selectedBrands.length === 0) return [];

  const resolved = [];

  for (const rawName of selectedBrands) {
    const cleanName = (rawName || '').trim();
    if (!cleanName) continue;

    const existing = availableBrands.find(
      (b) => (b.name || '').trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (existing && existing.id && existing.id !== existing.name) {
      resolved.push(existing);
      continue;
    }

    // בדיקה אם קיים ב-DB אך טרם נטען מקומית
    const { data: dbExisting } = await supabase
      .from('brands')
      .select('id, name')
      .ilike('name', cleanName)
      .limit(1)
      .maybeSingle();

    if (dbExisting) {
      resolved.push(dbExisting);
      continue;
    }

    // הוספת המותג החדש לטבלת brands
    const { data: inserted, error: insertErr } = await supabase
      .from('brands')
      .insert([{ name: cleanName }])
      .select('id, name')
      .single();

    if (!insertErr && inserted) {
      resolved.push(inserted);
    }
  }

  return resolved;
};

export const saveNewWalletItem = async (payload, selectedBrands = [], availableBrands = []) => {
  if (!supabase) return;

  const { data: userData } = await supabase.auth.getUser();
  const authUserId = userData?.user?.id || null;

  const itemType = payload.item_type || payload.type || 'Voucher';
  const isCreditCard = itemType === 'CreditCard';
  const initialAmount = isCreditCard ? 0 : Number(payload.original_amount ?? payload.balance ?? 0);
  const currentBalance = isCreditCard ? 0 : Number(payload.balance ?? payload.current_balance ?? 0);

  const dbPayload = {
    ...(authUserId ? { user_id: authUserId } : {}),
    title: payload.name || payload.title || 'פריט ללא שם',
    item_type: itemType,
    original_amount: initialAmount,
    current_balance: currentBalance,
    barcode_data: payload.barcode || payload.barcode_data || null,
    expiry_date: payload.expiry_date || payload.expiryDate || null,
    receipt_image_url: payload.receipt_image_url || payload.receiptImageUrl || null,
    is_locked: payload.is_locked || false,
    is_active: true,
  };

  let { data: itemData, error: itemError } = await supabase
    .from('wallet_items')
    .insert([dbPayload])
    .select('id')
    .single();

  if (itemError && itemError.code === '23502' && !authUserId) {
    const retryRes = await supabase
      .from('wallet_items')
      .insert([{ ...dbPayload, user_id: '00000000-0000-0000-0000-000000000000' }])
      .select('id')
      .single();
    itemData = retryRes.data;
    itemError = retryRes.error;
  }

  if (itemError) throw itemError;

  if (selectedBrands.length > 0 && itemData) {
    const resolvedBrands = await ensureBrandsExist(selectedBrands, availableBrands);
    const junctionRows = resolvedBrands.map((b) => ({
      item_id: itemData.id,
      brand_id: b.id,
    }));

    if (junctionRows.length > 0) {
      const { error: junctionError } = await supabase
        .from('item_brands')
        .insert(junctionRows);

      if (junctionError) console.error('Junction insert error:', junctionError.message);
    }
  }

  return itemData;
};