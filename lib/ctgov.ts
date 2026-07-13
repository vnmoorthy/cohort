// ClinicalTrials.gov API v2 client. Free, public, no key required.
// This is Cohort's real data backbone: real trials, real sites, real geo.

import type { TrialProtocol, RawSite, LandscapeTrial } from './types';

const BASE = 'https://clinicaltrials.gov/api/v2';

function parseAgeYears(age?: string): number | undefined {
  if (!age) return undefined;
  const m = age.match(/(\d+(?:\.\d+)?)\s*(year|month|week|day)/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('year')) return n;
  if (unit.startsWith('month')) return n / 12;
  if (unit.startsWith('week')) return n / 52;
  return n / 365;
}

export async function fetchTrial(nctId: string): Promise<TrialProtocol> {
  const id = nctId.trim().toUpperCase();
  if (!/^NCT\d{8}$/.test(id)) {
    throw new Error(`Invalid NCT ID "${nctId}". Expected format NCT01234567.`);
  }
  const res = await fetch(`${BASE}/studies/${id}?format=json`, {
    headers: { accept: 'application/json' },
    // route handlers run server-side; avoid Next caching a live trial fetch
    cache: 'no-store',
  });
  if (res.status === 404) throw new Error(`Trial ${id} not found on ClinicalTrials.gov.`);
  if (!res.ok) throw new Error(`ClinicalTrials.gov returned ${res.status} for ${id}.`);

  const data = await res.json();
  const p = data.protocolSection || {};
  const idm = p.identificationModule || {};
  const status = p.statusModule || {};
  const design = p.designModule || {};
  const cond = p.conditionsModule || {};
  const elig = p.eligibilityModule || {};
  const sponsorMod = p.sponsorCollaboratorsModule || {};
  const locations: any[] = (p.contactsLocationsModule && p.contactsLocationsModule.locations) || [];

  const sites: RawSite[] = locations.map((l) => ({
    facility: l.facility || 'Unnamed site',
    city: l.city,
    state: l.state,
    country: l.country,
    zip: l.zip,
    lat: l.geoPoint?.lat,
    lon: l.geoPoint?.lon,
  }));

  return {
    nctId: id,
    title: idm.briefTitle || idm.officialTitle || id,
    acronym: idm.acronym,
    sponsor: sponsorMod.leadSponsor?.name || idm.organization?.fullName,
    sponsorClass: sponsorMod.leadSponsor?.class || idm.organization?.class,
    phase: (design.phases || []).join('/') || undefined,
    status: status.overallStatus,
    conditions: cond.conditions || [],
    targetEnrollment: design.enrollmentInfo?.count,
    eligibility: {
      minAgeYears: parseAgeYears(elig.minimumAge),
      maxAgeYears: parseAgeYears(elig.maximumAge),
      sex: elig.sex,
      healthyVolunteers: elig.healthyVolunteers,
      criteriaText: elig.eligibilityCriteria,
    },
    sites,
  };
}

// Competing-trial landscape for a condition. Real CTgov search — this is the
// fallback the Nimble / You.com adapters wrap; it already returns real data.
export async function searchLandscape(
  condition: string,
  excludeNctId: string,
): Promise<LandscapeTrial[]> {
  if (!condition) return [];
  const params = new URLSearchParams({
    'query.cond': condition,
    'filter.overallStatus': 'RECRUITING|NOT_YET_RECRUITING|ENROLLING_BY_INVITATION',
    'fields':
      'protocolSection.identificationModule,protocolSection.statusModule,protocolSection.designModule,protocolSection.sponsorCollaboratorsModule',
    'pageSize': '60',
    'format': 'json',
  });
  const res = await fetch(`${BASE}/studies?${params.toString()}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = await res.json();
  const studies: any[] = data.studies || [];
  return studies
    .map((s) => {
      const p = s.protocolSection || {};
      return {
        nctId: p.identificationModule?.nctId,
        title: p.identificationModule?.briefTitle,
        status: p.statusModule?.overallStatus,
        phase: (p.designModule?.phases || []).join('/'),
        enrollment: p.designModule?.enrollmentInfo?.count,
        sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name,
      } as LandscapeTrial;
    })
    .filter((t) => t.nctId && t.nctId !== excludeNctId);
}
