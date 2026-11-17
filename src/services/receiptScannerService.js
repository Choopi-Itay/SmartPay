import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../supabase';

const GEMINI_API_KEY = (process.env.EXPO_PUBLIC_GEMINI_API_KEY || '').trim();
let cachedWorkingConfig = null;

function base64ToUint8Array(base64) {
  const cleanBase64 = base64
    .replace(/^data:image\/\w+;base64,/, '')
    .replace(/\s/g, '');
  const binaryString = atob(cleanBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function optimizeImageAsset(asset) {
  if (!asset?.uri) return asset;
  try {
    const ImageManipulator = await import('expo-image-manipulator');
    if (ImageManipulator?.manipulateAsync) {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1024 } }],
        {
          compress: 0.55,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        }
      );
      if (manipulated?.base64) {
        return {
          ...asset,
          uri: manipulated.uri,
          base64: manipulated.base64,
          mimeType: 'image/jpeg',
        };
      }
    }
  } catch (e) {
    // ממשיך עם התמונה המקורית אם המודול לא מותקן
  }
  return asset;
}

export async function pickReceiptImage(source = 'camera') {
  if (source === 'camera') {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('נדרשת הרשאת מצלמה כדי לצלם את הזיכוי');
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.4,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return null;
    return optimizeImageAsset(result.assets[0]);
  } else {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('נדרשת הרשאה לגלריה כדי לבחור תמונה');
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.4,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return null;
    return optimizeImageAsset(result.assets[0]);
  }
}

export async function uploadReceiptBackup(base64Data, mimeType = 'image/jpeg') {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id || 'anonymous';

  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const filePath = `${userId}/${Date.now()}.${ext}`;
  const fileBytes = base64ToUint8Array(base64Data);

  const { error: uploadError } = await supabase.storage
    .from('receipts')
    .upload(filePath, fileBytes, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage
    .from('receipts')
    .getPublicUrl(filePath);

  return publicUrlData.publicUrl;
}

export function resolveScannedBrand(rawBrand, rawTitle, availableBrands = []) {
  const candidates = [rawBrand, rawTitle]
    .filter(Boolean)
    .map((s) => String(s).trim());

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();

    const exact = availableBrands.find(
      (b) => (b.name || '').trim().toLowerCase() === lower
    );
    if (exact) return exact.name;

    const sortedBrands = [...availableBrands].sort(
      (a, b) => (a.name || '').length - (b.name || '').length
    );
    const partial = sortedBrands.find((b) => {
      const bn = (b.name || '').trim().toLowerCase();
      if (bn.length < 2) return false;
      return lower.includes(bn) || bn.includes(lower);
    });
    if (partial) return partial.name;
  }

  if (rawBrand && String(rawBrand).trim().length >= 2) {
    return String(rawBrand).trim();
  }

  if (rawTitle) {
    const stripped = String(rawTitle)
      .replace(/^(זיכוי|שובר|גיפט\s*קארד|כרטיס\s*מתנה|תו\s*קנייה)\s+/i, '')
      .trim();
    if (stripped.length >= 2 && stripped.length <= 25) {
      return stripped;
    }
  }

  return null;
}

/**
 * נירמול תאריך מכל פורמט (YYYY-MM-DD או DD/MM/YYYY) והוספת שנתיים קדימה
 */
function normalizeAndAddTwoYears(rawDateStr) {
  if (!rawDateStr || typeof rawDateStr !== 'string') return null;
  const clean = rawDateStr.trim();

  let year, month, day;

  const isoMatch = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  const ilMatch = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);

  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    month = isoMatch[2].padStart(2, '0');
    day = isoMatch[3].padStart(2, '0');
  } else if (ilMatch) {
    day = ilMatch[1].padStart(2, '0');
    month = ilMatch[2].padStart(2, '0');
    const rawY = parseInt(ilMatch[3], 10);
    year = rawY < 100 ? 2000 + rawY : rawY;
  } else {
    return null;
  }

  return `${year + 2}-${month}-${day}`;
}

