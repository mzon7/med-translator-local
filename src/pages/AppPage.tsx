import { useTranslatorSession } from '../features/translation-feature/lib/useTranslatorSession';
import { LanguagePicker } from '../features/translation-feature/components/LanguagePicker';
import { BigMicButton } from '../features/translation-feature/components/BigMicButton';
import { TranscriptPane } from '../features/translation-feature/components/TranscriptPane';
import { StatusBar } from '../features/translation-feature/components/StatusBar';

export default function AppPage() {
  const { state, setLang, toggleSession, downloadModel } = useTranslatorSession();

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
        <span className="text-[10px] text-white/20 uppercase tracking-widest font-mono">
          Local · Private
        </span>
      </header>

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

      {/* Model download panel — shown only when model is not yet loaded */}
      {(state.modelStatus === 'unloaded' || state.modelStatus === 'error') && (
        <div className="relative z-10 mx-4 mt-1 mb-2 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-4">
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
            disabled={state.modelStatus === 'loading'}
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
      )}

      {/* Model loading progress bar */}
      {state.modelStatus === 'loading' && (
        <div className="relative z-10 mx-4 mt-1 mb-2 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-white/40 uppercase tracking-widest">
              Downloading model
            </span>
            <span className="text-[10px] text-[#d5d728]/60 font-mono">
              {state.modelProgress}%
            </span>
          </div>
          <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#d5d728] rounded-full transition-all duration-500"
              style={{ width: `${state.modelProgress}%` }}
            />
          </div>
          <p className="text-[10px] text-white/20">
            {state.modelProgress < 50
              ? 'Downloading ASR model (Whisper)…'
              : 'Downloading translation model (NLLB-200)…'}
          </p>
        </div>
      )}

      {/* Transcript panes */}
      <div className="relative z-10 flex-1 grid grid-cols-2 gap-3 px-4 pb-4 min-h-0 mt-2">
        <TranscriptPane
          side="left"
          language={state.leftLang}
          utterances={state.utterances}
        />
        <TranscriptPane
          side="right"
          language={state.rightLang}
          utterances={state.utterances}
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
