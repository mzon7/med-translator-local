import { useReducer, useCallback, useEffect, useRef } from 'react';
import type {
  TranslatorSessionState,
  TranslatorAction,
  Language,
  Utterance,
} from '../../../lib/types';
import { loadPersistedLanguages, persistLanguage } from './languages';
import {
  startAudioCapture,
  type AudioCaptureHandle,
  type AudioCaptureCallbacks,
} from './audioCapture';
import { createVAD, type VadHandle } from './vad';

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
        error: null,
      };
    case 'MODEL_READY':
      return { ...state, modelStatus: 'ready', modelProgress: 100, error: null };
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

    case 'SET_ERROR':
      return { ...state, sessionStatus: 'error', error: action.payload };

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

  // Clean up on unmount
  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      captureRef.current = null;
      vadRef.current?.reset();
      vadRef.current = null;
      pcmListenerRef.current = () => undefined;
    };
  }, []);

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

  // ── Error ───────────────────────────────────────────────────────────────────

  const setError = useCallback((msg: string) => {
    dispatch({ type: 'SET_ERROR', payload: msg });
  }, []);

  // ── VAD + capture start ─────────────────────────────────────────────────────

  const _doStartCapture = useCallback(async () => {
    dispatch({ type: 'MIC_REQUEST' });
    try {
      // Build the VAD — callbacks close over dispatch and stateRef
      const vad = createVAD({
        onSpeechStart: () => {
          // Optional: could update UI to show "speech detected" indicator
        },

        onSpeechEnd: (audio, forcedSplit) => {
          const { leftLang, rightLang } = stateRef.current;
          const utteranceId = crypto.randomUUID();

          // Show a placeholder partial utterance immediately in the transcript
          // (speaker side will be assigned by speakerHeuristics in step 5;
          //  sourceText will be replaced by ASR output)
          dispatch({
            type: 'ADD_PARTIAL_TRANSCRIPT',
            payload: {
              id: utteranceId,
              timestampStart: Date.now(),
              speakerSide: 'unknown',
              sourceLang: leftLang.code,
              targetLang: rightLang.code,
              sourceText: '…',
              isPartial: true,
            } satisfies Utterance,
          });

          // Hand audio to the ASR pipeline (step 5 wires this ref)
          speechEndCallbackRef.current(audio, utteranceId, forcedSplit);
        },
      });

      vadRef.current = vad;

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

    // Reset PCM listener to no-op
    pcmListenerRef.current = () => undefined;

    dispatch({ type: 'STOP_LISTENING' });
  }, []);

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
    // Error
    setError,
    // Convenience
    toggleSession,
  };
}
