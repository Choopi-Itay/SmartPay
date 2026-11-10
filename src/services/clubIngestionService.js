import { supabase } from '../../supabase';

/**
 * מנוע סנכרון ועדכון מועדונים וחוקי הנחות (Ingestion API)
 */
export const syncClubRules = async (payload) => {
  if (!supabase || !payload?.clubs) {
    throw new Error('Invalid payload or Supabase client missing');
  }

  const results = { processedClubs: 0, processedRules: 0, errors: [] };

  for (const clubData of payload.clubs) {
    try {
      // 1. הכנסה/עדכון של המועדון
      const { data: club, error: clubError } = await supabase
        .from('global_clubs')
        .upsert(
          {
            club_key: clubData.club_key,
            display_name: clubData.display_name,
            club_type: clubData.club_type,
            is_test: false,
          },
          { onConflict: 'club_key' }
        )
        .select('id')
        .single();

      if (clubError) throw clubError;
      results.processedClubs++;

      // 2. הכנסה/עדכון של חוקי ההנחות
      if (clubData.rules && clubData.rules.length > 0) {
        const rulesRows = clubData.rules.map(rule => ({
          club_id: club.id,
          brand_name: rule.brand_name,
          discount_percentage: rule.discount_percentage,
          priority_order: rule.priority_order || 1,
          stacks_with_sales: rule.stacks_with_sales ?? true,
          special_notes: rule.special_notes || '',
          is_test: false,
        }));

        const { error: rulesError } = await supabase
          .from('club_brand_rules')
          .upsert(rulesRows, { onConflict: 'club_id,brand_name' });

        if (rulesError) throw rulesError;
        results.processedRules += rulesRows.length;
      }
    } catch (err) {
      console.error(`Error syncing club ${clubData.club_key}:`, err.message);
      results.errors.push({ club_key: clubData.club_key, message: err.message });
    }
  }

  return results;
};

export const runInitialClubIngestion = async () => {
  const realDataPayload = {
    clubs: [
      {
        club_key: 'hitechzone',
        display_name: 'הייטקזון',
        club_type: 'consumer_group',
        rules: [
          { brand_name: 'קסטרו', discount_percentage: 15.00, priority_order: 1, stacks_with_sales: true, special_notes: 'טעינת תו הייטקזון' },
          { brand_name: 'סופר-פארם', discount_percentage: 7.00, priority_order: 1, stacks_with_sales: true, special_notes: 'תו סופר-פארם' }
        ]
      },
      {
        club_key: 'chever',
        display_name: 'חבר',
        club_type: 'consumer_group',
        rules: [
          { brand_name: 'קסטרו', discount_percentage: 20.00, priority_order: 1, stacks_with_sales: true, special_notes: 'תו קנייה חבר' },
          { brand_name: 'שופרסל', discount_percentage: 8.50, priority_order: 1, stacks_with_sales: false, special_notes: 'תו זהב שופרסל' }
        ]
      }
    ]
  };

  return await syncClubRules(realDataPayload);
};