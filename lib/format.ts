// Client-safe formatting helpers (no node deps).

export function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

export function moneyFull(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function months(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n.toFixed(1)}`;
}

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toLocaleString();
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function shortHash(h: string): string {
  if (!h || h === 'GENESIS') return h || '';
  return h.slice(0, 10);
}
