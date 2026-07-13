// Cohort domain model.

export interface RawSite {
  facility: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  lat?: number;
  lon?: number;
}

export interface Eligibility {
  minAgeYears?: number;
  maxAgeYears?: number;
  sex?: string;
  healthyVolunteers?: boolean;
  criteriaText?: string;
}

export interface TrialProtocol {
  nctId: string;
  title: string;
  acronym?: string;
  sponsor?: string;
  sponsorClass?: string;
  phase?: string;
  status?: string;
  conditions: string[];
  targetEnrollment?: number;
  eligibility: Eligibility;
  sites: RawSite[];
}

// A site with its modeled enrollment characteristics.
export interface ScoredSite {
  id: string;
  facility: string;
  city?: string;
  state?: string;
  country?: string;
  region: string; // normalized metro/region key for competition modeling
  lat?: number;
  lon?: number;
  tier: SiteTier;
  // Expected patients enrolled per month once fully activated (mean of the prior).
  rate: number;
  // Standard deviation of the site rate prior (site-to-site uncertainty).
  rateSd: number;
  // Months until the site is activated and begins screening.
  activationMonths: number;
  // Local eligible-patient pool this site can draw from before saturating.
  poolSize: number;
  score: number; // 0-100 composite desirability
  rationale: RationaleItem[];
}

export type SiteTier =
  | 'comprehensive-cancer-center'
  | 'academic-medical-center'
  | 'specialty-institute'
  | 'community-hospital'
  | 'community-clinic';

export interface RationaleItem {
  factor: string;
  effect: number; // signed contribution to the rate multiplier (e.g. +0.4, -0.2)
  detail: string;
}

export interface LandscapeTrial {
  nctId: string;
  title: string;
  status?: string;
  phase?: string;
  enrollment?: number;
  sponsor?: string;
}

export interface Landscape {
  condition: string;
  competingTrials: LandscapeTrial[];
  competingCount: number;
  // Estimated annual incident + prevalent eligible patients across covered regions.
  patientPoolEstimate: number;
  source: 'youcom' | 'nimble' | 'ctgov-fallback';
  notes: string[];
}

export interface ForecastPoint {
  month: number;
  mean: number;
  p10: number;
  p90: number;
}

export interface Forecast {
  target: number;
  curve: ForecastPoint[];
  expectedMonths: number | null; // null if target not reached within horizon
  p10Months: number | null;
  p90Months: number | null;
  probByTarget: number; // probability of hitting target within horizon
  sitesUsed: number;
  finalEnrollmentMean: number;
  horizonMonths: number;
}

export interface Scenario {
  nctId: string;
  target: number;
  costPerDay: number;
  selectedSiteIds: string[];
}

export interface OptimizeResult {
  baseline: {
    siteIds: string[];
    sitesUsed: number;
    forecast: Forecast;
  };
  optimized: {
    siteIds: string[];
    sitesUsed: number;
    forecast: Forecast;
  };
  monthsSaved: number;
  daysSaved: number;
  dollarsSaved: number;
  sitesReduced: number;
  costPerDay: number;
  rationale: string[];
}

export interface Identity {
  handle: string; // e.g. forecast-agent@cohort.agent
  did: string; // deterministic id (did:agent:...)
  kind: 'agent' | 'human';
  role: string;
  verified: boolean;
  issuer: string;
}

export interface AuditEvent {
  seq: number;
  ts: string;
  actor: Identity;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  payload?: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface ApprovalRequest {
  id: string;
  nctId: string;
  action: string;
  summary: string;
  requestedBy: Identity; // the agent asking
  approver: Identity; // the human who must sign off
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
  note?: string;
  channel: 'band' | 'local-fallback';
}

export interface SponsorStatus {
  key: string;
  name: string;
  role: string;
  live: boolean;
  prize: boolean;
}

export interface TrialAnalysis {
  protocol: TrialProtocol;
  scoredSites: ScoredSite[];
  landscape: Landscape;
  identities: Identity[];
  optimize: OptimizeResult;
  sponsors: SponsorStatus[];
  approval?: ApprovalRequest | null;
}
