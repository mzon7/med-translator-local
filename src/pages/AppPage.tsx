import { useState } from 'react';
import { useTranslatorSession } from '../features/translation-feature/lib/useTranslatorSession';
import { usePitchCopy } from '../features/voice-pitch-copy/lib/usePitchCopy';
import { LanguagePicker } from '../features/translation-feature/components/LanguagePicker';
import { BigMicButton } from '../features/translation-feature/components/BigMicButton';
import { TranscriptPane } from '../features/translation-feature/components/TranscriptPane';
import { StatusBar } from '../features/translation-feature/components/StatusBar';
import { SettingsSheet } from '../features/translation-feature/components/SettingsSheet';

export default function AppPage() {
  const { state, setLang, toggleSession, downloadModel, retryMic, retryUtterance, clearTranscripts } =
    useTranslatorSession();

  const { enabled: voicePitchEnabled, toggle: toggleVoicePitch } = usePitchCopy();

  const [settingsOpen, setSettingsOpen] = useState(false);

  const sessionActive =
    state.sessionStatus === 'listening' || state.sessionStatus === 'processing';

  return (
    <div className="min-h-screen bg-black flex flex-col overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-[#d5d728]/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#d5d728]/4 blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 pt-6 pb-2">
        <div className="flex items-center gap-2">
          <svg
            className="w-6 h-6 text-[#d5d728]"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
            />
          </svg>
          <span className="text-white font-semibold text-sm tracking-wide">
            Med Translator
          </span>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="text-white/20 hover:text-white/50 transition-colors"
          aria-label="Open settings"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
          </svg>
        </button>
      </header>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        hasTranscripts={state.utterances.length > 0}
        onClearTranscripts={clearTranscripts}
        voicePitchEnabled={voicePitchEnabled}
        onToggleVoicePitch={toggleVoicePitch}
      />

      {/* Language pickers */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-4 pb-2 gap-4">
        <LanguagePicker
          side="left"
          value={state.leftLang}
          onChange={(lang) => setLang('left', lang)}
          disabled={sessionActive}
        />
        <div className="text-white/20">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"
            />
          </svg>
        </div>
        <LanguagePicker
          side="right"
          value={state.rightLang}
          onChange={(lang) => setLang('right', lang)}
          disabled={sessionActive}
        />
      </div>

      {/* Status bar */}
      <div className="relative z-10 px-6">
        <StatusBar
          sessionStatus={state.sessionStatus}
          micStatus={state.micStatus}
          modelStatus={state.modelStatus}
          error={state.error}
        />
      </div>

      {/* Mic permission denied — inline recovery panel */}
      {state.micStatus === 'denied' && (
        <div className="relative z-10 mx-4 mt-1 mb-2 px-4 py-3 rounded-xl bg-red-500/[0.06] border border-red-500/20 space-y-2">
          <div className="flex items-start gap-3">
            <svg
              className="w-4 h-4 text-red-400 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-red-400">Microphone access denied</p>
              <p className="text-[10px] text-white/30 mt-1 leading-relaxed">
                Allow microphone access in your browser settings, then tap "Try again" below.
                In Chrome: click the camera/mic icon in the address bar → Allow.
              </p>
            </div>
          </div>
          <button
            onClick={retryMic}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#d5d728] hover:text-[#d5d728]/80 transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Try again
          </button>
        </div>
      )}

      {/* Model download panel — shown only when model is not yet loaded */}
      {(state.modelStatus === 'unloaded' || state.modelStatus === 'error') && (
        <div className="relative z-10 mx-4 mt-1 mb-2 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white/60">
                Local AI Model Required
              </p>
              <p className="text-[10px] text-white/25 mt-0.5">
                Whisper (ASR) + NLLB-200 (translation) · ~640 MB · cached offline after first download
              </p>
            </div>
            <button
              onClick={() => void downloadModel()}
              className={[
                'shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold',
                'border transition-all duration-200',
                state.modelStatus === 'error'
                  ? 'border-red-500/50 text-red-400 hover:bg-red-500/10'
                  : 'border-[#d5d728]/60 text-[#d5d728] hover:bg-[#d5d728]/10 active:scale-95',
              ].join(' ')}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {state.modelStatus === 'error' ? 'Retry' : 'Download Model'}
            </button>
          </div>
          {/* Troubleshooting tips shown only after a load failure */}
          {state.modelStatus === 'error' && (
            <div className="pt-1 border-t border-white/5 space-y-1">
              <p className="text-[10px] font-medium text-red-400/70">Troubleshooting</p>
              <ul className="text-[10px] text-white/25 space-y-0.5 list-disc list-inside leading-relaxed">
                <li>
                  <span className="font-medium text-white/40">WebGPU required</span> — use Chrome 113+ or Edge 113+ on a supported device
                </li>
                <li>Close other tabs and GPU-heavy apps to free memory (~1 GB needed)</li>
                <li>Reload the page and try again; the download resumes from cache</li>
                <li>On mobile, WebGPU may not be available — use a desktop browser</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Model loading progress bar */}
      {state.modelStatus === 'loading' && (
        <div className="relative z-10 mx-4 mt-1 mb-2 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-white/40 uppercase tracking-widest">
              {state.modelFromCache === true ? 'Loading from cache' : 'Downloading model'}
            </span>
            <span className="text-[10px] text-[#d5d728]/60 font-mono">
              {state.modelProgress}%
            </span>
          </div>
          <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
            <div
              className={[
                'h-full rounded-full transition-all duration-500',
                state.modelFromCache === true ? 'bg-white/40' : 'bg-[#d5d728]',
              ].join(' ')}
              style={{ width: `${state.modelProgress}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-white/20 truncate">
              {state.modelCurrentFile
                ? state.modelCurrentFile.split('/').pop()
                : state.modelProgress < 50
                  ? state.modelFromCache === true
                    ? 'Reading ASR model (Whisper) from cache…'
                    : 'Downloading ASR model (Whisper)…'
                  : state.modelFromCache === true
                    ? 'Reading translation model (NLLB-200) from cache…'
                    : 'Downloading translation model (NLLB-200)…'}
            </p>
            {state.modelFromCache === true && (
              <span className="shrink-0 text-[9px] text-white/20 bg-white/5 px-1.5 py-0.5 rounded">
                cached
              </span>
            )}
          </div>
        </div>
      )}

      {/* Transcript panes */}
      <div className="relative z-10 flex-1 grid grid-cols-2 gap-3 px-4 pb-4 min-h-0 mt-2">
        <TranscriptPane
          side="left"
          language={state.leftLang}
          utterances={state.utterances}
          onRetryUtterance={(id) => void retryUtterance(id)}
        />
        <TranscriptPane
          side="right"
          language={state.rightLang}
          utterances={state.utterances}
          onRetryUtterance={(id) => void retryUtterance(id)}
        />
      </div>

      {/* Big mic button */}
      <div className="relative z-10 flex justify-center pb-8 pt-4">
        <BigMicButton
          sessionStatus={state.sessionStatus}
          micStatus={state.micStatus}
          modelStatus={state.modelStatus}
          modelProgress={state.modelProgress}
          onToggle={toggleSession}
        />
      </div>
    </div>
  );
}
