
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

  // Explicit prompt guaranteeing 1-to-1 subtitle block mapping by ID
  const prompt = `
    You are a professional subtitle translator. 
    You are provided with a JSON array of subtitle blocks. Each block has an exact integer "id" and a "text".
    Translate the "text" of each block from ${sourceLang === 'auto' ? 'the detected language' : sourceLang} to ${targetLang}.
    
    ${contextSection}

    CRITICAL RULES - STRICT 1-TO-1 BLOCK CORRESPONDENCE (BẢO TOÀN TỪNG BLOCK VÀ THỜI GIAN):
    1. EXACT ID PAIRING:
       - Every input block ID must exist in the output array with its exact same "id".
       - NEVER merge two or more subtitle blocks into one block under any circumstance.
       - NEVER split one subtitle block into multiple blocks.
       - NEVER skip or delete any block, even if it is short, contains only punctuation (e.g., "...", "?"), sound cues (e.g., "[Music]", "(sigh)"), or numbers.
    2. MULTI-LINE DIALOGUE:
       - If a single block contains multiple dialogue lines (separated by \\n or hyphens "-"), keep all dialogue lines within that SAME block's "text".
    3. PRESERVE FORMATTING:
       - Preserve HTML tags (<i>, <b>) or ASS subtitle tags ({\\an8}, \\N) intact.
    4. ACCURATE PRONOUNS:
       - Maintain consistent character address (xưng hô) according to the rules above.
    5. OUTPUT FORMAT:
       - Output MUST be a valid JSON array of objects: [{"id": <number>, "text": "<translated string>"}, ...].
       - Do NOT include any introductory or concluding text, explanations, or markdown fences.

    INPUT BLOCKS:
    ${JSON.stringify(items.map(b => ({ id: b.id, text: b.text })))}
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
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                text: { type: Type.STRING }
              },
              required: ["id", "text"]
            }
          }
        }
      });

      const jsonText = response.text;
      if (!jsonText) {
        throw new Error("Empty response from Gemini");
      }

      const translatedArray = JSON.parse(jsonText);
      
      if (!Array.isArray(translatedArray)) {
        throw new Error("Invalid response format: expected JSON array");
      }

      const resultMap = new Map<number, string>();
      for (const item of translatedArray) {
        if (item && typeof item.id === 'number' && typeof item.text === 'string') {
          resultMap.set(item.id, item.text);
        }
      }

      // Safeguard: Ensure every input block has a valid translation mapped by its ID
      items.forEach((item, idx) => {
        if (!resultMap.has(item.id)) {
          // If translation count matches, fallback to positional item if valid
          if (translatedArray[idx] && typeof translatedArray[idx].text === 'string') {
            resultMap.set(item.id, translatedArray[idx].text);
          } else {
            // Keep original text for this block so other blocks never shift
            resultMap.set(item.id, item.text);
          }
        }
      });

      return resultMap;

    } catch (error: any) {
      // Check for rate limit errors (429) or service overload (503)
      const isRateLimit = error.message?.includes('429') || error.status === 429;
      const isServiceUnavailable = error.message?.includes('503') || error.status === 503;
      
      if ((isRateLimit || isServiceUnavailable) && attempt < MAX_RETRIES) {
        attempt++;
        // Exponential backoff: 2s, 4s, 8s
        const delayMs = Math.pow(2, attempt) * 1000;
        
        if (onRetry) {
          onRetry(attempt, delayMs);
        }
        
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
