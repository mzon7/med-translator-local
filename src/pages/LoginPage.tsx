import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@mzon7/zon-incubator-sdk/auth";

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await signIn(email, password);
    setLoading(false);
    if (err) {
      setError(err);
    } else {
      navigate("/app", { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-[#d5d728]/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#d5d728]/4 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm space-y-8">
        {/* Logo + name */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <svg
              className="w-7 h-7 text-[#d5d728]"
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
            <span className="text-white font-semibold text-base tracking-wide">
              Med Translator
            </span>
          </div>
          <p className="text-white/30 text-xs">On-device medical translation</p>
        </div>

        {/* Card */}
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-8 space-y-6">
          <h1 className="text-lg font-semibold text-white text-center">Sign in</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-xs font-medium text-white/50">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-[#d5d728]/50 focus:outline-none focus:ring-1 focus:ring-[#d5d728]/30"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-xs font-medium text-white/50">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:border-[#d5d728]/50 focus:outline-none focus:ring-1 focus:ring-[#d5d728]/30"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#d5d728] px-4 py-2.5 text-sm font-semibold text-black hover:bg-[#d5d728]/90 active:scale-[0.98] transition-all focus:outline-none focus:ring-2 focus:ring-[#d5d728]/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="text-center text-xs text-white/30">
            Don't have an account?{" "}
            <Link to="/signup" className="text-[#d5d728]/80 hover:text-[#d5d728] font-medium transition-colors">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
