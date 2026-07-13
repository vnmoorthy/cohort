'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { TrialAnalysis, Forecast, ScoredSite, SponsorStatus, AuditEvent } from '@/lib/types';
import { money, moneyFull, months as fmtMonths, num, pct, shortHash } from '@/lib/format';
import ForecastChart from '@/components/ForecastChart';

const EXAMPLES = [
  { id: 'NCT03631199', label: 'CANOPY-1 · NSCLC · Novartis · 152 sites' },
  { id: 'NCT03215706', label: 'CheckMate 9LA · NSCLC · BMS · 116 sites' },
  { id: 'NCT02576574', label: 'JAVELIN Lung 100 · NSCLC · 349 sites' },
];

interface Comparison {
  months: number;
  baselineMonths: number;
  monthsSaved: number;
  daysSaved: number;
  dollarsSaved: number;
  sitesUsed: number;
  reachedTarget: boolean;
  costPerDay: number;
}

const TIER_SHORT: Record<string, string> = {
  'comprehensive-cancer-center': 'Comp. cancer ctr',
  'academic-medical-center': 'Academic',
  'specialty-institute': 'Specialty inst.',
  'community-hospital': 'Community hosp.',
  'community-clinic': 'Community clinic',
};

export default function Page() {
  const [theme, setTheme] = useState<'system' | 'dark' | 'light'>('system');
  const [nctId, setNctId] = useState('NCT03631199');
  const [target, setTarget] = useState<number | ''>('');
  const [costPerDay, setCostPerDay] = useState(55000);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<TrialAnalysis | null>(null);
  const [sponsors, setSponsors] = useState<SponsorStatus[]>([]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<Forecast | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [whatIfBusy, setWhatIfBusy] = useState(false);

  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [integrity, setIntegrity] = useState<{ valid: boolean; length: number } | null>(null);
  const [approving, setApproving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // theme
  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('cohort-theme')) as any;
    if (saved === 'dark' || saved === 'light') {
      setTheme(saved);
      document.documentElement.dataset.theme = saved;
    }
  }, []);
  const cycleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('cohort-theme', next);
  };

  // sponsor stack for the top bar
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setSponsors(d.sponsors || []))
      .catch(() => {});
  }, []);

  const loadAudit = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/audit?nctId=${id}`);
      const d = await r.json();
      setAudit(d.events || []);
      setIntegrity(d.integrity || null);
    } catch {
      /* noop */
    }
  }, []);

  async function analyze(id?: string) {
    const useId = (id || nctId).trim().toUpperCase();
    if (!useId) return;
    setLoading(true);
    setError('');
    setAnalysis(null);
    setCurrent(null);
    setComparison(null);
    const stages = ['Ingesting trial from ClinicalTrials.gov…', 'Mapping competitive landscape…', 'Scoring 152 sites…', 'Running Monte-Carlo forecast…', 'Optimizing site portfolio…'];
    let si = 0;
    setPhase(stages[0]);
    const ticker = setInterval(() => {
      si = Math.min(si + 1, stages.length - 1);
      setPhase(stages[si]);
    }, 550);
    try {
      const body: any = { nctId: useId, costPerDay };
      if (target !== '') body.target = target;
      const r = await fetch('/api/trial', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const a: TrialAnalysis = d.analysis;
      setAnalysis(a);
      setNctId(a.protocol.nctId);
      setSponsors(a.sponsors);
      const optIds = new Set(a.optimize.optimized.siteIds);
      setSelected(optIds);
      setCurrent(a.optimize.optimized.forecast);
      setComparison({
        months: a.optimize.optimized.forecast.expectedMonths ?? a.optimize.optimized.forecast.horizonMonths,
        baselineMonths: a.optimize.baseline.forecast.expectedMonths ?? a.optimize.baseline.forecast.horizonMonths,
        monthsSaved: a.optimize.monthsSaved,
        daysSaved: a.optimize.daysSaved,
        dollarsSaved: a.optimize.dollarsSaved,
        sitesUsed: a.optimize.optimized.sitesUsed,
        reachedTarget: a.optimize.optimized.forecast.probByTarget > 0.5,
        costPerDay: a.optimize.costPerDay,
      });
      loadAudit(a.protocol.nctId);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      clearInterval(ticker);
      setLoading(false);
    }
  }

  const runWhatIf = useCallback(
    (ids: Set<string>) => {
      if (!analysis) return;
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(async () => {
        setWhatIfBusy(true);
        try {
          const r = await fetch('/api/forecast', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              nctId: analysis.protocol.nctId,
              selectedSiteIds: Array.from(ids),
              target: analysis.optimize.optimized.forecast.target,
              costPerDay: comparison?.costPerDay ?? costPerDay,
            }),
          });
          const d = await r.json();
          if (!d.error) {
            setCurrent(d.forecast);
            setComparison({ ...d.comparison });
          }
        } finally {
          setWhatIfBusy(false);
        }
      }, 280);
    },
    [analysis, comparison, costPerDay],
  );

  function toggleSite(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      runWhatIf(next);
      return next;
    });
  }

  function resetToOptimized() {
    if (!analysis) return;
    const ids = new Set(analysis.optimize.optimized.siteIds);
    setSelected(ids);
    setCurrent(analysis.optimize.optimized.forecast);
    setComparison({
      months: analysis.optimize.optimized.forecast.expectedMonths ?? analysis.optimize.optimized.forecast.horizonMonths,
      baselineMonths: analysis.optimize.baseline.forecast.expectedMonths ?? analysis.optimize.baseline.forecast.horizonMonths,
      monthsSaved: analysis.optimize.monthsSaved,
      daysSaved: analysis.optimize.daysSaved,
      dollarsSaved: analysis.optimize.dollarsSaved,
      sitesUsed: analysis.optimize.optimized.sitesUsed,
      reachedTarget: true,
      costPerDay: analysis.optimize.costPerDay,
    });
  }

  async function reoptimize(newTarget: number, newCost: number) {
    if (!analysis) return;
    setWhatIfBusy(true);
    try {
      const r = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nctId: analysis.protocol.nctId, target: newTarget, costPerDay: newCost }),
      });
      const d = await r.json();
      if (!d.error) {
        const a2 = { ...analysis, optimize: d.optimize };
        setAnalysis(a2);
        const ids = new Set<string>(d.optimize.optimized.siteIds);
        setSelected(ids);
        setCurrent(d.optimize.optimized.forecast);
        setComparison({
          months: d.optimize.optimized.forecast.expectedMonths ?? d.optimize.optimized.forecast.horizonMonths,
          baselineMonths: d.optimize.baseline.forecast.expectedMonths ?? d.optimize.baseline.forecast.horizonMonths,
          monthsSaved: d.optimize.monthsSaved,
          daysSaved: d.optimize.daysSaved,
          dollarsSaved: d.optimize.dollarsSaved,
          sitesUsed: d.optimize.optimized.sitesUsed,
          reachedTarget: true,
          costPerDay: d.optimize.costPerDay,
        });
        loadAudit(analysis.protocol.nctId);
      }
    } finally {
      setWhatIfBusy(false);
    }
  }

  async function approve(decision: 'approved' | 'rejected') {
    if (!analysis?.approval) return;
    setApproving(true);
    try {
      const r = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approvalId: analysis.approval.id, nctId: analysis.protocol.nctId, decision, note: decision === 'approved' ? 'Approved — activate optimized site plan.' : 'Rejected — revise plan.' }),
      });
      const d = await r.json();
      if (!d.error) {
        setAnalysis((a) => (a ? { ...a, approval: d.approval } : a));
        loadAudit(analysis.protocol.nctId);
      }
    } finally {
      setApproving(false);
    }
  }

  const sortedSites = analysis ? [...analysis.scoredSites].sort((a, b) => b.score - a.score) : [];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark" />
            <div>
              <div className="brand-name">
                cohort<b>.</b>
              </div>
              <div className="brand-tag">enrollment intelligence for clinical trials</div>
            </div>
          </div>
          <div className="topbar-spacer" />
          <div className="stack-strip">
            {sponsors.map((s) => (
              <span key={s.key} className={`chip ${s.live ? 'live' : 'fallback'} ${s.prize ? 'prize' : ''}`} title={`${s.role}${s.live ? ' · live' : ' · local fallback'}`}>
                <span className="led" />
                {s.name}
              </span>
            ))}
          </div>
          <button className="btn ghost sm" onClick={cycleTheme} aria-label="Toggle theme">
            {theme === 'light' ? '◐ dark' : '◑ light'}
          </button>
        </div>
      </header>

      <div className="shell">
        {/* HERO */}
        <section className="hero">
          <div className="hero-grid" />
          <div className="eyebrow">
            <span className="dot" /> the operating layer for trial execution
          </div>
          <h1>
            80% of trials miss enrollment. <span className="amber">Cohort</span> finds the time before you lose it.
          </h1>
          <p className="lead">
            Point Cohort at any trial. It forecasts enrollment with a Monte-Carlo engine on real ClinicalTrials.gov data,
            optimizes which sites to open, and routes the plan for human sign-off — every decision logged to a
            tamper-evident audit trail. Late-stage delays cost <b>~$55,000 per day</b>. This is where the time hides.
          </p>

          <div className="analyze-bar">
            <div className="field grow">
              <label htmlFor="nct">ClinicalTrials.gov ID</label>
              <input
                id="nct"
                value={nctId}
                onChange={(e) => setNctId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && analyze()}
                placeholder="NCT03631199"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label htmlFor="tgt">Target N (optional)</label>
              <input id="tgt" value={target} onChange={(e) => setTarget(e.target.value === '' ? '' : Math.max(1, Number(e.target.value) || 0))} placeholder="auto" style={{ width: 100 }} />
            </div>
            <div className="field">
              <label htmlFor="cost">Cost / day ($)</label>
              <input id="cost" value={costPerDay} onChange={(e) => setCostPerDay(Math.max(0, Number(e.target.value) || 0))} style={{ width: 110 }} />
            </div>
            <button className="btn" onClick={() => analyze()} disabled={loading}>
              {loading ? 'Analyzing…' : 'Analyze trial →'}
            </button>
          </div>
          <div className="examples">
            <span className="lbl">try:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex.id} className="chip-btn" onClick={() => { setNctId(ex.id); analyze(ex.id); }} title={ex.label}>
                {ex.id}
              </button>
            ))}
          </div>
        </section>

        {error && (
          <div className="panel" style={{ borderColor: 'var(--bad)' }}>
            <div className="err">⚠ {error}</div>
            <div className="notice" style={{ marginTop: 6 }}>Enter a valid ClinicalTrials.gov identifier (e.g. NCT03631199).</div>
          </div>
        )}

        {loading && (
          <div className="panel">
            <div className="loading-row">
              <span className="spinner" /> {phase}
            </div>
          </div>
        )}

        {analysis && current && comparison && (
          <div className="fade-in">
            <TrialHeader analysis={analysis} />
            <ImpactBanner comparison={comparison} reduce={theme === 'light'} />

            <div className="section-label">Enrollment forecast</div>
            <div className="panel">
              <div className="panel-head">
                <div className="panel-title">
                  Monte-Carlo projection · <b>{analysis.optimize.optimized.forecast.target} patients</b> · {comparison.sitesUsed} sites active
                </div>
                {whatIfBusy && <span className="loading-row" style={{ fontSize: 12 }}><span className="spinner" /> recomputing</span>}
              </div>
              <ForecastChart target={analysis.optimize.optimized.forecast.target} baseline={analysis.optimize.baseline.forecast} current={current} />
            </div>

            <WhatIf
              analysis={analysis}
              defaultCost={comparison.costPerDay}
              onReoptimize={reoptimize}
              onReset={resetToOptimized}
              busy={whatIfBusy}
            />

            <div className="section-label">Site portfolio · toggle any site to re-forecast live</div>
            <SitesTable sites={sortedSites} selected={selected} optimizedIds={new Set(analysis.optimize.optimized.siteIds)} onToggle={toggleSite} />

            <div className="grid cols-2">
              <LandscapePanel analysis={analysis} />
              <IdentityPanel analysis={analysis} />
            </div>

            {analysis.band?.live && (
              <>
                <div className="section-label">Agent coordination · live on BAND</div>
                <BandPanel band={analysis.band} />
              </>
            )}

            <div className="section-label">Human sign-off · governed by BAND</div>
            <div className="grid cols-2">
              <ApprovalCard analysis={analysis} onApprove={approve} busy={approving} />
              <RationalePanel analysis={analysis} />
            </div>

            <div className="section-label">Audit trail · every decision, attributed &amp; tamper-evident</div>
            <AuditPanel events={audit} integrity={integrity} live={sponsors.find((s) => s.key === 'hydra')?.live || false} />
          </div>
        )}

        <div className="footer">
          <span>Cohort · built on ClinicalTrials.gov · InsForge · Hydra DB · BAND · You.com · RocketRide · .agent</span>
          <span className="mono">forecasts are modeled estimates · not medical or investment advice</span>
        </div>
      </div>
    </>
  );
}

/* ---------------- sub-components ---------------- */

function CountUp({ value, format, duration = 750, reduce }: { value: number; format: (n: number) => string; duration?: number; reduce?: boolean }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const to = value;
    if (reduce || typeof window === 'undefined') {
      fromRef.current = to;
      setDisplay(to);
      return;
    }
    const from = fromRef.current;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const start = performance.now();
    let raf = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      fromRef.current = to;
      setDisplay(to);
    };
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = from + (to - from) * eased;
      fromRef.current = cur; // track running value so interruptions resume smoothly
      setDisplay(cur);
      if (p < 1) raf = requestAnimationFrame(tick);
      else finish();
    };
    raf = requestAnimationFrame(tick);
    // Guarantee convergence even if rAF is throttled (offscreen/background tab).
    const guard = setTimeout(finish, duration + 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(guard);
      finish();
    };
  }, [value, duration, reduce]);
  return <>{format(display)}</>;
}

function TrialHeader({ analysis }: { analysis: TrialAnalysis }) {
  const p = analysis.protocol;
  return (
    <div className="panel" style={{ marginTop: 22 }}>
      <div className="trial-head">
        <div className="panel-title" style={{ marginBottom: 8 }}>
          {p.acronym ? <b>{p.acronym}</b> : <b>{p.nctId}</b>} · {p.nctId}
        </div>
        <h2>{p.title}</h2>
        <div className="trial-meta">
          {p.sponsor && <span className="tag">Sponsor <b>{p.sponsor}</b></span>}
          {p.phase && <span className="tag">Phase <b>{p.phase.replace('PHASE', '')}</b></span>}
          {p.status && <span className="tag">{p.status.replace(/_/g, ' ')}</span>}
          <span className="tag hot">Target <b>{num(p.targetEnrollment)}</b></span>
          <span className="tag">Sites <b>{p.sites.length}</b></span>
          {p.conditions[0] && <span className="tag">{p.conditions[0]}</span>}
          {p.eligibility.minAgeYears !== undefined && (
            <span className="tag">Age <b>{p.eligibility.minAgeYears}{p.eligibility.maxAgeYears ? `–${p.eligibility.maxAgeYears}` : '+'}</b></span>
          )}
        </div>
      </div>
    </div>
  );
}

function ImpactBanner({ comparison, reduce }: { comparison: Comparison; reduce?: boolean }) {
  return (
    <div className="impact" style={{ marginTop: 18 }}>
      <div className="headline">
        <div className="big">
          <CountUp value={comparison.dollarsSaved} format={money} reduce={reduce} />
        </div>
        <div className="sub">
          projected savings vs a naive site plan · at {moneyFull(comparison.costPerDay)}/day of delay
        </div>
      </div>
      <div className="divider" />
      <div className="metric">
        <span className="v tabular" style={{ color: 'var(--accent)' }}>
          <CountUp value={comparison.monthsSaved} format={(n) => n.toFixed(1)} reduce={reduce} /> mo
        </span>
        <span className="k">faster to target</span>
      </div>
      <div className="metric">
        <span className="v tabular"><CountUp value={comparison.months} format={(n) => n.toFixed(1)} reduce={reduce} /> mo</span>
        <span className="k">optimized timeline</span>
      </div>
      <div className="metric">
        <span className="v tabular" style={{ color: 'var(--text-dim)' }}>{comparison.baselineMonths.toFixed(1)} mo</span>
        <span className="k">naive timeline</span>
      </div>
      <div className="metric">
        <span className="v tabular">{num(comparison.daysSaved)}</span>
        <span className="k">days saved</span>
      </div>
    </div>
  );
}

function WhatIf({ analysis, defaultCost, onReoptimize, onReset, busy }: { analysis: TrialAnalysis; defaultCost: number; onReoptimize: (t: number, c: number) => void; onReset: () => void; busy: boolean }) {
  const baseTarget = analysis.optimize.optimized.forecast.target;
  const [t, setT] = useState(baseTarget);
  const [c, setC] = useState(defaultCost);
  useEffect(() => { setT(baseTarget); setC(defaultCost); }, [baseTarget, defaultCost]);
  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div className="panel-head">
        <div className="panel-title">What-if · <b>re-plan the trial</b></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost sm" onClick={onReset}>↺ reset to optimized</button>
          <button className="btn sm" onClick={() => onReoptimize(t, c)} disabled={busy}>{busy ? '…' : 'Re-optimize'}</button>
        </div>
      </div>
      <div className="controls">
        <div className="control" style={{ flex: 1 }}>
          <label htmlFor="rt">Enrollment target</label>
          <input id="rt" type="range" min={Math.max(20, Math.round(baseTarget * 0.3))} max={Math.round(baseTarget * 1.5)} value={t} onChange={(e) => setT(Number(e.target.value))} />
          <span className="val"><b>{num(t)}</b> patients</span>
        </div>
        <div className="control" style={{ flex: 1 }}>
          <label htmlFor="rc">Cost of delay / day</label>
          <input id="rc" type="range" min={5000} max={150000} step={5000} value={c} onChange={(e) => setC(Number(e.target.value))} />
          <span className="val"><b>{moneyFull(c)}</b></span>
        </div>
      </div>
    </div>
  );
}

function SitesTable({ sites, selected, optimizedIds, onToggle }: { sites: ScoredSite[]; selected: Set<string>; optimizedIds: Set<string>; onToggle: (id: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? sites : sites.slice(0, 40);
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">
          <b>{selected.size}</b> of {sites.length} sites in current plan
        </div>
        <span className="notice">amber score = higher modeled enrollment rate</span>
      </div>
      <div className="table-wrap">
        <table className="sites">
          <thead>
            <tr>
              <th style={{ width: 40 }}>In plan</th>
              <th>Site</th>
              <th>Tier</th>
              <th style={{ width: 120 }}>Rate /mo</th>
              <th style={{ width: 64 }}>Score</th>
              <th style={{ width: 74 }}>Activate</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const on = selected.has(s.id);
              const rateW = Math.min(100, (s.rate / 1.1) * 100);
              const cold = s.rate < 0.12;
              return (
                <tr key={s.id} className={on ? 'sel' : ''}>
                  <td>
                    <div className={`mini-toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} tabIndex={0} onClick={() => onToggle(s.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle(s.id)}>
                      <div className="knob" />
                    </div>
                  </td>
                  <td>
                    <div className="site-name">{s.facility}</div>
                    <div className="site-loc">{[s.city, s.state, s.country].filter(Boolean).join(', ')}{optimizedIds.has(s.id) ? '' : ''}</div>
                  </td>
                  <td><span className={`tier-pill ${s.tier === 'comprehensive-cancer-center' ? 't0' : s.tier === 'academic-medical-center' ? 't1' : ''}`}>{TIER_SHORT[s.tier] || s.tier}</span></td>
                  <td>
                    <div className="rate-bar">
                      <div className="track"><div className="fill" style={{ width: `${rateW}%`, background: cold ? 'linear-gradient(90deg,var(--bad),var(--warn))' : undefined }} /></div>
                      <span className="mono tabular" style={{ fontSize: 12, color: cold ? 'var(--bad)' : 'var(--text-dim)' }}>{s.rate.toFixed(2)}</span>
                    </div>
                  </td>
                  <td><span className="mono tabular" style={{ color: s.score >= 60 ? 'var(--accent)' : 'var(--text-dim)', fontWeight: 600 }}>{s.score}</span></td>
                  <td><span className="mono tabular" style={{ fontSize: 12, color: 'var(--text-faint)' }}>{s.activationMonths.toFixed(1)}mo</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!showAll && sites.length > 40 && (
        <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => setShowAll(true)}>Show all {sites.length} sites</button>
      )}
    </div>
  );
}

