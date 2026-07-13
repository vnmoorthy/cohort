'use client';

import type { Forecast } from '@/lib/types';

interface Props {
  target: number;
  baseline: Forecast;
  current: Forecast; // optimized or what-if
  currentLabel?: string;
  baselineLabel?: string;
}

const W = 760;
const H = 320;
const padL = 46;
const padR = 20;
const padT = 18;
const padB = 34;

export default function ForecastChart({ target, baseline, current, currentLabel = 'Optimized', baselineLabel = 'Naive baseline' }: Props) {
  const baseMonths = baseline.expectedMonths ?? baseline.horizonMonths;
  const curP90 = current.p90Months ?? current.horizonMonths;
  const displayMax = Math.max(
    12,
    Math.min(current.horizonMonths, Math.ceil(Math.max(baseMonths, curP90) * 1.12)),
  );
  const yMax = target * 1.08;

  const x = (m: number) => padL + (Math.min(m, displayMax) / displayMax) * (W - padL - padR);
  const y = (v: number) => H - padB - (Math.min(v, yMax) / yMax) * (H - padT - padB);

  const clip = (pts: { month: number; v: number }[]) => pts.filter((p) => p.month <= displayMax);

  const meanCur = clip(current.curve.map((c) => ({ month: c.month, v: c.mean })));
  const meanBase = clip(baseline.curve.map((c) => ({ month: c.month, v: c.mean })));
  const p10 = clip(current.curve.map((c) => ({ month: c.month, v: c.p10 })));
  const p90 = clip(current.curve.map((c) => ({ month: c.month, v: c.p90 })));

  const line = (pts: { month: number; v: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.month).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');

  const band =
    line(p10) +
    ' ' +
    p90
      .slice()
      .reverse()
      .map((p) => `L${x(p.month).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join(' ') +
    ' Z';

  // axis ticks
  const xStep = displayMax > 36 ? 12 : 6;
  const xticks: number[] = [];
  for (let m = 0; m <= displayMax; m += xStep) xticks.push(m);
  const yticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(target * f));

  const curCross = current.expectedMonths;
  const baseCross = baseline.expectedMonths;

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Enrollment forecast chart" style={{ display: 'block', minWidth: 520 }}>
        {/* y grid + labels */}
        {yticks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10} fontFamily="var(--mono)" fill="var(--text-faint)">
              {v}
            </text>
          </g>
        ))}
        {/* x labels */}
        {xticks.map((m, i) => (
          <text key={`x${i}`} x={x(m)} y={H - padB + 16} textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--text-faint)">
            {m}
          </text>
        ))}
        <text x={(W) / 2} y={H - 2} textAnchor="middle" fontSize={10} fontFamily="var(--mono)" fill="var(--text-faint)">
          months from first-site activation
        </text>

        {/* target line */}
        <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="5 4" opacity={0.9} />
        <text x={W - padR} y={y(target) - 6} textAnchor="end" fontSize={10} fontFamily="var(--mono)" fill="var(--accent)">
          target {target}
        </text>

        {/* optimized confidence band */}
        <path d={band} fill="var(--primary)" opacity={0.13} />

        {/* baseline mean (dashed) */}
        <path d={line(meanBase)} fill="none" stroke="var(--text-faint)" strokeWidth={1.8} strokeDasharray="6 4" />

        {/* current mean */}
        <path d={line(meanCur)} fill="none" stroke="var(--primary)" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />

        {/* crossing markers */}
        {baseCross !== null && baseCross <= displayMax && (
          <g>
            <line x1={x(baseCross)} x2={x(baseCross)} y1={y(target)} y2={H - padB} stroke="var(--text-faint)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(baseCross)} cy={y(target)} r={4} fill="var(--bg-2)" stroke="var(--text-faint)" strokeWidth={2} />
          </g>
        )}
        {curCross !== null && curCross <= displayMax && (
          <g>
            <line x1={x(curCross)} x2={x(curCross)} y1={y(target)} y2={H - padB} stroke="var(--primary)" strokeWidth={1.2} strokeDasharray="3 3" />
            <circle cx={x(curCross)} cy={y(target)} r={5} fill="var(--primary)" stroke="var(--bg-2)" strokeWidth={2} />
            <text x={x(curCross)} y={y(target) + 20} textAnchor="middle" fontSize={11} fontWeight={700} fontFamily="var(--mono)" fill="var(--primary)">
              {curCross.toFixed(1)}mo
            </text>
          </g>
        )}
      </svg>
      <div className="chart-legend">
        <span className="item"><span className="swatch" style={{ background: 'var(--primary)' }} /> {currentLabel} (mean)</span>
        <span className="item"><span className="swatch" style={{ background: 'var(--primary)', opacity: 0.3, height: 9 }} /> p10–p90 range</span>
        <span className="item"><span className="swatch" style={{ background: 'var(--text-faint)' }} /> {baselineLabel}</span>
        <span className="item"><span className="swatch" style={{ background: 'var(--accent)' }} /> enrollment target</span>
      </div>
    </div>
  );
}
