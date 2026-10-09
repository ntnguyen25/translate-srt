
import { GoogleGenAI, Type } from "@google/genai";
import { SubtitleBlock, CharacterAnalysis, SubtitleItem } from "../types";

// Helper for exponential backoff
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const getStoredApiKey = (): string => {
  try {
    return localStorage.getItem('gemini_api_key') || '';
  } catch {
    return '';
  }
};

export const setStoredApiKey = (key: string): void => {
  try {
    if (key && key.trim()) {
      localStorage.setItem('gemini_api_key', key.trim());
    } else {
      localStorage.removeItem('gemini_api_key');
    }
  } catch (e) {
    console.error('Failed to save API key:', e);
  }
};

export const getEffectiveApiKey = (customKey?: string): string => {
  if (customKey && customKey.trim()) return customKey.trim();
  const stored = getStoredApiKey();
  if (stored) return stored;

  const envKey = (typeof process !== 'undefined' && (process.env?.GEMINI_API_KEY || process.env?.API_KEY))
    || (typeof import.meta !== 'undefined' && ((import.meta as any).env?.VITE_GEMINI_API_KEY || (import.meta as any).env?.GEMINI_API_KEY));
  
  return (envKey as string) || '';
};

export const hasAvailableApiKey = (): boolean => {
  return Boolean(getEffectiveApiKey());
};

export const hasEnvApiKey = (): boolean => {
  const envKey = (typeof process !== 'undefined' && (process.env?.GEMINI_API_KEY || process.env?.API_KEY))
    || (typeof import.meta !== 'undefined' && ((import.meta as any).env?.VITE_GEMINI_API_KEY || (import.meta as any).env?.GEMINI_API_KEY));
  return Boolean(envKey);
};

export const testGeminiApiKey = async (apiKey?: string): Promise<{ success: boolean; message: string }> => {
  try {
    const ai = getClient(apiKey);
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: 'Respond with the word OK.',
    });
    if (response.text) {
      return { success: true, message: 'Khóa API hợp lệ và sẵn sàng hoạt động!' };
    }
    return { success: false, message: 'Không nhận được dữ liệu từ Gemini.' };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || 'Không thể xác thực API Key. Vui lòng kiểm tra lại.'
    };
  }
};

const getClient = (apiKey?: string) => {
  const key = getEffectiveApiKey(apiKey);
  if (!key) {
    throw new Error(
      "Chưa có Gemini API Key. Vui lòng bấm nút 'Cài đặt API Key' ở góc trên để nhập khóa API của bạn, hoặc cấu hình biến môi trường GEMINI_API_KEY trên Cloudflare Pages."
    );
  }
  return new GoogleGenAI({ apiKey: key });
};

/**
 * Analyzes the whole subtitle script to detect character relationships, genders,
 * overall tone, and specific pronoun / address guidelines (xưng hô nam nữ, etc.)
 */
