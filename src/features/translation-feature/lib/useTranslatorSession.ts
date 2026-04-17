import { useReducer, useCallback, useEffect, useRef } from 'react';
import type {
  TranslatorSessionState,
  TranslatorAction,
  Language,
  Utterance,
} from '../../../lib/types';
import {
  loadPersistedLanguages,
  persistLanguage,
  persistModelReady,
  loadModelReady,
  clearModelReady,
} from './languages';
import {
  startAudioCapture,
  type AudioCaptureHandle,
  type AudioCaptureCallbacks,
} from './audioCapture';
import { createVAD, type VadHandle } from './vad';
import { createSpeakerHeuristics, type SpeakerHeuristicsHandle } from './speakerHeuristics';
import { loadModels as _loadModels, type ProgressCallback } from './modelManager';
import { transcribe } from './asr';
import { translate } from './translate';
import { sanitizeForLog, assertLocalOnly } from './privacyBoundary';

// ─── Reducer ─────────────────────────────────────────────────────────────────

function reducer(
  state: TranslatorSessionState,
  action: TranslatorAction,
): TranslatorSessionState {
  switch (action.type) {
    case 'SET_LANG':
      return action.payload.side === 'left'
        ? { ...state, leftLang: action.payload.lang }
        : { ...state, rightLang: action.payload.lang };

    case 'MODEL_LOADING':
      return {
        ...state,
        modelStatus: 'loading',
        modelProgress: action.payload?.progress ?? state.modelProgress,
        modelFromCache: action.payload?.fromCache ?? state.modelFromCache,
        modelCurrentFile: action.payload?.file ?? state.modelCurrentFile,
        error: null,
      };
    case 'MODEL_READY':
      return {
        ...state,
        modelStatus: 'ready',
        modelProgress: 100,
        modelCurrentFile: null,
        error: null,
      };
    case 'MODEL_ERROR':
      return { ...state, modelStatus: 'error', error: action.payload };

    case 'MIC_REQUEST':
      return { ...state, micStatus: 'requesting', error: null };
    case 'MIC_GRANTED':
      return { ...state, micStatus: 'granted' };
    case 'MIC_DENIED':
      return {
        ...state,
        micStatus: 'denied',
        sessionStatus: 'error',
        error: 'Microphone access was denied. Please allow microphone access and try again.',
      };
    case 'MIC_RETRY':
      return {
        ...state,
        micStatus: 'idle',
        sessionStatus: 'idle',
        error: null,
      };

    case 'START_LISTENING':
      return { ...state, sessionStatus: 'listening', error: null };
    case 'STOP_LISTENING':
      return {
        ...state,
        sessionStatus: 'idle',
        micStatus: state.micStatus === 'granted' ? 'idle' : state.micStatus,
        error: null,
      };

    case 'ADD_PARTIAL_TRANSCRIPT': {
      const rest = state.utterances.filter(
        (u) => !(u.isPartial && u.speakerSide === action.payload.speakerSide),
      );
      return {
        ...state,
        sessionStatus: 'listening',
        utterances: [...rest, action.payload],
      };
    }
    case 'FINALIZE_UTTERANCE': {
      const rest = state.utterances.filter(
        (u) => !(u.isPartial && u.speakerSide === action.payload.speakerSide),
      );
      return {
        ...state,
        utterances: [...rest, { ...action.payload, isPartial: false }],
      };
    }

    case 'FAIL_UTTERANCE': {
      // Mark the utterance as failed without touching sessionStatus
      return {
        ...state,
        utterances: state.utterances.map((u) =>
          u.id === action.payload.id
            ? { ...u, isPartial: false, failed: true, failedReason: action.payload.reason }
            : u,
        ),
      };
    }

    case 'RETRY_UTTERANCE': {
      // Clear failed state while the retry is in-flight
      return {
        ...state,
        utterances: state.utterances.map((u) =>
          u.id === action.payload.id
            ? { ...u, failed: false, failedReason: undefined, isPartial: true, sourceText: '…' }
            : u,
        ),
      };
    }

    case 'SET_ERROR':
      return { ...state, sessionStatus: 'error', error: action.payload };

    case 'CLEAR_TRANSCRIPT':
      // Wipes in-memory transcript only — no server call, no IndexedDB write
      return { ...state, utterances: [] };

    default:
      return state;
  }
}

