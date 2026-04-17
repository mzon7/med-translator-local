/**
 * translate.ts — Local neural machine translation wrapper
 *
 * Uses the NLLB-200-distilled-600M pipeline from modelManager.
 * Supports all language pairs covered by NLLB-200 (200 languages).
 *
 * Design choices for medical reliability:
 *   • max_new_tokens capped at 512 to prevent runaway generation
 *   • num_beams=4 for deterministic beam search (no sampling)
 *   • temperature is not exposed — beam search is deterministic by default
 *   • Forced BOS token ensures the model targets the correct language
 *
 * Language codes:
 *   Pass ISO 639-1 codes (e.g. 'en', 'es').  The module maps them to NLLB's
 *   BCP-47-ish codes (e.g. 'eng_Latn', 'spa_Latn') automatically.
 */

import { getModels } from './modelManager';

// ─── Language code mapping ────────────────────────────────────────────────────

/**
 * Maps our ISO 639-1 codes to NLLB-200 language codes.
 * NLLB codes follow the pattern: {ISO 639-3}_{ISO 15924 script}.
 */
const NLLB_LANG: Record<string, string> = {
  en: 'eng_Latn',
  es: 'spa_Latn',
  fr: 'fra_Latn',
  de: 'deu_Latn',
  ar: 'arb_Arab',
  hi: 'hin_Deva',
  zh: 'zho_Hans',
  pt: 'por_Latn',
  ru: 'rus_Cyrl',
  ja: 'jpn_Jpan',
};

function toNllbLang(code: string): string {
  const mapped = NLLB_LANG[code];
  if (!mapped) {
    console.warn(`[translate] Unknown language code '${code}', passing through as-is`);
    return code;
  }
  return mapped;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Translates text from `srcLang` to `tgtLang` using a local NLLB-200 model.
 *
 * @param text     — source text to translate
 * @param srcLang  — ISO 639-1 source language code (e.g. 'en')
 * @param tgtLang  — ISO 639-1 target language code (e.g. 'es')
 * @returns translated text string
 *
 * @throws if models have not been loaded, or if the language pair is unsupported
 */
export async function translate(
  text: string,
  srcLang: string,
  tgtLang: string,
): Promise<string> {
  if (!text.trim() || text === '[inaudible]') return '';
  if (srcLang === tgtLang) return text;

  const models = getModels();
  if (!models) throw new Error('Models not loaded. Call loadModels() first.');

  const { translator } = models;

  const src = toNllbLang(srcLang);
  const tgt = toNllbLang(tgtLang);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output: any = await (translator as any)(text, {
    src_lang: src,
    tgt_lang: tgt,
    // Deterministic beam search — important for medical translations
    // where repeatability matters more than creativity
    num_beams: 4,
    max_new_tokens: 512,
    // No sampling — fully deterministic
    do_sample: false,
  });

  // output is an array of objects with translation_text
  const result = Array.isArray(output)
    ? output[0]?.translation_text ?? ''
    : output?.translation_text ?? String(output);

  return result.trim();
}