function parseModelJsonResponse(rawText, availableBrands = []) {
  const cleaned = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`המודל לא החזיר מבנה JSON תקין: ${cleaned.slice(0, 80)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);

  const numericAmount =
    typeof parsed.amount === 'number'
      ? parsed.amount
      : parseFloat(String(parsed.amount || '0').replace(/[^\d.]/g, '')) || 0;

  const resolvedBrand = resolveScannedBrand(
    parsed.matchedBrand,
    parsed.title,
    availableBrands
  );

  // לוקח את תאריך הקבלה/הוצאת הזיכוי ומוסיף לו שנתיים אוטומטית
  const rawDate = parsed.receiptDate || parsed.issueDate || parsed.expiryDate || null;
  const calculatedExpiry = normalizeAndAddTwoYears(rawDate);

  return {
    title: parsed.title || (resolvedBrand ? `זיכוי ${resolvedBrand}` : null),
    matchedBrand: resolvedBrand,
    itemType: ['StoreCredit', 'Voucher', 'GiftCard'].includes(parsed.itemType)
      ? parsed.itemType
      : 'StoreCredit',
    amount: numericAmount,
    expiryDate: calculatedExpiry,
    barcode: parsed.barcode ? String(parsed.barcode).replace(/\s+/g, '') : null,
  };
}

async function fetchWithTimeout(url, options, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function discoverActiveFlashCandidates() {
  const fallback = [
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
      thinkingConfig: { thinkingBudget: 0 },
    },
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      thinkingConfig: { thinkingBudget: 0 },
    },
  ];

  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`,
      { method: 'GET' },
      8000
    );
    if (!res.ok) return fallback;

    const data = JSON.parse(await res.text());
    const models = Array.isArray(data?.models) ? data.models : [];

    const flashModels = models.filter((m) => {
      const name = (m.name || '').toLowerCase();
      const methods = m.supportedGenerationMethods || [];
      return (
        methods.includes('generateContent') &&
        name.includes('flash') &&
        !name.includes('audio') &&
        !name.includes('tts') &&
        !name.includes('image') &&
        !name.includes('2.0')
      );
    });

    if (flashModels.length === 0) return fallback;

    const scoreModel = (name) => {
      const n = name.toLowerCase();
      let score = 0;
      if (n.includes('gemini-3-flash')) score += 45;
      else if (n.includes('flash-latest')) score += 40;
      else if (n.includes('gemini-2.5-flash') && !n.includes('lite')) score += 35;
      else if (n.includes('gemini-2.5')) score += 20;
      return score;
    };

    flashModels.sort((a, b) => scoreModel(b.name) - scoreModel(a.name));

    const discovered = flashModels.slice(0, 2).map((m) => {
      const cleanName = m.name.startsWith('models/') ? m.name : `models/${m.name}`;
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/${cleanName}:generateContent?key=${GEMINI_API_KEY}`,
        thinkingConfig: { thinkingBudget: 0 },
      };
    });

    return [...discovered, ...fallback];
  } catch (e) {
    return fallback;
  }
}

export async function extractReceiptDetails(
  base64Data,
  mimeType = 'image/jpeg',
  availableBrands = []
) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'מפתח EXPO_PUBLIC_GEMINI_API_KEY לא נטען. ודא שהוא שמור ב-.env והפעל מחדש עם npx expo start -c'
    );
  }

  const cleanBase64 = base64Data
    .replace(/^data:image\/\w+;base64,/, '')
    .replace(/\s/g, '');

  const prompt = `חלץ מפתק הזיכוי/שובר שבתמונה JSON תקני בלבד (שמות רשתות בעברית):
{"title":"שם קצר לפריט בעברית","matchedBrand":"שם הרשת בעברית או null","itemType":"StoreCredit או Voucher או GiftCard","amount":0,"receiptDate":"תאריך הקבלה/זיכוי בפורמט YYYY-MM-DD או null","barcode":"קוד/ברקוד ללא רווחים או null"}`;

  const candidates = cachedWorkingConfig
    ? [cachedWorkingConfig]
    : await discoverActiveFlashCandidates();

  const errors = [];

  for (const candidate of candidates) {
    try {
      const requestBody = JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: cleanBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 4096,
          thinkingConfig: candidate.thinkingConfig,
        },
      });

      const response = await fetchWithTimeout(
        candidate.url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
        },
        25000
      );

      const responseText = await response.text();

      if (!response.ok) {
        errors.push(`HTTP ${response.status}: ${responseText.slice(0, 120)}`);
        if (cachedWorkingConfig?.url === candidate.url) {
          cachedWorkingConfig = null;
        }
        continue;
      }

      let json;
      try {
        json = JSON.parse(responseText);
      } catch (e) {
        errors.push(`תשובת שרת לא תקינה: ${responseText.slice(0, 80)}`);
        continue;
      }

      const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        errors.push('התקבלה תשובה ריקה מהמודל');
        continue;
      }

      const result = parseModelJsonResponse(rawText, availableBrands);
      cachedWorkingConfig = candidate;
      return result;
    } catch (err) {
      errors.push(
        err?.name === 'AbortError'
          ? 'חריגה מזמן ההמתנה (25 שניות)'
          : err?.message || String(err)
      );
    }
  }

  throw new Error(errors.join(' | ') || 'Unknown AI error');
}

export async function scanAndBackupReceipt(
  source = 'camera',
  availableBrands = []
) {
  const asset = await pickReceiptImage(source);
  if (!asset || !asset.base64) return null;

  const mimeType = asset.mimeType || 'image/jpeg';
  let aiError = null;

  const [imageUrl, parsedDetails] = await Promise.all([
    uploadReceiptBackup(asset.base64, mimeType),
    extractReceiptDetails(asset.base64, mimeType, availableBrands).catch((e) => {
      console.warn('AI parse failed, keeping image backup:', e.message);
      aiError = e.message;
      return null;
    }),
  ]);

  return {
    imageUrl,
    details: parsedDetails,
    aiError,
  };
}