export const analyzeSubtitleContext = async (
  subtitles: SubtitleBlock[],
  sourceLang: string,
  targetLang: string,
  model: string = 'gemini-3.8-flash'
): Promise<CharacterAnalysis> => {
  if (subtitles.length === 0) {
    return {
      summary: "Không có câu thoại nào để phân tích.",
      tone: "Tự nhiên",
      relationships: [],
      customGuidelines: ""
    };
  }

  // Sample lines if dialogue is long (sample head, middle, tail up to 150 lines)
  let sampledTexts: string[];
  if (subtitles.length <= 150) {
    sampledTexts = subtitles.map(s => s.text);
  } else {
    const head = subtitles.slice(0, 70).map(s => s.text);
    const mid = subtitles.slice(Math.floor(subtitles.length / 2) - 25, Math.floor(subtitles.length / 2) + 25).map(s => s.text);
    const tail = subtitles.slice(-30).map(s => s.text);
    sampledTexts = [...head, "... [Đoạn giữa kịch bản] ...", ...mid, "... [Đoạn kết kịch bản] ...", ...tail];
  }

  const prompt = `
    You are an expert linguistic analyst and translation director specializing in context, gender, character relationships, and forms of address (xưng hô) for translating subtitles into ${targetLang}.

    Task: Analyze the provided subtitle dialogue excerpts to extract critical context before translation:
    1. Overall Story Summary & Setting (Who are the key characters? What is the main story/genre?).
    2. Overall Tone (e.g., Casual Romantic, Formal Corporate, Historical Drama, Modern Action Comedy).
    3. Character Relationships & Pronouns / Forms of Address Matrix (Xưng hô):
       - Identify speakers/characters (names if available, or roles e.g., Male Lead, Female Lead, Manager, Best Friend, Mother, Child).
       - Infer their genders (Male / Female).
       - Define exact forms of address (xưng hô) between each speaker and listener pair for ${targetLang}.
         * e.g., for Vietnamese: Male lead -> Female lead = "Anh - Em", Manager -> Employee = "Tôi - Cậu/Anh", Parent -> Child = "Bố/Mẹ - Con", Friends = "Tớ - Cậu" or "Mày - Tao".
    4. Custom Translation Guidelines: Clear, actionable instructions to guarantee pronoun and relationship terms are 100% consistent across all subtitle blocks.

    Subtitle Excerpt:
    ${JSON.stringify(sampledTexts)}
  `;

  try {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            tone: { type: Type.STRING },
            customGuidelines: { type: Type.STRING },
            relationships: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  speaker: { type: Type.STRING },
                  listener: { type: Type.STRING },
                  pronounSpeaker: { type: Type.STRING },
                  pronounListener: { type: Type.STRING },
                  notes: { type: Type.STRING }
                },
                required: ["speaker", "listener", "pronounSpeaker", "pronounListener"]
              }
            }
          },
          required: ["summary", "tone", "relationships", "customGuidelines"]
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("Empty analysis response");

    const parsed: CharacterAnalysis = JSON.parse(jsonText);
    return parsed;
  } catch (error) {
    console.error("Error analyzing subtitle context:", error);
    return {
      summary: "Tự động phân tích bối cảnh thoại.",
      tone: "Tự nhiên / Thường nhật",
      relationships: [
        {
          speaker: "Nhân vật Nam",
          listener: "Nhân vật Nữ",
          pronounSpeaker: "Anh / Tôi",
          pronounListener: "Em / Cô",
          notes: "Giữ xưng hô nam nữ nhất quán"
        }
      ],
      customGuidelines: `Dịch sang ${targetLang} tự nhiên, giữ xưng hô nhất quán phù hợp giới tính và mối quan hệ.`
    };
  }
};

