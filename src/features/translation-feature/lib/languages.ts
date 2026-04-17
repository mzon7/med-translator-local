import type { Language } from '../../../lib/types';

export const LANGUAGES: Language[] = [
  { code: 'en', label: 'English', locale: 'en-US', dir: 'ltr' },
  { code: 'es', label: 'Spanish', locale: 'es-ES', dir: 'ltr' },
  { code: 'fr', label: 'French', locale: 'fr-FR', dir: 'ltr' },
  { code: 'de', label: 'German', locale: 'de-DE', dir: 'ltr' },
  { code: 'ar', label: 'Arabic', locale: 'ar-SA', dir: 'rtl' },
  { code: 'hi', label: 'Hindi', locale: 'hi-IN', dir: 'ltr' },
  { code: 'zh', label: 'Chinese', locale: 'zh-CN', dir: 'ltr' },
  { code: 'pt', label: 'Portuguese', locale: 'pt-BR', dir: 'ltr' },
  { code: 'ru', label: 'Russian', locale: 'ru-RU', dir: 'ltr' },
  { code: 'ja', label: 'Japanese', locale: 'ja-JP', dir: 'ltr' },
];

export const DEFAULT_LEFT_LANGUAGE = LANGUAGES[0]; // English
export const DEFAULT_RIGHT_LANGUAGE = LANGUAGES[1]; // Spanish

const STORAGE_KEY_LEFT = 'med_translator_lang_left';
const STORAGE_KEY_RIGHT = 'med_translator_lang_right';

export function loadPersistedLanguages(): {
  left: Language;
  right: Language;
} {
  try {
    const leftCode = localStorage.getItem(STORAGE_KEY_LEFT);
    const rightCode = localStorage.getItem(STORAGE_KEY_RIGHT);
    const left = LANGUAGES.find((l) => l.code === leftCode) ?? DEFAULT_LEFT_LANGUAGE;
    const right = LANGUAGES.find((l) => l.code === rightCode) ?? DEFAULT_RIGHT_LANGUAGE;
    return { left, right };
  } catch {
    return { left: DEFAULT_LEFT_LANGUAGE, right: DEFAULT_RIGHT_LANGUAGE };
  }
}

export function persistLanguage(side: 'left' | 'right', lang: Language): void {
  try {
    const key = side === 'left' ? STORAGE_KEY_LEFT : STORAGE_KEY_RIGHT;
    localStorage.setItem(key, lang.code);
  } catch {
    // localStorage unavailable — ignore
  }
}

// ─── Model-ready flag ─────────────────────────────────────────────────────────

/**
 * Key used to record that the user has previously loaded the local AI models.
 * When this flag is present, the app auto-starts model loading on mount
 * because the weights are very likely cached in IndexedDB already.
 */
const STORAGE_KEY_MODEL_READY = 'med_translator_model_ready';

/**
 * Persists a flag indicating that models have been successfully loaded at
 * least once.  Called after MODEL_READY so subsequent visits can auto-load
 * from the IndexedDB cache without requiring a manual "Download" tap.
 */
export function persistModelReady(): void {
  try {
    localStorage.setItem(STORAGE_KEY_MODEL_READY, '1');
  } catch {
    // localStorage unavailable — ignore
  }
}

/**
 * Returns true if models have been successfully loaded in a previous session
 * and are likely cached in IndexedDB.
 */
export function loadModelReady(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_MODEL_READY) === '1';
  } catch {
    return false;
  }
}

/**
 * Clears the model-ready flag.  Called when a load attempt fails so the next
 * visit does not auto-start a failing load.
 */
export function clearModelReady(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_MODEL_READY);
  } catch {
    // localStorage unavailable — ignore
  }
}
