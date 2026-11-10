// src/services/ocrService.js
import { saveNewWalletItem } from './walletService';

/**
 * פענוח תמונת זיכוי פיזי/תו והזנה אוטומטית ל-Supabase
 */
export const processReceiptImageAndSave = async (imageUri, availableBrands) => {
  // 1. שליחת התמונה לשרת OCR (Google Vision / Claude Vision / Tesseract)
  const formData = new FormData();
  formData.append('file', { uri: imageUri, name: 'receipt.jpg', type: 'image/jpeg' });

  // סימולציית קריאת API למנגנון ה-OCR האמיתי
  const ocrResult = await fetch('YOUR_OCR_EDGE_FUNCTION_URL', {
    method: 'POST',
    body: formData,
  }).then(res => res.json());

  /* 
    התגובה החוזרת מה-OCR האמיתי:
    {
      brandName: 'קסטרו',
      amount: 185.00,
      barcode: '8849201',
      expiryDate: '2027-05-15',
      itemType: 'paper_credit_slip'
    }
  */

  // 2. שמירה ישירה ב-DB כדאטה אמת
  const newItem = await saveNewWalletItem(
    {
      title: `זיכוי ${ocrResult.brandName}`,
      item_type: ocrResult.itemType,
      balance: ocrResult.amount,
      original_amount: ocrResult.amount,
      barcode: ocrResult.barcode,
      expiryDate: ocrResult.expiryDate,
    },
    [ocrResult.brandName],
    availableBrands
  );

  return newItem;
};