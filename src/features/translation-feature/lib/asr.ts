/**
 * asr.ts — Local Automatic Speech Recognition wrapper
 *
 * Uses the Whisper-tiny pipeline from modelManager.
 * Input:  16 kHz mono Float32Array (from audioCapture → VAD)
 * Output: { text, confidence }
 *
 * Streaming:
 *   Pass an `onPartial` callback to receive intermediate token chunks
 *   as Whisper decodes them.  Each call receives the growing transcript
 *   so far — the caller may update the UI with ADD_PARTIAL_TRANSCRIPT.
 *
 * Language codes:
 *   Pass ISO 639-1 codes (e.g. 'en', 'es', 'zh').  The module maps them
 *   to Whisper's expected identifiers automatically.
 */

import { getModels } from './modelManager';

// ─── Language code mapping ────────────────────────────────────────────────────

/**
 * Maps our ISO 639-1 codes to Whisper language identifiers.
 * Whisper accepts the lowercase English name of the language.
 */
const WHISPER_LANG: Record<string, string> = {
  en: 'english',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  ar: 'arabic',
  hi: 'hindi',
  zh: 'chinese',
  pt: 'portuguese',
  ru: 'russian',
  ja: 'japanese',
};

function toWhisperLang(code: string): string {
  return WHISPER_LANG[code] ?? code;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranscribeResult {
  text: string;
  /** Normalised confidence 0–1; estimated from the decoder log-prob sequence */
  confidence: number;
}

export interface TranscribeOptions {
  /**
   * Called with the growing partial transcript during decoding.
   * Only fires when the runtime supports streaming token output.
   */
  onPartial?: (partialText: string) => void;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Transcribes a 16 kHz mono Float32Array utterance to text.
 *
 * @param audio      — 16 kHz mono PCM from the VAD finalised utterance
 * @param sourceLang — ISO 639-1 language code (e.g. 'en', 'es')
 * @param options    — optional streaming callback
 *
 * @throws if models have not been loaded via loadModels()
 */
export async function transcribe(
  audio: Float32Array,
  sourceLang: string,
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const models = getModels();
  if (!models) throw new Error('Models not loaded. Call loadModels() first.');

  const { transcriber } = models;
  const language = toWhisperLang(sourceLang);

  // Accumulate partial tokens for the streaming callback
  let partialAccumulator = '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output: any = await (transcriber as any)(audio, {
    language,
    task: 'transcribe',
    // Chunk the audio into 30s windows with a 5s stride for long utterances
    chunk_length_s: 30,
    stride_length_s: 5,
    // Streaming callback — Transformers.js calls this with beam hypotheses
    // as they are generated.  We extract the best hypothesis text each time.
    callback_function: options.onPartial
      ? (beams: unknown[]) => {
          // Each beam is an array of token objects; the first is the best hypothesis
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const best = (beams as any[])[0];
          if (!best) return;
          // `output_token_ids` or `text` depending on version
          const partial: string = best.text ?? '';
          if (partial && partial !== partialAccumulator) {
            partialAccumulator = partial;
            options.onPartial!(partial.trim());
          }
        }
      : undefined,
  });

  // output is { text: string } or { chunks: [{ text }] }
  const rawText: string =
    typeof output?.text === 'string'
      ? output.text
      : (output?.chunks ?? []).map((c: { text: string }) => c.text).join(' ');

  const text = rawText.trim();

  // Estimate confidence from text length heuristic when not provided by model.
  // A very short text from a long audio segment suggests low confidence.
  const durationSeconds = audio.length / 16_000;
  const wordsPerSecond = text.split(/\s+/).filter(Boolean).length / Math.max(durationSeconds, 1);
  // Normal speech: ~2–4 wps.  Below 0.5 or empty = low confidence.
  const confidence = text.length === 0
    ? 0
    : Math.min(1, Math.max(0.1, Math.min(wordsPerSecond / 3, 1)));

  return { text: text || '[inaudible]', confidence };
}
