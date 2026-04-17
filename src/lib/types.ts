// Shared types for Med Translator Local

export type SessionState =
  | 'idle'
  | 'requestingMic'
  | 'listening'
  | 'processing'
  | 'error'
  | 'unsupported';

export type ModelStatus = 'unloaded' | 'loading' | 'ready' | 'error';

export interface Language {
  code: string;
  label: string;
  locale: string;
  dir?: 'ltr' | 'rtl';
}

export interface TranscriptEntry {
  id: string;
  text: string;
  translatedText?: string;
  speaker: 'left' | 'right';
  timestamp: number;
  isPartial?: boolean;
}

export interface TranslatorSessionState {
  session: SessionState;
  modelStatus: ModelStatus;
  modelProgress: number; // 0–100
  leftLanguage: Language;
  rightLanguage: Language;
  transcripts: TranscriptEntry[];
  error: string | null;
}

export type TranslatorAction =
  | { type: 'SET_SESSION'; payload: SessionState }
  | { type: 'SET_MODEL_STATUS'; payload: { status: ModelStatus; progress?: number } }
  | { type: 'SET_LEFT_LANGUAGE'; payload: Language }
  | { type: 'SET_RIGHT_LANGUAGE'; payload: Language }
  | { type: 'ADD_TRANSCRIPT'; payload: TranscriptEntry }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'CLEAR_TRANSCRIPTS' };
