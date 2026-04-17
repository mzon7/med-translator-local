// Shared types for Med Translator Local

// ─── Language ────────────────────────────────────────────────────────────────

/** ISO 639-1 language code (e.g. 'en', 'es', 'ar') */
export type LanguageCode = string;

export interface Language {
  code: LanguageCode;
  label: string;
  locale: string;
  dir?: 'ltr' | 'rtl';
}

// ─── Speaker ─────────────────────────────────────────────────────────────────

/** Which side of the conversation a speaker belongs to */
export type SpeakerSide = 'left' | 'right' | 'unknown';

// ─── Utterance ────────────────────────────────────────────────────────────────

export interface Utterance {
  id: string;
  timestampStart: number;
  timestampEnd?: number;
  speakerSide: SpeakerSide;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  sourceText: string;
  translatedText?: string;
  confidence?: number;
  /** Blob URL to cached audio for this utterance */
  audioRef?: string;
  isPartial?: boolean;
  /** True when ASR or translation failed for this utterance */
  failed?: boolean;
  /** Human-readable reason for the failure */
  failedReason?: string;
}

// ─── Status enums ────────────────────────────────────────────────────────────

export type ModelStatus = 'unloaded' | 'loading' | 'ready' | 'error';

export type MicStatus = 'idle' | 'requesting' | 'granted' | 'denied';

export type SessionStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'error'
  | 'unsupported';

// ─── Session state ────────────────────────────────────────────────────────────

export interface TranslatorSessionState {
  modelStatus: ModelStatus;
  modelProgress: number; // 0–100
  micStatus: MicStatus;
  sessionStatus: SessionStatus;
  leftLang: Language;
  rightLang: Language;
  utterances: Utterance[];
  error: string | null;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type TranslatorAction =
  | { type: 'SET_LANG'; payload: { side: 'left' | 'right'; lang: Language } }
  | { type: 'MODEL_LOADING'; payload?: { progress: number } }
  | { type: 'MODEL_READY' }
  | { type: 'MODEL_ERROR'; payload: string }
  | { type: 'MIC_REQUEST' }
  | { type: 'MIC_GRANTED' }
  | { type: 'MIC_DENIED' }
  /** Reset mic + session status so the user can try requesting mic access again */
  | { type: 'MIC_RETRY' }
  | { type: 'START_LISTENING' }
  | { type: 'STOP_LISTENING' }
  | { type: 'ADD_PARTIAL_TRANSCRIPT'; payload: Utterance }
  | { type: 'FINALIZE_UTTERANCE'; payload: Utterance }
  /** Mark a specific utterance as failed; session stays alive */
  | { type: 'FAIL_UTTERANCE'; payload: { id: string; reason: string } }
  /** Clear a failed utterance's error state so it can be retried */
  | { type: 'RETRY_UTTERANCE'; payload: { id: string } }
  | { type: 'SET_ERROR'; payload: string };
