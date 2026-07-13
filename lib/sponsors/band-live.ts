// Live BAND integration (https://app.band.ai/api/v1).
//
// When BAND_API_KEY (a user key, band_u_...) is set, Cohort:
//   1. registers its agent crew on BAND — real, persistent agent identities,
//   2. for each analyzed trial, opens a BAND chat room where the crew posts its
//      work as events and the optimizer sends the human study manager an
//      approval request (a real @mention message).
//
// This is BAND's exact value proposition — persistent agent identity + multi-
// agent coordination + human-in-the-loop — applied to trial site planning.
// Everything is guarded: any BAND failure degrades to the local flow and never
// breaks an analysis.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BandAgentRef, BandCoordination, TrialProtocol, OptimizeResult } from '../types';

const BASE = 'https://app.band.ai/api/v1';
// Registered agents can't be deleted once they post, and the free tier caps
// concurrent agents — so we register the crew ONCE and reuse it forever via a
// gitignored on-disk cache instead of re-registering (which would pile up).
const CREW_FILE = join(process.cwd(), '.cohort', 'band-crew.json');

interface CrewAgent extends BandAgentRef {
  key: string; // agent API key (band_a_...)
}

interface BandState {
  crew: Record<string, CrewAgent> | null;
  crewPromise: Promise<Record<string, CrewAgent> | null> | null;
  rooms: Map<string, BandCoordination>;
}

const g = globalThis as unknown as { __cohort_band__?: BandState };
if (!g.__cohort_band__) g.__cohort_band__ = { crew: null, crewPromise: null, rooms: new Map() };
const state = g.__cohort_band__;

// role -> agent definition
const CREW_DEF: { role: string; name: string; description: string }[] = [
  { role: 'scout', name: 'Cohort Site Scout', description: 'Ingests trials + web intelligence for clinical enrollment' },
  { role: 'forecaster', name: 'Cohort Forecast Agent', description: 'Monte-Carlo enrollment forecaster' },
  { role: 'optimizer', name: 'Cohort Optimizer', description: 'Site-portfolio optimizer for clinical trials' },
  { role: 'manager', name: 'Cohort Study Manager', description: 'Human-in-the-loop approver for site plans' },
];

export function isLive(): boolean {
  return !!process.env.BAND_API_KEY;
}

async function bandFetch(path: string, key: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'X-API-Key': key, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-json */
  }
  if (!res.ok) throw new Error(`BAND ${method} ${path} -> ${res.status} ${text.slice(0, 160)}`);
  return json;
}

function loadPersistedCrew(): Record<string, CrewAgent> | null {
  // Env var takes precedence (for deployed instances where the disk cache, which
  // is gitignored, isn't present) — set BAND_CREW_JSON to the crew file's contents.
  const envCrew = process.env.BAND_CREW_JSON;
  if (envCrew) {
    try {
      const crew = JSON.parse(envCrew);
      if (crew?.optimizer?.key) return crew;
    } catch {
      /* ignore */
    }
  }
  try {
    if (!existsSync(CREW_FILE)) return null;
    const crew = JSON.parse(readFileSync(CREW_FILE, 'utf8'));
    if (crew && crew.optimizer && crew.optimizer.key) return crew;
  } catch {
    /* ignore */
  }
  return null;
}

function persistCrew(crew: Record<string, CrewAgent>): void {
  try {
    mkdirSync(dirname(CREW_FILE), { recursive: true });
    writeFileSync(CREW_FILE, JSON.stringify(crew, null, 2));
  } catch {
    /* ignore */
  }
}

// Register the crew once and reuse it. Prefers the on-disk cache; only registers
// when none exists, cleaning up deletable prior Cohort agents to free slots.
export async function ensureCrew(): Promise<Record<string, CrewAgent> | null> {
  const userKey = process.env.BAND_API_KEY;
  if (!userKey) return null;
  if (state.crew) return state.crew;
  if (state.crewPromise) return state.crewPromise;

  state.crewPromise = (async () => {
    try {
      const persisted = loadPersistedCrew();
      if (persisted) {
        state.crew = persisted;
        return persisted;
      }
      // free slots: delete deletable (execution-free) Cohort agents
      const list = await bandFetch('/me/agents', userKey, 'GET').catch(() => ({ data: [] }));
      await Promise.all(
        (list.data || [])
          .filter((a: any) => (a.name || '').startsWith('Cohort '))
          .map((a: any) => bandFetch(`/me/agents/${a.id}`, userKey, 'DELETE').catch(() => null)),
      );

      const crew: Record<string, CrewAgent> = {};
      for (const def of CREW_DEF) {
        const r = await bandFetch('/me/agents/register', userKey, 'POST', {
          agent: { name: def.name, description: def.description },
        });
        crew[def.role] = {
          role: def.role,
          name: def.name,
          handle: `vnarasingamoorthy/${slug(def.name)}`,
          id: r.data.agent.id,
          key: r.data.credentials.api_key,
        };
      }
      state.crew = crew;
      persistCrew(crew);
      return crew;
    } catch (e) {
      state.crewPromise = null; // allow retry
      return null;
    }
  })();
  return state.crewPromise;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/^cohort\s+/, 'cohort-').replace(/\s+/g, '-');
}

