// Nova — this app's original AI-assistant avatar, introduced in the
// sleek/futuristic visual redesign (2026-09-01): a glowing orb with a
// minimal expressive "face," built entirely from CSS (no image asset, no
// new dependency). Explicitly an original design — not a recreation of any
// existing character.
//
// The gradient/glow this renders can't be expressed as a single flat
// Tailwind color utility, so the three hex values below are inline styles
// rather than classes — they deliberately mirror two already-audited
// tokens from tailwind.config.ts (`ai-accent.dark` for the core,
// `nova.dark` for the outer glow) rather than inventing new colors, so
// keep them in sync if either token ever changes. The avatar always
// renders in its dark-tuned colors regardless of light/dark mode — a
// decorative glow reads fine on either background, and the app defaults to
// dark now (see layout.tsx), so this isn't a real light-mode regression.
const NOVA_CORE = '#9B87FF'; // == tailwind.config.ts colors.ai-accent.dark
const NOVA_GLOW = '#5FE1DB'; // == tailwind.config.ts colors.nova.dark

export function NovaAvatar({
  size = 36,
  state = 'idle',
  className = '',
}: {
  /** Diameter in px. */
  size?: number;
  /** `speaking` spins faster and pulses the "face" quicker — for a moment
   * tied to an actual voice notification or a live Chat response; `idle`
   * (default) is the resting state used everywhere else. */
  state?: 'idle' | 'speaking';
  className?: string;
}) {
  const eyeWidth = Math.max(4, Math.round(size * 0.16));
  const eyeHeight = Math.max(2, Math.round(size * 0.05));

  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 rounded-full ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Rotating outer ring */}
      <span
        className={`absolute rounded-full border ${
          state === 'speaking' ? 'animate-[spin_6s_linear_infinite]' : 'animate-[spin_14s_linear_infinite]'
        }`}
        style={{ inset: -Math.round(size * 0.14), borderColor: `${NOVA_CORE}66` }}
      />
      {/* Glowing core */}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 35% 30%, #ffffff, ${NOVA_CORE} 46%, transparent 74%)`,
          boxShadow: `0 0 ${Math.round(size * 0.55)}px ${Math.round(size * 0.04)}px ${NOVA_GLOW}55`,
        }}
      />
      {/* Minimal "face" — two soft bars standing in for eyes */}
      <span
        className={`absolute rounded-full bg-white ${state === 'speaking' ? 'animate-[pulse_0.9s_ease-in-out_infinite]' : 'animate-pulse'}`}
        style={{ left: '30%', top: '46%', width: eyeWidth, height: eyeHeight }}
      />
      <span
        className={`absolute rounded-full bg-white ${state === 'speaking' ? 'animate-[pulse_0.9s_ease-in-out_infinite]' : 'animate-pulse'}`}
        style={{ right: '30%', top: '46%', width: eyeWidth, height: eyeHeight }}
      />
    </span>
  );
}
