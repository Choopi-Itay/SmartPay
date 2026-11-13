import { supabase } from '../../supabase';

export async function findBestClubBenefits(merchantQuery) {
  const cleanQuery = (merchantQuery || '').trim();
  if (!cleanQuery) return [];

  const { data, error } = await supabase
    .from('club_benefits')
    .select(
      'id, external_id, benefit_type, title, discount_percent, wallet_name, monthly_limit, redim_type, logo_url, short_description'
    )
    .eq('is_active', true)
    .or(`title.ilike.%${cleanQuery}%,supplier_name.ilike.%${cleanQuery}%,search_keywords.ilike.%${cleanQuery}%`)
    .order('discount_percent', { ascending: false, nullsFirst: false })
    .limit(15);

  if (error) {
    console.log('Error fetching club benefits:', error);
    return [];
  }

  return data || [];
}