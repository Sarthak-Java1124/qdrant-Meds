export const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const fmtDateTime = (ts: number) =>
  new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const fmtLongDate = (ts: number) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Short mono codes for where an item came from (shown in a bordered Tag). */
export const SOURCE_ICON: Record<string, string> = {
  rider_note: 'NTE',
  visit: 'VST',
  crowd: 'CRD',
};

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
