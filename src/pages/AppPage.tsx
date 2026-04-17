import { useTranslatorSession } from '../features/translation-feature/lib/useTranslatorSession';
import { LanguagePicker } from '../features/translation-feature/components/LanguagePicker';
import { BigMicButton } from '../features/translation-feature/components/BigMicButton';
import { TranscriptPane } from '../features/translation-feature/components/TranscriptPane';
import { StatusBar } from '../features/translation-feature/components/StatusBar';

export default function AppPage() {
  const {
    state,
    setLeftLanguage,
    setRightLanguage,
    toggleSession,
  } = useTranslatorSession();

  const sessionActive =
    state.session === 'listening' || state.session === 'processing';

  return (
    <div className="min-h-screen bg-black flex flex-col overflow-hidden">
      {/* Ambient glow background */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden="true"
      >
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-[#d5d728]/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#d5d728]/4 blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 pt-6 pb-2">
        <div className="flex items-center gap-2">
          {/* Logo mark */}
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

      {/* Language pickers row */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-4 pb-2 gap-4">
        <LanguagePicker
          side="left"
          value={state.leftLanguage}
          onChange={setLeftLanguage}
          disabled={sessionActive}
        />
        {/* Arrow icon between pickers */}
        <div className="flex items-center gap-1 text-white/20">
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
          value={state.rightLanguage}
          onChange={setRightLanguage}
          disabled={sessionActive}
        />
      </div>

      {/* Status bar */}
      <div className="relative z-10 px-6">
        <StatusBar
          session={state.session}
          modelStatus={state.modelStatus}
          error={state.error}
        />
      </div>

      {/* Transcript panes */}
      <div className="relative z-10 flex-1 grid grid-cols-2 gap-3 px-4 pb-4 min-h-0 mt-2">
        <TranscriptPane
          side="left"
          language={state.leftLanguage}
          entries={state.transcripts}
        />
        <TranscriptPane
          side="right"
          language={state.rightLanguage}
          entries={state.transcripts}
        />
      </div>

      {/* Big mic button — fixed at bottom center */}
      <div className="relative z-10 flex justify-center pb-8 pt-4">
        <BigMicButton
          session={state.session}
          modelStatus={state.modelStatus}
          modelProgress={state.modelProgress}
          onToggle={toggleSession}
        />
      </div>
    </div>
  );
}
