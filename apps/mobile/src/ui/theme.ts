/**
 * LastMeter design tokens (README_NEW.md §12): deep forest green for actions, warm mustard for the
 * home/route header, orange for urgency and conflicts, white rounded cards on a soft grey canvas.
 * Same token *names* as before so every screen that already calls `useTheme()` picks this up for free.
 */
export const brand = {
  primary: '#66FF00',
  primaryPressed: '#52CC00',
  primarySoftColor: '#EAFFD9',
  sun: '#F5B83D',
  sunSoft: '#FFF3DA',
  accent: '#E5484D',
  accentSoft: '#FDECEC',
  canvas: '#F5F5F2',
  surface: '#FFFFFF',
  dark: '#0D0D0D',
  textMuted: 'rgba(13,13,13,0.55)',
  textFaint: 'rgba(13,13,13,0.35)',
  border: 'rgba(13,13,13,0.07)',
  borderStrong: 'rgba(13,13,13,0.14)',
  pickupPin: '#0D0D0D',
  supersededBg: '#EFEFEC',
  unverifiedText: '#9A6700',
  /** Generic UI primitives (kit.tsx) want a slightly darker accent for selection/loading states, and a mid-tone neutral for switch tracks. */
  accentDark: '#3FA300',
  mist: '#E2E2DE',
  surfaceAlt: '#F3F3F0',
} as const;

/** Semantic status colours (low / medium / high risk) — used by generic Chip tones. */
export const status = {
  low: { fg: '#138A4A', bg: '#E6F6EC' },
  medium: { fg: brand.unverifiedText, bg: brand.sunSoft },
  high: { fg: '#D1343A', bg: brand.accentSoft },
} as const;

const theme = {
  ...brand,
  bg: brand.canvas,
  card: brand.surface,
  text: brand.dark,
  sub: brand.textMuted,
  faint: brand.textFaint,
  primary: brand.primary,
  onPrimary: brand.dark,
  primarySoft: brand.primarySoftColor,
  onPrimarySoft: brand.dark,
  link: brand.dark,
  good: status.low.fg,
  goodSoft: status.low.bg,
  warn: status.medium.fg,
  warnSoft: status.medium.bg,
  bad: status.high.fg,
  badSoft: status.high.bg,
  input: '#F3F3F0',
  overlay: 'rgba(10,10,16,0.55)',
  /** Urgency / conflict accent — orange, distinct from the green primary. */
  highlight: brand.accent,
  highlightSoft: brand.accentSoft,
};

export type Theme = typeof theme;

/** The app is light-only: the brand palette is defined for the canvas theme. */
export function useTheme(): Theme {
  return theme;
}

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
export const radius = { s: 10, m: 16, l: 24, xl: 32, pill: 999, sharp: 0 } as const;

export const glow = {
  shadowColor: brand.primary,
  shadowOpacity: 0.3,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 5,
} as const;

export const cardShadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const;

export const raisedShadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.12,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 6,
} as const;

export const gradient = [brand.primary, brand.primaryPressed] as const;

/** One accent per surviving top-level domain. Route stays plain primary as the default "home" surface. */
export const DOMAIN_COLORS = {
  memory: brand.pickupPin,
} as const;

/** The core LastMeter visual: a fact's trust state as a badge. */
export const statusStyle = {
  verified: { bg: brand.primarySoftColor, fg: brand.primary, label: 'Verified' },
  unverified: { bg: brand.sunSoft, fg: brand.unverifiedText, label: 'Unverified' },
  superseded: { bg: brand.supersededBg, fg: brand.textMuted, label: 'Replaced' },
  conflict: { bg: brand.accentSoft, fg: brand.accent, label: 'Conflict' },
} as const;