function LandscapePanel({ analysis }: { analysis: TrialAnalysis }) {
  const l = analysis.landscape;
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">Competitive landscape · <b>{l.source === 'ctgov-fallback' ? 'CTgov' : l.source}</b></div>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="stat"><span className="n tabular">{num(l.competingCount)}</span><span className="l">competing trials recruiting</span></div>
        <div className="stat"><span className="n tabular amber">{num(l.patientPoolEstimate)}</span><span className="l">est. eligible patient pool</span></div>
        <div className="stat"><span className="n tabular">{num(analysis.protocol.sites.length)}</span><span className="l">registered sites</span></div>
      </div>
      <div className="notice" style={{ fontSize: 12, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {l.notes.slice(0, 4).map((nte, i) => (
          <div key={i} style={nte.startsWith('“') ? { color: 'var(--text-dim)', paddingLeft: 8, borderLeft: '2px solid var(--primary-dim)' } : undefined}>
            {nte.startsWith('“') ? nte : `· ${nte}`}
          </div>
        ))}
      </div>
      <div style={{ maxHeight: 150, overflowY: 'auto', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        {l.competingTrials.slice(0, 8).map((t) => (
          <div key={t.nctId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0', fontSize: 12.5 }}>
            <span style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || t.nctId}</span>
            <span className="mono" style={{ color: 'var(--text-faint)', flex: 'none' }}>{t.enrollment ? `n=${t.enrollment}` : t.phase || ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IdentityPanel({ analysis }: { analysis: TrialAnalysis }) {
  const issuer = analysis.identities[0]?.issuer || 'dmv.agent';
  const viaBand = issuer === 'band.ai';
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">Actors · <b>{viaBand ? 'verified BAND identities' : 'verified .agent identities'}</b></div>
      </div>
      <div className="id-list">
        {analysis.identities.map((id) => (
          <div className="id-row" key={id.did}>
            <div className={`id-avatar ${id.kind}`}>{id.kind === 'human' ? '☺' : '⬡'}</div>
            <div style={{ minWidth: 0 }}>
              <div className="id-handle">{id.handle}</div>
              <div className="id-role">{id.role}</div>
            </div>
            <div className="verified">✓ {viaBand ? 'BAND' : 'verified'}</div>
          </div>
        ))}
      </div>
      <div className="notice" style={{ fontSize: 11.5, marginTop: 10 }}>
        Every audit event is signed to one of these identities — the attribution regulators require (21 CFR Part 11), issued by {viaBand ? 'BAND (band.ai)' : 'the .agent registry'}.
      </div>
    </div>
  );
}

function BandPanel({ band }: { band: NonNullable<TrialAnalysis['band']> }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">BAND room · <b>{band.roomTitle}</b></div>
        <a className="chip live" href={band.roomUrl} target="_blank" rel="noreferrer">open in BAND ↗</a>
      </div>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="stat"><span className="n tabular">{band.agents.length}</span><span className="l">agents registered on BAND</span></div>
        <div className="stat"><span className="n tabular amber">{band.posted}</span><span className="l">events + messages posted</span></div>
      </div>
      <div className="id-list">
        {band.agents.map((a) => (
          <div className="id-row" key={a.id}>
            <div className={`id-avatar ${a.role === 'manager' ? 'human' : 'agent'}`}>{a.role === 'manager' ? '☺' : '⬡'}</div>
            <div style={{ minWidth: 0 }}>
              <div className="id-handle">{a.handle}</div>
              <div className="id-role">{a.name}</div>
            </div>
            <div className="verified">✓ BAND</div>
          </div>
        ))}
      </div>
      <div className="notice" style={{ fontSize: 11.5, marginTop: 10 }}>
        A real BAND room: the crew coordinates and posts a human sign-off request — persistent agent identity + multi-agent coordination + human-in-the-loop, on BAND.
      </div>
    </div>
  );
}

function RationalePanel({ analysis }: { analysis: TrialAnalysis }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">Why this plan · <b>optimizer rationale</b></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {analysis.optimize.rationale.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 9, fontSize: 13, color: 'var(--text-dim)' }}>
            <span style={{ color: 'var(--primary)', flex: 'none' }}>▸</span>
            <span>{r}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApprovalCard({ analysis, onApprove, busy }: { analysis: TrialAnalysis; onApprove: (d: 'approved' | 'rejected') => void; busy: boolean }) {
  const a = analysis.approval;
  if (!a) return null;
  return (
    <div className={`approval ${a.status}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <div className="approval-status">
          {a.status === 'pending' ? '● awaiting sign-off' : a.status === 'approved' ? '✓ approved' : '✕ rejected'}
        </div>
        <span className="chip" title="routed via BAND">{a.channel === 'band' ? 'BAND' : 'BAND · local'}</span>
      </div>
      <div style={{ margin: '12px 0 4px', fontSize: 14 }}>{a.summary}</div>
      <div className="notice" style={{ fontSize: 12 }}>
        {a.requestedBy.handle} → {a.approver.handle}
      </div>
      {a.status === 'pending' ? (
        <div className="approval-actions">
          <button className="btn" onClick={() => onApprove('approved')} disabled={busy}>{busy ? '…' : '✓ Approve & activate'}</button>
          <button className="btn ghost" onClick={() => onApprove('rejected')} disabled={busy}>Reject</button>
        </div>
      ) : (
        <div className="notice" style={{ marginTop: 12, color: a.status === 'approved' ? 'var(--good)' : 'var(--bad)' }}>
          {a.note}
        </div>
      )}
    </div>
  );
}

function AuditPanel({ events, integrity, live }: { events: AuditEvent[]; integrity: { valid: boolean; length: number } | null; live: boolean }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">Hydra ledger · <b>{events.length} events</b> · {live ? 'live' : 'local hash-chain'}</div>
        {integrity && (
          <span className={`integrity ${integrity.valid ? 'ok' : 'bad'}`}>
            {integrity.valid ? '✓ chain intact' : '✕ tampered'}
          </span>
        )}
      </div>
      <div className="audit-list">
        {events.map((e, i) => (
          <div className="audit-item" key={e.hash}>
            <div className="audit-rail">
              <div className={`audit-node ${e.actor.kind === 'human' ? 'human' : ''}`} />
              {i < events.length - 1 && <div className="audit-line" />}
            </div>
            <div className="audit-body">
              <div className={`audit-action ${e.actor.kind === 'human' ? 'human' : ''}`}>{e.action}</div>
              <div className="audit-summary">{e.summary}</div>
              <div className="audit-meta">
                <span>{e.actor.handle}</span>
                <span className="hash">prev {shortHash(e.prevHash)} → {shortHash(e.hash)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
