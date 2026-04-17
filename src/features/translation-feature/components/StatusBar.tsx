import type { SessionState, ModelStatus } from '../../../lib/types';

interface StatusBarProps {
  session: SessionState;
  modelStatus: ModelStatus;
  error: string | null;
}

export function StatusBar({ session, modelStatus, error }: StatusBarProps) {
  const isError = session === 'error' || modelStatus === 'error';
  const isListening = session === 'listening';
  const isProcessing = session === 'processing';

  const dotColor = (() => {
    if (isError) return 'bg-red-500';
    if (isListening) return 'bg-[#d5d728] animate-pulse';
    if (isProcessing) return 'bg-blue-400 animate-pulse';
    if (session === 'requestingMic') return 'bg-yellow-400 animate-pulse';
    return 'bg-white/20';
  })();

  const statusText = (() => {
    if (error) return error;
    if (modelStatus === 'unloaded') return 'Model not loaded — download to begin';
    if (modelStatus === 'loading') return 'Loading model…';
    if (modelStatus === 'error') return 'Model failed to load';
    switch (session) {
      case 'idle': return 'Ready';
      case 'requestingMic': return 'Requesting microphone access…';
      case 'listening': return 'Listening — speak now';
      case 'processing': return 'Translating…';
      case 'error': return 'An error occurred';
      case 'unsupported': return 'This device does not support WebGPU';
      default: return '';
    }
  })();

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
      <span
        className={`text-xs tracking-wide ${isError ? 'text-red-400' : 'text-white/30'}`}
      >
        {statusText}
      </span>
    </div>
  );
}
