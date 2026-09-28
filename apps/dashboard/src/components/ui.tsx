import type { ReactNode } from 'react';

import type { Tone } from '@/lib/aggregate';
import { progressPct } from '@/lib/aggregate';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`border border-line bg-surface p-5 ${className}`}>{children}</div>;
}

/** Small uppercase mono label with wide tracking. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted ${className}`}>{children}</div>;
}

/** A section heading with the short lime rule. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="h-0.5 w-3.5 bg-lime" />
        <Eyebrow>{children}</Eyebrow>
      </div>
      {right}
    </div>
  );
}

export function PageHeader({ eyebrow, title, note, right }: { eyebrow: string; title: string; note?: string; right?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-2 text-[34px] font-bold leading-[1.05] tracking-[-0.025em]">{title}</h1>
        {note ? <p className="mt-2 font-serif text-xl italic text-muted">{note}</p> : null}
      </div>
      {right}
    </header>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: boolean }) {
  return (
    <Card className={accent ? 'border-l-4 border-l-lime' : ''}>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-2 font-mono text-4xl font-bold leading-none tracking-[-0.02em]">{value}</div>
      {hint ? <div className="mt-2 text-xs text-muted">{hint}</div> : null}
    </Card>
  );
}

const TONE: Record<Tone, string> = {
  good: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  neutral: 'bg-lime-soft text-ink border border-line',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-block px-2 py-[3px] font-mono text-[10px] font-bold uppercase tracking-[0.1em] ${TONE[tone]}`}>{children}</span>;
}

/** "3 / 5" progress toward K: lime fill, full and solid once confirmed. */
export function ProgressBar({ have, need }: { have: number; need: number }) {
  const pct = progressPct(have, need);
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 bg-line">
        <div className="h-2 bg-lime" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-sm font-bold tabular-nums">{`${have} / ${need}`}</span>
    </div>
  );
}

/** A tiny line chart with a filled area (plain SVG). */
export function Sparkline({ values, height = 72, labelLeft, labelRight }: { values: number[]; height?: number; labelLeft?: string; labelRight?: string }) {
  const w = 600;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, height - 6 - (v / max) * (height - 12)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `0,${height} ${line} ${w},${height}`;
  const last = pts[pts.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-[72px] w-full" role="img" aria-label="Contributions per minute">
        <polygon points={area} fill="rgba(30,90,69,0.16)" />
        <polyline points={line} fill="none" stroke="#174636" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {last ? <rect x={last[0] - 4} y={last[1] - 4} width={8} height={8} fill="#1e5a45" stroke="#1c1f1e" strokeWidth={1} /> : null}
      </svg>
      {labelLeft || labelRight ? (
        <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
          <span>{labelLeft}</span>
          <span>{labelRight}</span>
        </div>
      ) : null}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <span className="h-[3px] w-7 bg-lime" />
      <div className="font-semibold">{title}</div>
      {hint ? <div className="max-w-md text-sm text-muted">{hint}</div> : null}
    </div>
  );
}

/** Square segmented control; the selected segment is lime. */
export function Segmented<V extends string>({ options, value, onChange }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void }) {
  return (
    <div className="inline-flex border border-line-strong bg-surface">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${o.value === value ? 'bg-lime text-white' : 'text-muted hover:bg-lime-soft'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Lime call to action with the glow, or an outlined secondary. */
export function Button({ children, onClick, kind = 'primary', disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost'; disabled?: boolean; type?: 'button' | 'submit' }) {
  const base = 'font-bold uppercase tracking-[0.2em] transition-opacity disabled:opacity-40';
  return kind === 'primary' ? (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} bg-lime px-6 py-[18px] text-[13px] text-white shadow-[0_2px_8px_rgba(28,31,30,0.12),0_0_28px_rgba(30,90,69,0.35)] hover:opacity-90`}>
      {children}
    </button>
  ) : (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} border border-line-strong px-6 py-4 text-xs text-ink hover:bg-lime-soft`}>
      {children}
    </button>
  );
}