export const translateBatch = async (
  items: SubtitleItem[],
  sourceLang: string,
  targetLang: string,
  model: string = 'gemini-3.8-flash',
  onRetry?: (attempt: number, delayMs: number) => void,
  analysis?: CharacterAnalysis | null
): Promise<Map<number, string>> => {
  if (items.length === 0) return new Map();

  const MAX_RETRIES = 3;
  let attempt = 0;

  // Build analysis guidance section if analysis exists
  let contextSection = "";
  if (analysis) {
    const relRules = analysis.relationships && analysis.relationships.length > 0
      ? analysis.relationships.map(r => `- ${r.speaker} -> ${r.listener}: Xưng "${r.pronounSpeaker}", gọi "${r.pronounListener}" (${r.notes || ''})`).join('\n')
      : "Tuân thủ xưng hô nhất quán dựa theo giới tính và độ tuổi nhân vật.";

    contextSection = `
    --- DIALOGUE CONTEXT & PRONOUN RULES (QUY TẮC XƯNG HÔ NAM NỮ & MỐI QUAN HỆ) ---
    Target Language: ${targetLang}
    Story Context: ${analysis.summary}
    Tone: ${analysis.tone}
    
    STRICT PRONOUN & ADDRESS GUIDELINES (BẮT BUỘC TUÂN THỦ XƯNG HÔ):
    ${analysis.customGuidelines}
    
    RELATIONSHIP MATRIX:
    ${relRules}
    ----------------------------------------------------------
    `;
  }

  // Build fixed-key dictionary and schema (e.g. "b_1", "b_2", ...)
  // This guarantees Gemini CANNOT add, remove, merge, or shift any subtitle block!
  const inputDict: Record<string, string> = {};
  const schemaProperties: Record<string, any> = {};
  const schemaRequired: string[] = [];

  items.forEach(item => {
    const key = `b_${item.id}`;
    inputDict[key] = item.text;
    schemaProperties[key] = {
      type: Type.STRING,
      description: `Exact translation of subtitle block #${item.id}`
    };
    schemaRequired.push(key);
  });

  const prompt = `
    You are an expert subtitle translation director.
    Translate each subtitle block into ${targetLang}.
    
    ${contextSection}

    CRITICAL RULES - ABSOLUTE 1-TO-1 BLOCK PRESERVATION (CHỐNG LỆCH DÒNG TUYỆT ĐỐI):
    1. STRICT KEY-TO-KEY MAPPING:
       - The input is a JSON object where each key represents a specific subtitle block (e.g. "b_${items[0]?.id || 1}", etc.).
       - You MUST return a JSON object containing the EXACT SAME keys.
       - Each key's value MUST be the translation of ONLY that specific block.
       - NEVER shift or swap sentences between keys (e.g., NEVER put the translation of block 11 into block 12!).
       - NEVER merge multiple blocks together. Each block has its own independent video timestamp!
    2. MULTI-LINE DIALOGUES:
       - If a single block contains multiple dialogue lines (e.g., two speakers separated by \\n or hyphens "-"), keep all dialogue lines inside that SAME key's value.
    3. SHORT / SOUND BLOCKS:
       - Even if a block is short, contains only punctuation (e.g. "...", "?"), sound effects (e.g. "[Music]", "[Applause]"), or interjections, translate or preserve it inside its own key.
    4. PRESERVE FORMATTING:
       - Keep any formatting tags intact (<i>...</i>, <b>...</b>, {\\an8}, \\N).
    5. PRONOUNS (XƯNG HÔ):
       - Strictly adhere to character gender and relationship forms of address defined above.

    INPUT DICTIONARY TO TRANSLATE:
    ${JSON.stringify(inputDict, null, 2)}
  `;

  while (attempt <= MAX_RETRIES) {
    try {
      const ai = getClient();
      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: schemaProperties,
            required: schemaRequired
          }
        }
      });

      const jsonText = response.text;
      if (!jsonText) {
        throw new Error("Empty response from Gemini");
      }

      const parsedObj = JSON.parse(jsonText);
      const resultMap = new Map<number, string>();

      items.forEach(item => {
        const key = `b_${item.id}`;
        // Look up by dedicated key "b_<id>", or fallback to numeric key
        const translatedVal = parsedObj[key] 
          ?? parsedObj[String(item.id)] 
          ?? parsedObj[item.id];

        if (typeof translatedVal === 'string' && translatedVal.trim() !== '') {
          resultMap.set(item.id, translatedVal);
        } else {
          // If empty, keep original text for this block so no other block ever shifts
          resultMap.set(item.id, item.text);
        }
      });

      return resultMap;

    } catch (error: any) {
      // Check for rate limit errors (429) or service overload (503)
      const isRateLimit = error.message?.includes('429') || error.status === 429;
      const isServiceUnavailable = error.message?.includes('503') || error.status === 503;
      
      if ((isRateLimit || isServiceUnavailable) && attempt < MAX_RETRIES) {
        attempt++;
        const delayMs = Math.pow(2, attempt) * 1000;
        if (onRetry) onRetry(attempt, delayMs);
        console.warn(`Attempt ${attempt} failed with rate limit. Retrying in ${delayMs}ms...`);
        await delay(delayMs);
        continue;
      }

      console.error("Translation error:", error);
      throw error;
    }
  }

  // Fallback: return original text for each block
  const fallbackMap = new Map<number, string>();
  items.forEach(item => fallbackMap.set(item.id, item.text));
  return fallbackMap;
};
