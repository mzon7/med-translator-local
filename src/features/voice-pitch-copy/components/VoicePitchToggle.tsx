/**
 * VoicePitchToggle — Settings toggle for the Voice Pitch Copy feature.
 *
 * When enabled, translated text is spoken aloud via TTS with the pitch
 * adjusted to match the detected voice of the original speaker.
 */

interface VoicePitchToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

export function VoicePitchToggle({ enabled, onToggle }: VoicePitchToggleProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Speaker-wave icon */}
        <svg
          className={`w-4 h-4 shrink-0 transition-colors duration-150 ${
            enabled ? 'text-[#d5d728]' : 'text-white/30'
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
          />
        </svg>
        <div className="min-w-0">
          <p className="text-xs font-medium text-white/70">Voice Pitch Copy</p>
          <p className="text-[10px] text-white/25 leading-relaxed">
            Read translation in the speaker's voice pitch
          </p>
        </div>
      </div>

      {/* Toggle pill */}
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle voice pitch copy"
        className={[
          'relative shrink-0 inline-flex h-5 w-9 cursor-pointer rounded-full border-2 border-transparent',
          'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d5d728]/50',
          enabled ? 'bg-[#d5d728]' : 'bg-white/10',
        ].join(' ')}
      >
        <span
          className={[
            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow-lg',
            'transition-transform duration-200 ease-in-out',
            enabled ? 'translate-x-4' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  );
}