// ─── Initial state ────────────────────────────────────────────────────────────

function buildInitialState(): TranslatorSessionState {
  const { left, right } = loadPersistedLanguages();
  return {
    modelStatus: 'unloaded',
    modelProgress: 0,
    modelFromCache: null,
    modelCurrentFile: null,
    micStatus: 'idle',
    sessionStatus: 'idle',
    leftLang: left,
    rightLang: right,
    utterances: [],
    error: null,
  };
}

// ─── Types for pipeline hooks ─────────────────────────────────────────────────

/**
 * Called by VAD when a complete utterance has been segmented.
 * Step 5 (ASR) will replace the default no-op with its own handler.
 *
 * @param audio        - 16 kHz mono PCM for the entire utterance
 * @param utteranceId  - pre-assigned ID to match partial → final states
 * @param forcedSplit  - true when the 12 s cap triggered segmentation
 */
export type SpeechEndCallback = (
  audio: Float32Array,
  utteranceId: string,
  forcedSplit: boolean,
) => void;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTranslatorSession() {
  const [state, dispatch] = useReducer(reducer, undefined, buildInitialState);

  /** Active audio capture handle */
  const captureRef = useRef<AudioCaptureHandle | null>(null);

  /** Active VAD instance */
  const vadRef = useRef<VadHandle | null>(null);

  /** Active speaker-heuristics instance */
  const speakerRef = useRef<SpeakerHeuristicsHandle | null>(null);

  /**
   * Raw PCM listener registered with audioCapture.
   * Replaced with vad.processChunk on start, reset to no-op on stop.
   */
  const pcmListenerRef = useRef<AudioCaptureCallbacks['onPCMData']>(() => undefined);

  /**
   * Speech-end callback for the ASR pipeline.
   * Step 5 will replace pcmListenerRef.current is used internally;
   * this ref is the ASR integration point.
   */
  const speechEndCallbackRef = useRef<SpeechEndCallback>(() => undefined);

  /**
   * Holds the current session state in a ref so async callbacks can
   * read it without closing over a stale value.
   */
  const stateRef = useRef(state);
  stateRef.current = state;

  /**
   * Stores PCM audio for failed utterances keyed by utterance id.
   * Allows retryUtterance() to re-run the pipeline without re-capturing.
   * Entries are removed after a successful retry or explicit discard.
   */
  const failedAudioMapRef = useRef<Map<string, Float32Array>>(new Map());

  // Clean up on unmount
  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      captureRef.current = null;
      vadRef.current?.reset();
      vadRef.current = null;
      speakerRef.current?.reset();
      speakerRef.current = null;
      pcmListenerRef.current = () => undefined;
    };
  }, []);

  /**
   * Auto-load models on mount when the modelReady flag is set in localStorage,
   * indicating weights are likely cached in IndexedDB from a previous session.
   * This makes subsequent visits feel instant (cache load instead of download).
   */
  useEffect(() => {
    if (loadModelReady()) {
      void downloadModel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount only

  // ── Language ────────────────────────────────────────────────────────────────

  const setLang = useCallback((side: 'left' | 'right', lang: Language) => {
    persistLanguage(side, lang);
    dispatch({ type: 'SET_LANG', payload: { side, lang } });
  }, []);

  // ── Model lifecycle ─────────────────────────────────────────────────────────

  const modelLoading = useCallback((progress?: number) => {
    dispatch({
      type: 'MODEL_LOADING',
      payload: progress !== undefined ? { progress } : undefined,
    });
  }, []);
  const modelReady = useCallback(() => dispatch({ type: 'MODEL_READY' }), []);
  const modelError = useCallback(
    (msg: string) => dispatch({ type: 'MODEL_ERROR', payload: msg }),
    [],
  );

  /**
   * Downloads and initialises ASR + translation models.
   * Reports progress via MODEL_LOADING actions; calls MODEL_READY on success.
   * Detects WebGPU and falls back to WASM automatically.
   */
  const downloadModel = useCallback(async () => {
    dispatch({ type: 'MODEL_LOADING' });
    // Clear flag at start — it will be re-set only on success
    clearModelReady();
    try {
      const onProgress: ProgressCallback = ({ phase, progress, fromCache, file }) => {
        // Map two phases (asr=0-50%, translation=50-100%) into a single bar
        const overall = phase === 'asr' ? progress / 2 : 50 + progress / 2;
        dispatch({
          type: 'MODEL_LOADING',
          payload: {
            progress: Math.round(overall),
            fromCache,
            file,
          },
        });
      };
      await _loadModels(onProgress);
      // Persist flag so next visit auto-loads from IndexedDB cache
      persistModelReady();
      dispatch({ type: 'MODEL_READY' });
    } catch (err) {
      const safe = sanitizeForLog(err);
      dispatch({ type: 'MODEL_ERROR', payload: `Failed to load models: ${safe}` });
    }
  }, []);

  // ── Mic lifecycle ───────────────────────────────────────────────────────────

  const micRequest = useCallback(() => dispatch({ type: 'MIC_REQUEST' }), []);
  const micGranted = useCallback(() => dispatch({ type: 'MIC_GRANTED' }), []);
  const micDenied = useCallback(() => dispatch({ type: 'MIC_DENIED' }), []);

  // ── Session lifecycle ───────────────────────────────────────────────────────

  const startListening = useCallback(() => dispatch({ type: 'START_LISTENING' }), []);
  const stopListening = useCallback(() => dispatch({ type: 'STOP_LISTENING' }), []);

  // ── Transcripts ─────────────────────────────────────────────────────────────

  const addPartialTranscript = useCallback((utterance: Utterance) => {
    dispatch({ type: 'ADD_PARTIAL_TRANSCRIPT', payload: utterance });
  }, []);
  const finalizeUtterance = useCallback((utterance: Utterance) => {
    dispatch({ type: 'FINALIZE_UTTERANCE', payload: utterance });
  }, []);
  /**
   * Clears all utterances from the in-memory transcript.
   * Nothing is written to the server — transcripts are never persisted remotely.
   */
  const clearTranscripts = useCallback(() => {
    dispatch({ type: 'CLEAR_TRANSCRIPT' });
  }, []);

  // ── Error ───────────────────────────────────────────────────────────────────

  const setError = useCallback((msg: string) => {
    dispatch({ type: 'SET_ERROR', payload: msg });
  }, []);

  // ── VAD + capture start ─────────────────────────────────────────────────────

  const _doStartCapture = useCallback(async () => {
    dispatch({ type: 'MIC_REQUEST' });
    try {
      // Initialise speaker heuristics for this session
      const speaker = createSpeakerHeuristics();
      speakerRef.current = speaker;

      // Build the VAD — callbacks close over dispatch, stateRef, and speaker
      const vad = createVAD({
        onSpeechStart: () => {
          // Could drive a "speech detected" pulse on the mic button in future
        },

        onSpeechEnd: (audio, forcedSplit) => {
          const { leftLang, rightLang } = stateRef.current;
          const utteranceId = crypto.randomUUID();

          // Assign speaker side synchronously from acoustic features
          const { side, confidence } = speaker.assign(audio);

          // Dispatch utterance immediately with the assigned speaker side.
          // sourceText is a placeholder until ASR fills it in (step 6+).
          dispatch({
            type: 'ADD_PARTIAL_TRANSCRIPT',
            payload: {
              id: utteranceId,
              timestampStart: Date.now(),
              speakerSide: side,
              sourceLang: leftLang.code,
              targetLang: rightLang.code,
              sourceText: '…',
              confidence,
              isPartial: true,
            } satisfies Utterance,
          });

          // Hand audio to the ASR + translate pipeline
          speechEndCallbackRef.current(audio, utteranceId, forcedSplit);
        },
      });

      vadRef.current = vad;

      // ── Wire ASR + translate pipeline into speechEndCallbackRef ──────────
      // Called by onSpeechEnd above for each finalised utterance.
      speechEndCallbackRef.current = async (audio, utteranceId, _forcedSplit) => {
        const { leftLang, rightLang, utterances } = stateRef.current;

        // Retrieve the partial utterance to get its speakerSide
        const partial = utterances.find((u) => u.id === utteranceId);
        const speakerSide = partial?.speakerSide ?? 'left';
        const srcLang = speakerSide === 'right' ? rightLang.code : leftLang.code;
        const tgtLang = speakerSide === 'right' ? leftLang.code : rightLang.code;

        try {
          // ── 1. ASR — transcribe with streaming partial updates ──────────
          // assertLocalOnly guards against any accidental network calls
          // during model inference (dev-mode only; zero-cost in production).
          const { text: sourceText, confidence: asrConf } = await assertLocalOnly(() =>
            transcribe(audio, srcLang, {
              onPartial: (partialText) => {
                // Update the existing partial entry with the growing transcript
                dispatch({
                  type: 'ADD_PARTIAL_TRANSCRIPT',
                  payload: {
                    id: utteranceId,
                    timestampStart: partial?.timestampStart ?? Date.now(),
                    speakerSide,
                    sourceLang: srcLang,
                    targetLang: tgtLang,
                    sourceText: partialText,
                    isPartial: true,
                  } satisfies Utterance,
                });
              },
            }),
          );

          // ── 2. Translate ─────────────────────────────────────────────────
          const translatedText = await assertLocalOnly(() =>
            translate(sourceText, srcLang, tgtLang),
          );

          // ── 3. Finalize utterance ────────────────────────────────────────
          dispatch({
            type: 'FINALIZE_UTTERANCE',
            payload: {
              id: utteranceId,
              timestampStart: partial?.timestampStart ?? Date.now(),
              timestampEnd: Date.now(),
              speakerSide,
              sourceLang: srcLang,
              targetLang: tgtLang,
              sourceText,
              translatedText,
              confidence: asrConf,
              isPartial: false,
            } satisfies Utterance,
          });
        } catch (err) {
          // sanitizeForLog strips non-ASCII to avoid leaking transcript text
          const msg = sanitizeForLog(err);
          console.error('[session] ASR/translate error:', msg);

          // Store audio so the user can retry without re-capturing
          failedAudioMapRef.current.set(utteranceId, audio);

          // Mark utterance failed — session stays alive, mic keeps recording
          dispatch({
            type: 'FAIL_UTTERANCE',
            payload: { id: utteranceId, reason: msg },
          });
        }
      };

      // Wire VAD into the PCM stream
      pcmListenerRef.current = (samples: Float32Array) => {
        vad.processChunk(samples);
      };

      const handle = await startAudioCapture({
        onPCMData: (samples) => pcmListenerRef.current(samples),
        onError: (err) => {
          dispatch({ type: 'SET_ERROR', payload: err.message });
        },
      });

      captureRef.current = handle;
      dispatch({ type: 'MIC_GRANTED' });
      dispatch({ type: 'START_LISTENING' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDenied =
        msg.toLowerCase().includes('denied') ||
        msg.toLowerCase().includes('notallowed') ||
        msg.toLowerCase().includes('permission');
      if (isDenied) {
        dispatch({ type: 'MIC_DENIED' });
      } else {
        dispatch({ type: 'SET_ERROR', payload: msg });
      }
    }
  }, []);

  const _doStopCapture = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;

    vadRef.current?.reset();
    vadRef.current = null;

    speakerRef.current?.reset();
    speakerRef.current = null;

    // Reset PCM listener and speech-end callback to no-ops
    pcmListenerRef.current = () => undefined;
    speechEndCallbackRef.current = () => undefined;

    dispatch({ type: 'STOP_LISTENING' });
  }, []);

  // ── Mic retry ───────────────────────────────────────────────────────────────

  /**
   * Resets mic + session state and re-requests microphone access.
   * Called by the "Try again" button shown after mic denial.
   */
  const retryMic = useCallback(() => {
    dispatch({ type: 'MIC_RETRY' });
    void _doStartCapture();
  }, [_doStartCapture]);

  // ── Utterance retry ─────────────────────────────────────────────────────────

  /**
   * Re-runs the ASR + translation pipeline for a previously failed utterance.
   * The original PCM audio is retrieved from failedAudioMapRef.
   * If audio is no longer available, the utterance remains failed.
   */
  const retryUtterance = useCallback(
    async (utteranceId: string) => {
      const audio = failedAudioMapRef.current.get(utteranceId);
      if (!audio) {
        console.warn('[session] retryUtterance: no cached audio for', utteranceId);
        return;
      }
      failedAudioMapRef.current.delete(utteranceId);

      const { leftLang, rightLang, utterances } = stateRef.current;
      const existing = utterances.find((u) => u.id === utteranceId);
      const speakerSide = existing?.speakerSide ?? 'left';
      const srcLang = speakerSide === 'right' ? rightLang.code : leftLang.code;
      const tgtLang = speakerSide === 'right' ? leftLang.code : rightLang.code;

      // Reset to partial state so the pane shows progress
      dispatch({ type: 'RETRY_UTTERANCE', payload: { id: utteranceId } });

      try {
        const { text: sourceText, confidence: asrConf } = await assertLocalOnly(() =>
          transcribe(audio, srcLang, {
            onPartial: (partialText) => {
              dispatch({
                type: 'ADD_PARTIAL_TRANSCRIPT',
                payload: {
                  id: utteranceId,
                  timestampStart: existing?.timestampStart ?? Date.now(),
                  speakerSide,
                  sourceLang: srcLang,
                  targetLang: tgtLang,
                  sourceText: partialText,
                  isPartial: true,
                } satisfies Utterance,
              });
            },
          }),
        );

        const translatedText = await assertLocalOnly(() =>
          translate(sourceText, srcLang, tgtLang),
        );

        dispatch({
          type: 'FINALIZE_UTTERANCE',
          payload: {
            id: utteranceId,
            timestampStart: existing?.timestampStart ?? Date.now(),
            timestampEnd: Date.now(),
            speakerSide,
            sourceLang: srcLang,
            targetLang: tgtLang,
            sourceText,
            translatedText,
            confidence: asrConf,
            isPartial: false,
          } satisfies Utterance,
        });
      } catch (err) {
        const msg = sanitizeForLog(err);
        console.error('[session] retry ASR/translate error:', msg);
        // Put audio back so user can try again
        failedAudioMapRef.current.set(utteranceId, audio);
        dispatch({ type: 'FAIL_UTTERANCE', payload: { id: utteranceId, reason: msg } });
      }
    },
    [],
  );

  // ── High-level toggle ───────────────────────────────────────────────────────

  const toggleSession = useCallback(() => {
    const { sessionStatus, modelStatus } = state;
    if (modelStatus !== 'ready') return;
    if (sessionStatus === 'listening' || sessionStatus === 'processing') {
      _doStopCapture();
    } else if (sessionStatus === 'idle') {
      void _doStartCapture();
    }
  }, [state, _doStartCapture, _doStopCapture]);

  return {
    state,
    dispatch,
    /**
     * Register a callback to receive finalized utterance audio from the VAD.
     * ASR (step 5) sets `speechEndCallbackRef.current` to its handler.
     */
    speechEndCallbackRef,
    /** Raw PCM listener — exposed for testing / future pipeline stages. */
    pcmListenerRef,
    // Language
    setLang,
    // Model
    modelLoading,
    modelReady,
    modelError,
    downloadModel,
    // Mic
    micRequest,
    micGranted,
    micDenied,
    // Session
    startListening,
    stopListening,
    // Transcripts
    addPartialTranscript,
    finalizeUtterance,
    clearTranscripts,
    // Error
    setError,
    // Convenience
    toggleSession,
    retryMic,
    retryUtterance,
  };
}
