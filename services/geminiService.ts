
import { GoogleGenAI, Type } from "@google/genai";
import { SubtitleBlock, CharacterAnalysis } from "../types";

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
  texts: string[],
  sourceLang: string,
  targetLang: string,
  model: string = 'gemini-3.8-flash',
  onRetry?: (attempt: number, delayMs: number) => void,
  analysis?: CharacterAnalysis | null
): Promise<string[]> => {
  if (texts.length === 0) return [];

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

  // Define a prompt that encourages brevity and subtitle formatting
  const prompt = `
    You are a professional subtitle translator. 
    Translate the following array of subtitle text segments from ${sourceLang === 'auto' ? 'the detected language' : sourceLang} to ${targetLang}.
    
    ${contextSection}

    Rules:
    1. Maintain tone, style, and strict consistency in pronoun/address usage (xưng hô) as defined above.
    2. Keep translations concise to fit within standard subtitle limits where possible.
    3. Do not add any introductory or concluding text.
    4. Return exactly the same number of items in the array as provided.
    5. Preserve any HTML tags like <i> or <b> if present.
    6. Output ONLY a valid JSON array of strings, with no markdown formatting or other text.
    
    Input texts:
    ${JSON.stringify(texts)}
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
            items: { type: Type.STRING },
          }
        }
      });

      const jsonText = response.text;
      if (!jsonText) {
        throw new Error("Empty response from Gemini");
      }

      const translatedArray = JSON.parse(jsonText);
      
      if (!Array.isArray(translatedArray)) {
          throw new Error("Invalid response format");
      }

      // Fallback: if lengths mismatch, we return original to avoid desync
      if (translatedArray.length !== texts.length) {
        console.warn(`Mismatch in translation count. Sent ${texts.length}, received ${translatedArray.length}. Padding with originals.`);
        return texts.map((orig, i) => translatedArray[i] || orig);
      }

      return translatedArray;

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

  return texts;
};
