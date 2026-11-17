import { supabase } from '../../supabase';

// שיתוף ארנק מלא
export async function fetchWalletShares() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { sharedByMe: [], sharedWithMe: [] };

  const { data, error } = await supabase
    .from('wallet_shares')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.log('Error fetching wallet shares:', error.message);
    return { sharedByMe: [], sharedWithMe: [] };
  }

  const myEmail = (user.email || '').toLowerCase();
  const sharedByMe = (data || []).filter((row) => row.owner_id === user.id);
  const sharedWithMe = (data || []).filter(
    (row) => row.owner_id !== user.id && (row.shared_with_email || '').toLowerCase() === myEmail
  );

  return { sharedByMe, sharedWithMe };
}

export async function shareWalletWithEmail(targetEmail) {
  const cleanEmail = (targetEmail || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('נא להזין כתובת אימייל תקינה');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('המשתמש אינו מחובר');

  if ((user.email || '').toLowerCase() === cleanEmail) {
    throw new Error('לא ניתן לשתף את הארנק עם עצמך');
  }

  const { error } = await supabase.from('wallet_shares').insert({
    owner_id: user.id,
    owner_email: (user.email || '').toLowerCase(),
    shared_with_email: cleanEmail,
  });

  if (error) {
    if (error.code === '23505') {
      throw new Error('הארנק כבר משותף עם כתובת מייל זו');
    }
    throw error;
  }
}

export async function removeWalletShare(shareId) {
  const { error } = await supabase
    .from('wallet_shares')
    .delete()
    .eq('id', shareId);

  if (error) throw error;
}

// שיתוף שובר פרטני
export async function shareSingleItemWithEmail(itemId, targetEmail) {
  const cleanEmail = (targetEmail || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('נא להזין כתובת אימייל תקינה');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('המשתמש אינו מחובר');

  if ((user.email || '').toLowerCase() === cleanEmail) {
    throw new Error('לא ניתן לשתף פריט עם עצמך');
  }

  const { error } = await supabase.from('voucher_shares').insert({
    item_id: itemId,
    owner_id: user.id,
    shared_with_email: cleanEmail,
  });

  if (error) {
    if (error.code === '23505') {
      throw new Error('השובר כבר משותף עם כתובת מייל זו');
    }
    throw error;
  }
}

export async function fetchItemShares(itemId) {
  const { data, error } = await supabase
    .from('voucher_shares')
    .select('*')
    .eq('item_id', itemId);

  if (error) return [];
  return data || [];
}

export async function removeSingleItemShare(shareId) {
  const { error } = await supabase
    .from('voucher_shares')
    .delete()
    .eq('id', shareId);

  if (error) throw error;
}