export function publicHandles(): BandAgentRef[] {
  if (!state.crew) return [];
  return Object.values(state.crew).map(({ key, ...ref }) => ref);
}

// Create a BAND room for a trial and post the crew's coordination + an approval
// request mentioning the study-manager agent. Returns the coordination summary.
export async function coordinateTrial(
  nctId: string,
  protocol: TrialProtocol,
  optimize: OptimizeResult,
): Promise<BandCoordination> {
  const cached = state.rooms.get(nctId);
  if (cached) return cached;

  const crew = await ensureCrew();
  if (!crew) return { live: false, agents: [], posted: 0, note: 'BAND crew unavailable' };

  const agents = publicHandles();
  const label = protocol.acronym || nctId;
  const opt = optimize.optimized.forecast;
  try {
    // 1. optimizer opens the room
    const room = await bandFetch('/agent/chats', crew.optimizer.key, 'POST', {
      chat: { title: `${label} · site plan review` },
    });
    const roomId: string = room.data.id;

    // 2. add the rest of the crew as participants
    await Promise.all(
      ['scout', 'forecaster', 'manager'].map((role) =>
        bandFetch(`/agent/chats/${roomId}/participants`, crew.optimizer.key, 'POST', {
          participant: { participant_id: crew[role].id, role: 'member' },
        }).catch(() => null),
      ),
    );

    // 3. each agent posts its step as an event, then the optimizer requests sign-off
    let posted = 0;
    const evt = (role: string, message_type: string, content: string) =>
      bandFetch(`/agent/chats/${roomId}/events`, crew[role].key, 'POST', { event: { message_type, content } })
        .then(() => { posted += 1; })
        .catch(() => null);

    await Promise.all([
      evt('scout', 'tool_result', `Ingested ${label}: ${protocol.sites.length} sites, target ${protocol.targetEnrollment ?? 'n/a'}.`),
      evt('forecaster', 'thought', `Forecast: optimized plan reaches target in ~${opt.expectedMonths?.toFixed(1) ?? '—'} months.`),
      evt('optimizer', 'task', `Optimized ${optimize.optimized.sitesUsed} sites — ${optimize.monthsSaved.toFixed(1)} mo / $${optimize.dollarsSaved.toLocaleString()} saved vs naive.`),
    ]);

    await bandFetch(`/agent/chats/${roomId}/messages`, crew.optimizer.key, 'POST', {
      message: {
        content: `Requesting sign-off: activate ${optimize.optimized.sitesUsed} sites to enroll ${opt.target} patients in ~${opt.expectedMonths?.toFixed(1) ?? '—'} months ($${optimize.dollarsSaved.toLocaleString()} saved).`,
        mentions: [{ id: crew.manager.id, kind: 'mention', name: 'Cohort Study Manager' }],
      },
    }).then(() => { posted += 1; }).catch(() => null);

    const coord: BandCoordination = {
      live: true,
      roomId,
      roomTitle: `${label} · site plan review`,
      roomUrl: 'https://app.band.ai',
      agents,
      posted,
    };
    state.rooms.set(nctId, coord);
    return coord;
  } catch (e: any) {
    return { live: true, agents, posted: 0, note: `BAND room error: ${e?.message?.slice(0, 120) || 'failed'}` };
  }
}

// The study manager agent posts the human decision back to the room.
export async function postDecision(nctId: string, approved: boolean): Promise<void> {
  const crew = state.crew;
  const room = state.rooms.get(nctId);
  if (!crew || !room?.roomId) return;
  await bandFetch(`/agent/chats/${room.roomId}/events`, crew.manager.key, 'POST', {
    event: {
      message_type: 'task',
      content: approved ? 'APPROVED — activating the optimized site plan.' : 'REJECTED — plan sent back for revision.',
    },
  }).catch(() => null);
}

export function getCoordination(nctId: string): BandCoordination | undefined {
  return state.rooms.get(nctId);
}
