import { supabase } from '../../supabase';

export const reportMissingClub = async ({ clubName, notes = '' }) => {
  if (!clubName || !clubName.trim()) {
    throw new Error('נא להזין את שם המועדון');
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  
  if (userError || !user) {
    throw new Error('יש להתחבר למערכת כדי לשלוח דיווח');
  }

  const { error } = await supabase
    .from('missing_clubs')
    .insert([
      {
        user_id: user.id,
        user_email: user.email,
        club_name: clubName.trim(),
        notes: notes.trim() || null,
      },
    ]);

  if (error) {
    console.error('Error reporting missing club:', error);
    throw new Error('אירעה שגיאה בשליחת הדיווח, נסה שוב מאוחר יותר');
  }

  return { success: true };
};