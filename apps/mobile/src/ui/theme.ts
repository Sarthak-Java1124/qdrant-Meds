/**
 * Warm peach-and-espresso design tokens (type/ui onboarding reference): espresso-brown for text, dark surfaces
 * and the pill call to action, a soft peach primary for selection, sage as the secondary pastel, white rounded
 * cards on a cream canvas, and a peach wash at the top of every screen. Token *names* are unchanged from the
 * earlier sky-blue palette (`sky`, `mint`, `pink` now hold peach, sage and blush) so every screen that calls
 * `useTheme()` picks this up for free.
 */
export const pastel = {
  sky: '#F4C7A8',
  skySoft: '#FDEBDD',
  mint: '#BBD6CD',
  mintSoft: '#E4EFEA',
  pink: '#EBD3C4',
  pinkSoft: '#F9E6DA',
} as const;

export const brand = {
  primary: '#F2B48D',
  primaryPressed: '#E89E70',
  primarySoftColor: '#FDEBDD',
  sun: '#F5C26B',
  sunSoft: '#FFF1D6',
  accent: '#C8402F',
  accentSoft: '#FBDAD5',
  canvas: '#FBF7F3',
  surface: '#FFFFFF',
  dark: '#2B1208',
  /** Raised element on a dark surface (dark chips, the family phone bezel). */
  darkRaised: '#4A2A1B',
  textMuted: 'rgba(43,18,8,0.62)',
  textFaint: 'rgba(43,18,8,0.38)',
  border: 'rgba(43,18,8,0.07)',
  borderStrong: 'rgba(43,18,8,0.14)',
  pickupPin: '#2B1208',
  supersededBg: '#F1E9E1',
  unverifiedText: '#9A6700',
  /** Generic UI primitives (kit.tsx) want a slightly darker accent for selection/loading states, and a mid-tone neutral for switch tracks. */
  accentDark: '#B8683A',
  mist: '#EADFD5',
  surfaceAlt: '#F6EDE4',
  /** Top of the peach wash behind every screen; headers use it as their background so the two meet seamlessly. */
  wash: '#F9D5BC',
} as const;

/** Semantic status colours (low / medium / high risk) — used by generic Chip tones. */
export const status = {
  low: { fg: '#2F7A5A', bg: '#E4EFEA' },
  medium: { fg: brand.unverifiedText, bg: brand.sunSoft },
  high: { fg: '#B3261E', bg: brand.accentSoft },
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
  input: brand.surfaceAlt,
  overlay: 'rgba(43,18,8,0.5)',
  /** Urgency / conflict accent — red, distinct from the peach primary. */
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
  shadowColor: brand.primaryPressed,
  shadowOpacity: 0.25,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 5,
} as const;

export const cardShadow = {
  shadowColor: '#5A2E14',
  shadowOpacity: 0.07,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const;

export const raisedShadow = {
  shadowColor: '#5A2E14',
  shadowOpacity: 0.14,
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
  verified: { bg: brand.primarySoftColor, fg: brand.accentDark, label: 'Verified' },
  unverified: { bg: brand.sunSoft, fg: brand.unverifiedText, label: 'Unverified' },
  superseded: { bg: brand.supersededBg, fg: brand.textMuted, label: 'Replaced' },
  conflict: { bg: brand.accentSoft, fg: brand.accent, label: 'Conflict' },
} as const;
