import { 
  saveNewWalletItem, 
  fetchWalletItems, 
  fetchCheckoutItemsForBrand, 
  updateItemBalance, 
  deleteWalletItemFromDb 
} from './walletService';

export const runWalletServiceTests = async () => {
  console.log('🧪 מתחיל סדרת בדיקות ל-walletService...\n');
  let createdItemId = null;

  try {
    // 1. בדיקת שמירת פריט ארנק חדש (זיכוי תרמי קסטרו)
    console.log('1️⃣ בדיקת saveNewWalletItem:');
    const mockPayload = {
      name: 'זיכוי תרמי קסטרו (בדיקת קוד)',
      type: 'paper_credit_slip',
      original_amount: 300,
      balance: 300,
      barcode: 'CASTRO-TEST-999',
      expiryDate: '2027-12-31',
    };

    const savedItem = await saveNewWalletItem(
      mockPayload, 
      ['קסטרו'], 
      [{ id: 'castro-id', name: 'קסטרו' }]
    );

    createdItemId = savedItem?.id;
    console.log(`✅ פריט נוצר בהצלחה. ID: ${createdItemId}`);

    // 2. בדיקת שליפת כלל פריטי הארנק והתאמת המפוי ל-UI
    console.log('\n2️⃣ בדיקת fetchWalletItems:');
    const items = await fetchWalletItems();
    const testItem = items.find(i => i.id === createdItemId);

    if (!testItem) throw new Error('הפריט שנוצר לא נשלף ברשימת הארנק');
    console.log('✅ מיפוי שדות תקין:', {
      name: testItem.name,
      balance: testItem.balance,
      code: testItem.code,
      brands: testItem.applicableBrands
    });

    // 3. בדיקת שליפת פריטים וחוקים ייעודיים לקופה ('קסטרו')
    console.log('\n3️⃣ בדיקת fetchCheckoutItemsForBrand ("קסטרו"):');
    const { items: checkoutItems, clubRules } = await fetchCheckoutItemsForBrand('קסטרו');
    console.log(`✅ נשלפו ${checkoutItems.length} פריטים מתאימים לקופה ו-${clubRules.length} חוקי מועדונים.`);

    // 4. בדיקת עדכון יתרה (ניצול 100 ש"ח בקופה)
    console.log('\n4️⃣ בדיקת updateItemBalance (מימוש 100 ש"ח):');
    await updateItemBalance(createdItemId, 100);
    
    const itemsAfterDeduct = await fetchWalletItems();
    const updatedItem = itemsAfterDeduct.find(i => i.id === createdItemId);
    
    if (updatedItem.balance !== 200) {
      throw new Error(`יתרה לא תקינה לאחר עדכון. צפוי: 200, התקבל: ${updatedItem.balance}`);
    }
    console.log(`✅ יתרה עודכנה בהצלחה ל-${updatedItem.balance} ש"ח.`);

    // 5. ניקוי נתוני הבדיקה
    console.log('\n5️⃣ בדיקת deleteWalletItemFromDb (ניקוי):');
    await deleteWalletItemFromDb(createdItemId);
    
    const finalItems = await fetchWalletItems();
    const isDeleted = !finalItems.some(i => i.id === createdItemId);
    
    if (!isDeleted) throw new Error('המחיקה נכשלה, הפריט עדיין קיים ב-DB');
    console.log('✅ הפריט נמחק בהצלחה מהענן.');

    console.log('\n🎉 כל 5 הבדיקות עברו בהצלחה 100%!');
  } catch (error) {
    console.error('\n❌ הבדיקה נכשלה:', error.message);
    
    // ניקוי חירום במקרה של שגיאה באמצע הבדיקה
    if (createdItemId) {
      await deleteWalletItemFromDb(createdItemId).catch(() => {});
    }
  }
};