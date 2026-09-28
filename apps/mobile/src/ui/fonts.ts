/** Font files bundled with the app (static TTFs; loaded once at startup by the root layout). */
export const FONT_ASSETS = {
  Geist: require('../../assets/fonts/Geist-Regular.ttf'),
  'Geist-Medium': require('../../assets/fonts/Geist-Medium.ttf'),
  'Geist-SemiBold': require('../../assets/fonts/Geist-SemiBold.ttf'),
  'Geist-Bold': require('../../assets/fonts/Geist-Bold.ttf'),
  GeistMono: require('../../assets/fonts/GeistMono-Regular.ttf'),
  'GeistMono-Bold': require('../../assets/fonts/GeistMono-Bold.ttf'),
  InstrumentSerif: require('../../assets/fonts/InstrumentSerif-Regular.ttf'),
  'InstrumentSerif-Italic': require('../../assets/fonts/InstrumentSerif-Italic.ttf'),
};

export type Weight = '400' | '500' | '600' | '700' | '800';

/**
 * Sans (Geist) for UI, mono (Geist Mono) for labels and numbers, serif (Instrument Serif) for decorative emphasis.
 * Android needs a distinct family per weight, so the weight is folded into the family name.
 */
export function fontFamily(weight: Weight = '400', opts: { mono?: boolean; serif?: boolean; italic?: boolean } = {}): string {
  if (opts.serif) return opts.italic ? 'InstrumentSerif-Italic' : 'InstrumentSerif';
  if (opts.mono) return Number(weight) >= 600 ? 'GeistMono-Bold' : 'GeistMono';
  if (Number(weight) >= 700) return 'Geist-Bold';
  if (weight === '600') return 'Geist-SemiBold';
  if (weight === '500') return 'Geist-Medium';
  return 'Geist';
}
