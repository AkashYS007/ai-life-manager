import type { Config } from 'tailwindcss';

// Color/spacing/radius tokens transcribed 1:1 from the UI/UX Design
// Document §3.1–3.3, so this file is the single source of truth Tailwind
// consumes — no design token should ever be hand-typed as a raw hex value
// in a component.
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: { DEFAULT: '#FFFFFF', dark: '#0B0B12' },
        surface: { DEFAULT: '#F7F7F9', dark: '#15151F' },
        // Accessibility (WCAG AA) pass: darkened from the original
        // #E5E5EA/#26262F — those failed WCAG 1.4.11's 3:1 non-text
        // contrast minimum against their own backgrounds (measured at
        // 1.26:1 / 1.31:1), which made every input, card, and button
        // boundary in the app effectively invisible to anyone relying on
        // that edge to tell where a control starts and stops. These two
        // values were computed (see the accessibility increment's own
        // notes) to clear 3:1 against both `background`/`surface` (light)
        // and `background-dark`/`surface-dark` (dark) with real margin,
        // while keeping the same cool, slightly-blue-tinted hairline
        // character the original values had — a real, visible change
        // (borders are noticeably more visible now), not just a token
        // number.
        border: { DEFAULT: '#8C8C99', dark: '#6A6A7A' },
        'text-primary': { DEFAULT: '#1A1A2E', dark: '#F5F5F7' },
        'text-secondary': { DEFAULT: '#6B6B76', dark: '#9797A6' },
        accent: { DEFAULT: '#4C4CFF', dark: '#6E6EFF' },
        // Accessibility (WCAG AA) pass: darkened from the original
        // #7C5CFC, which measured 4.38:1 on `background` and 4.09:1 on
        // `surface` — under the 4.5:1 WCAG AA minimum for normal-weight
        // text, which is exactly how this color is used everywhere in the
        // app (goal-title text, tag labels, small AI-related links, all at
        // text-xs/text-sm). #5E3FD0 clears 4.5:1 against both with real
        // margin (6.78:1 / 6.34:1) while staying recognizably the same
        // violet. The dark-mode value (#9B87FF) already passed comfortably
        // (6.82:1 / 6.30:1) and is unchanged.
        'ai-accent': { DEFAULT: '#5E3FD0', dark: '#9B87FF' },
        success: '#16A34A',
        warning: '#D97706',
        // Accessibility (WCAG AA) pass: danger previously had no separate
        // dark-mode value at all — every `text-danger` usage in the app
        // (error messages, the "Urgent" task badge, delete-action hover
        // states) rendered the same #DC2626 in dark mode as in light mode.
        // That passes fine against light backgrounds (4.83:1 on
        // `background`, 4.51:1 on `surface`) but fails against dark ones
        // (4.06:1 on `background-dark`, 3.75:1 on `surface-dark` — both
        // under the 4.5:1 AA minimum). Added a real dark-mode value,
        // matching the `{ DEFAULT, dark }` shape every other semantic color
        // in this file already uses; every `text-danger` (and
        // `hover:text-danger`) usage in the app was updated alongside to
        // pair it with `dark:text-danger-dark` (see individual component
        // diffs) — #F87171 clears 4.5:1 against both dark backgrounds with
        // real margin (7.09:1 / 6.55:1).
        danger: { DEFAULT: '#DC2626', dark: '#F87171' },
        // Sleek/futuristic visual redesign (2026-09-01): a second accent
        // used for glow accents and gradients — Nova (the AI-assistant
        // avatar, see NovaAvatar.tsx), the Today greeting's gradient
        // headline, and the AI plan card's CTA glow. Kept separate from
        // `accent`/`ai-accent` (both already carefully contrast-tuned above)
        // rather than reusing or mutating either — this token is only ever
        // used decoratively (glows, gradient stops), never for body text, so
        // it doesn't carry the same WCAG text-contrast obligation the others
        // do.
        nova: { DEFAULT: '#0E9488', dark: '#5FE1DB' },
      },
      borderRadius: {
        control: '8px',
        card: '12px',
        sheet: '20px',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'sans-serif'],
        // Sleek/futuristic visual redesign: a distinct display face for
        // headline moments only (Today's greeting) — body copy everywhere
        // else stays on the existing `sans` (Inter) so this is additive,
        // not a font swap across the app.
        display: ['var(--font-display)', 'sans-serif'],
      },
      transitionDuration: {
        micro: '120ms',
        standard: '200ms',
        entrance: '320ms',
      },
    },
  },
  plugins: [],
};

export default config;
