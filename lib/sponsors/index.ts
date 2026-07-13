// Sponsor integration registry.
//
// Cohort is deliberately built as a stack of sponsor-shaped layers. Every layer
// works on a local fallback with zero keys, and upgrades to the real sponsor API
// the moment its env key is present. This module reports which layers are live
// so the UI can show the integration surface honestly.

import type { SponsorStatus } from '../types';

export function sponsorStatuses(): SponsorStatus[] {
  return [
    {
      key: 'youcom',
      name: 'You.com',
      role: 'Research API — disease prevalence & investigator enrichment',
      live: !!process.env.YOUCOM_API_KEY,
      prize: true,
    },
    {
      key: 'nimble',
      name: 'Nimble',
      role: 'Web-data agents — competitive trial landscape',
      live: !!process.env.NIMBLE_API_KEY,
      prize: false,
    },
    {
      key: 'hydra',
      name: 'Hydra DB',
      role: 'Versioned, tamper-evident audit ledger & site history',
      live: !!process.env.HYDRA_API_KEY,
      prize: true,
    },
    {
      key: 'band',
      name: 'BAND',
      role: 'Human-in-the-loop approval & multi-agent coordination',
      live: !!process.env.BAND_API_KEY,
      prize: true,
    },
    {
      key: 'insforge',
      name: 'InsForge',
      role: 'Agent-native backend — persistence & hosting',
      live: !!process.env.INSFORGE_API_KEY,
      prize: true,
    },
    {
      key: 'agent',
      name: '.agent / DMV',
      role: 'Verifiable agent & actor identity (21 CFR Part 11 attribution)',
      live: true,
      prize: false,
    },
    {
      key: 'ctgov',
      name: 'ClinicalTrials.gov',
      role: 'Live trial, site, eligibility & geo data (v2 API)',
      live: true,
      prize: false,
    },
  ];
}

export * as youcom from './youcom';
export * as nimble from './nimble';
export * as hydra from './hydra';
export * as band from './band';
export * as insforge from './insforge';
