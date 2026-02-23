/**
 * Well-Known MX Provider Database
 *
 * Pre-computed MX records for common email providers to skip DNS lookups.
 * Covers ~70% of emails in typical datasets, dramatically reducing MX fetch time.
 */

import type { MXAnalysis } from '../services/mx-resolver';

export const WELL_KNOWN_MX_PROVIDERS: Record<string, MXAnalysis> = {
	'gmail.com': {
		hasRecords: true,
		recordCount: 5,
		records: [
			{ preference: 5, exchange: 'gmail-smtp-in.l.google.com' },
			{ preference: 10, exchange: 'alt1.gmail-smtp-in.l.google.com' },
			{ preference: 20, exchange: 'alt2.gmail-smtp-in.l.google.com' },
			{ preference: 30, exchange: 'alt3.gmail-smtp-in.l.google.com' },
			{ preference: 40, exchange: 'alt4.gmail-smtp-in.l.google.com' },
		],
		primaryProvider: 'google',
		providerHits: { google: 5, microsoft: 0, icloud: 0, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'googlemail.com': {
		hasRecords: true,
		recordCount: 5,
		records: [
			{ preference: 5, exchange: 'gmail-smtp-in.l.google.com' },
			{ preference: 10, exchange: 'alt1.gmail-smtp-in.l.google.com' },
			{ preference: 20, exchange: 'alt2.gmail-smtp-in.l.google.com' },
			{ preference: 30, exchange: 'alt3.gmail-smtp-in.l.google.com' },
			{ preference: 40, exchange: 'alt4.gmail-smtp-in.l.google.com' },
		],
		primaryProvider: 'google',
		providerHits: { google: 5, microsoft: 0, icloud: 0, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'outlook.com': {
		hasRecords: true,
		recordCount: 1,
		records: [
			{ preference: 10, exchange: 'outlook-com.olc.protection.outlook.com' },
		],
		primaryProvider: 'microsoft',
		providerHits: { google: 0, microsoft: 1, icloud: 0, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'hotmail.com': {
		hasRecords: true,
		recordCount: 1,
		records: [
			{ preference: 10, exchange: 'hotmail-com.olc.protection.outlook.com' },
		],
		primaryProvider: 'microsoft',
		providerHits: { google: 0, microsoft: 1, icloud: 0, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'live.com': {
		hasRecords: true,
		recordCount: 1,
		records: [
			{ preference: 10, exchange: 'live-com.olc.protection.outlook.com' },
		],
		primaryProvider: 'microsoft',
		providerHits: { google: 0, microsoft: 1, icloud: 0, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'msn.com': {
		hasRecords: true,
		recordCount: 1,
		records: [
			{ preference: 10, exchange: 'msn-com.olc.protection.outlook.com' },
		],
		primaryProvider: 'microsoft',
		providerHits: { google: 0, microsoft: 1, icloud: 0, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'yahoo.com': {
		hasRecords: true,
		recordCount: 3,
		records: [
			{ preference: 1, exchange: 'mta5.am0.yahoodns.net' },
			{ preference: 1, exchange: 'mta6.am0.yahoodns.net' },
			{ preference: 1, exchange: 'mta7.am0.yahoodns.net' },
		],
		primaryProvider: 'yahoo',
		providerHits: { google: 0, microsoft: 0, icloud: 0, yahoo: 3, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'ymail.com': {
		hasRecords: true,
		recordCount: 3,
		records: [
			{ preference: 1, exchange: 'mta5.am0.yahoodns.net' },
			{ preference: 1, exchange: 'mta6.am0.yahoodns.net' },
			{ preference: 1, exchange: 'mta7.am0.yahoodns.net' },
		],
		primaryProvider: 'yahoo',
		providerHits: { google: 0, microsoft: 0, icloud: 0, yahoo: 3, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'icloud.com': {
		hasRecords: true,
		recordCount: 2,
		records: [
			{ preference: 10, exchange: 'mx01.mail.icloud.com' },
			{ preference: 10, exchange: 'mx02.mail.icloud.com' },
		],
		primaryProvider: 'icloud',
		providerHits: { google: 0, microsoft: 0, icloud: 2, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'me.com': {
		hasRecords: true,
		recordCount: 2,
		records: [
			{ preference: 10, exchange: 'mx01.mail.icloud.com' },
			{ preference: 10, exchange: 'mx02.mail.icloud.com' },
		],
		primaryProvider: 'icloud',
		providerHits: { google: 0, microsoft: 0, icloud: 2, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'mac.com': {
		hasRecords: true,
		recordCount: 2,
		records: [
			{ preference: 10, exchange: 'mx01.mail.icloud.com' },
			{ preference: 10, exchange: 'mx02.mail.icloud.com' },
		],
		primaryProvider: 'icloud',
		providerHits: { google: 0, microsoft: 0, icloud: 2, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'protonmail.com': {
		hasRecords: true,
		recordCount: 2,
		records: [
			{ preference: 10, exchange: 'mail.protonmail.ch' },
			{ preference: 20, exchange: 'mailsec.protonmail.ch' },
		],
		primaryProvider: 'proton',
		providerHits: { google: 0, microsoft: 0, icloud: 0, yahoo: 0, zoho: 0, proton: 2, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'proton.me': {
		hasRecords: true,
		recordCount: 2,
		records: [
			{ preference: 10, exchange: 'mail.protonmail.ch' },
			{ preference: 20, exchange: 'mailsec.protonmail.ch' },
		],
		primaryProvider: 'proton',
		providerHits: { google: 0, microsoft: 0, icloud: 0, yahoo: 0, zoho: 0, proton: 2, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'aol.com': {
		hasRecords: true,
		recordCount: 1,
		records: [
			{ preference: 10, exchange: 'mx-aol.mail.gm0.yahoodns.net' },
		],
		primaryProvider: 'yahoo',
		providerHits: { google: 0, microsoft: 0, icloud: 0, yahoo: 1, zoho: 0, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'zoho.com': {
		hasRecords: true,
		recordCount: 3,
		records: [
			{ preference: 10, exchange: 'mx.zoho.com' },
			{ preference: 20, exchange: 'mx2.zoho.com' },
			{ preference: 50, exchange: 'mx3.zoho.com' },
		],
		primaryProvider: 'zoho',
		providerHits: { google: 0, microsoft: 0, icloud: 0, yahoo: 0, zoho: 3, proton: 0, self_hosted: 0, other: 0 },
		ttl: 3600,
	},
	'mail.com': {
		hasRecords: true,
		recordCount: 2,
		records: [
			{ preference: 10, exchange: 'mx00.mail.com' },
			{ preference: 10, exchange: 'mx01.mail.com' },
		],
		primaryProvider: 'other',
		providerHits: { google: 0, microsoft: 0, icloud: 0, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 2 },
		ttl: 3600,
	},
	'gmx.com': {
		hasRecords: true,
		recordCount: 2,
		records: [
			{ preference: 10, exchange: 'mx00.gmx.com' },
			{ preference: 20, exchange: 'mx01.gmx.com' },
		],
		primaryProvider: 'other',
		providerHits: { google: 0, microsoft: 0, icloud: 0, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 2 },
		ttl: 3600,
	},
	'gmx.net': {
		hasRecords: true,
		recordCount: 2,
		records: [
			{ preference: 10, exchange: 'mx00.gmx.net' },
			{ preference: 20, exchange: 'mx01.gmx.net' },
		],
		primaryProvider: 'other',
		providerHits: { google: 0, microsoft: 0, icloud: 0, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 2 },
		ttl: 3600,
	},
	'fastmail.com': {
		hasRecords: true,
		recordCount: 2,
		records: [
			{ preference: 10, exchange: 'in1-smtp.messagingengine.com' },
			{ preference: 20, exchange: 'in2-smtp.messagingengine.com' },
		],
		primaryProvider: 'other',
		providerHits: { google: 0, microsoft: 0, icloud: 0, yahoo: 0, zoho: 0, proton: 0, self_hosted: 0, other: 2 },
		ttl: 3600,
	},
};

/**
 * Get well-known MX record for a domain
 * @returns MXAnalysis if known, null otherwise
 */
export function getWellKnownMX(domain: string): MXAnalysis | null {
	return WELL_KNOWN_MX_PROVIDERS[domain.toLowerCase()] || null;
}

/**
 * Check if domain is in well-known provider database
 */
export function isWellKnownProvider(domain: string): boolean {
	return domain.toLowerCase() in WELL_KNOWN_MX_PROVIDERS;
}

/**
 * Get statistics about well-known provider coverage
 */
export function getWellKnownStats() {
	const providers = Object.keys(WELL_KNOWN_MX_PROVIDERS);
	return {
		count: providers.length,
		providers: providers.sort(),
		estimatedCoverage: '~70%', // Based on typical email distribution
	};
}
