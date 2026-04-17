import type { SessionState, ModelStatus } from '../../../lib/types';

interface BigMicButtonProps {
  session: SessionState;
  modelStatus: ModelStatus;
  modelProgress: number;
  onToggle: () => void;
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`w-10 h-10 transition-colors duration-300 ${active ? 'text-black' : 'text-white'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 10v2a7 7 0 0 1-14 0v-2"
      />
      <line x1="12" y1="19" x2="12" y2="23" strokeLinecap="round" />
      <line x1="8" y1="23" x2="16" y2="23" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      className="w-9 h-9 text-black"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="w-10 h-10 text-black animate-spin"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export function BigMicButton({
  session,
  modelStatus,
  modelProgress,
  onToggle,
}: BigMicButtonProps) {
  const isActive = session === 'listening' || session === 'processing';
  const isLoading = session === 'requestingMic' || session === 'processing';
  const isModelLoading = modelStatus === 'loading';
  const isDisabled =
    session === 'unsupported' ||
    session === 'error' ||
    modelStatus === 'error' ||
    isModelLoading;

  const label = (() => {
    if (modelStatus === 'unloaded') return 'Model not loaded';
    if (modelStatus === 'loading') return `Loading model… ${modelProgress}%`;
    if (modelStatus === 'error') return 'Model error';
    switch (session) {
      case 'idle': return 'Tap to start';
      case 'requestingMic': return 'Requesting mic…';
      case 'listening': return 'Listening…';
      case 'processing': return 'Translating…';
      case 'error': return 'Error — tap to retry';
      case 'unsupported': return 'Device not supported';
      default: return '';
    }
  })();

  // Ring pulse animation when listening
  const ringClass = session === 'listening'
    ? 'animate-ping absolute inset-0 rounded-full bg-[#d5d728] opacity-20'
    : '';

  // Button fill
  const buttonBg = isActive
    ? 'bg-[#d5d728]'
    : isDisabled
    ? 'bg-white/5'
    : 'bg-white/10 hover:bg-white/15';

  const borderClass = isActive
    ? 'border-[#d5d728]'
    : isDisabled
    ? 'border-white/10'
    : 'border-white/20 hover:border-[#d5d728]/60';

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Model loading bar */}
      {isModelLoading && (
        <div className="w-40 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-[#d5d728] rounded-full transition-all duration-300"
            style={{ width: `${modelProgress}%` }}
          />
        </div>
      )}

      {/* Outer ring + button */}
      <div className="relative flex items-center justify-center">
        {session === 'listening' && (
          <span className={ringClass} />
        )}

        <button
          onClick={!isDisabled ? onToggle : undefined}
          disabled={isDisabled}
          aria-label={label}
          className={[
            'relative w-28 h-28 rounded-full border-2 flex items-center justify-center',
            'transition-all duration-300',
            'shadow-lg',
            buttonBg,
            borderClass,
            isActive ? 'shadow-[#d5d728]/30 shadow-xl scale-105' : '',
            isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer active:scale-95',
          ].join(' ')}
        >
          {isLoading ? (
            <SpinnerIcon />
          ) : isActive ? (
            <StopIcon />
          ) : (
            <MicIcon active={false} />
          )}
        </button>
      </div>

      {/* State label */}
      <p className={[
        'text-sm font-medium tracking-wide transition-colors duration-300',
        session === 'error' || modelStatus === 'error' ? 'text-red-400' : 'text-white/50',
        session === 'listening' ? 'text-[#d5d728]' : '',
      ].join(' ')}>
        {label}
      </p>
    </div>
  );
}
