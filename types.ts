
export interface SubtitleBlock {
  id: number;
  startTime: string;
  endTime: string;
  text: string;
}

export interface SubtitleItem {
  id: number;
  text: string;
}

export enum TranslationStatus {
  IDLE = 'IDLE',
  PARSING = 'PARSING',
  ANALYZING = 'ANALYZING',
  TRANSLATING = 'TRANSLATING',
  RETRYING = 'RETRYING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface RelationshipRule {
  id?: string;
  speaker: string;
  listener: string;
  pronounSpeaker: string;
  pronounListener: string;
  notes?: string;
}

export interface CharacterAnalysis {
  summary: string;
  tone: string;
  relationships: RelationshipRule[];
  customGuidelines: string;
}

export interface LanguageOption {
  code: string;
  name: string;
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
}

export const MODELS: ModelOption[] = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', description: 'Mới Nhất & Dịch Chuẩn Xác (Khuyên dùng)' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', description: 'Siêu Nhanh & Tiết Kiệm' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', description: 'Nhanh & Ổn Định' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Thế Hệ 3 Flash' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', description: 'Suy Luận Cao Cấp' },
];

export const LANGUAGES: LanguageOption[] = [
  { code: 'vi', name: 'Vietnamese' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'ru', name: 'Russian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'it', name: 'Italian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'th', name: 'Thai' },
];
