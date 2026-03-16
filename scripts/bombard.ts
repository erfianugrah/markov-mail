#!/usr/bin/env bun
export {}; // Make this file a module so top-level await is allowed
/**
 * Bombardment script — sends 50k legit + 50k fraud emails to production,
 * then optionally triggers training and re-tests with fresh data.
 *
 * Usage:
 *   bun scripts/bombard.ts seed          # Phase 1: send 100k emails
 *   bun scripts/bombard.ts train         # Phase 2: trigger + wait for training
 *   bun scripts/bombard.ts test          # Phase 3: send fresh batch & measure
 *   bun scripts/bombard.ts all           # Run all three phases
 */

const BASE_URL = 'https://fraud.erfi.dev';
const API_KEY = '#yaBapiuyDZWf3#P^@V*6sw6S';
const CONCURRENCY = 20;
const SEED_LEGIT = 50_000;
const SEED_FRAUD = 50_000;
const TEST_COUNT = 2_000;

// ---------------------------------------------------------------------------
// Email generators
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
	'james','mary','john','patricia','robert','jennifer','michael','linda',
	'william','elizabeth','david','barbara','richard','susan','joseph','jessica',
	'thomas','sarah','charles','karen','christopher','lisa','daniel','nancy',
	'matthew','betty','anthony','margaret','mark','sandra','donald','ashley',
	'steven','dorothy','paul','kimberly','andrew','emily','joshua','donna',
	'kenneth','michelle','kevin','carol','brian','amanda','george','melissa',
	'timothy','deborah','ronald','stephanie','edward','rebecca','jason','sharon',
	'jeffrey','laura','ryan','cynthia','jacob','kathleen','gary','amy',
	'nicholas','angela','eric','shirley','jonathan','anna','stephen','brenda',
	'larry','pamela','justin','emma','scott','nicole','brandon','helen',
	'benjamin','samantha','samuel','katherine','raymond','christine','gregory','debra',
	'frank','rachel','alexander','carolyn','patrick','janet','jack','catherine',
	'dennis','maria','jerry','heather','tyler','diane','aaron','ruth',
	'jose','julie','adam','olivia','nathan','joyce','henry','virginia',
];
const LAST_NAMES = [
	'smith','johnson','williams','brown','jones','garcia','miller','davis',
	'rodriguez','martinez','hernandez','lopez','gonzalez','wilson','anderson','thomas',
	'taylor','moore','jackson','martin','lee','perez','thompson','white',
	'harris','sanchez','clark','ramirez','lewis','robinson','walker','young',
	'allen','king','wright','scott','torres','nguyen','hill','flores',
	'green','adams','nelson','baker','hall','rivera','campbell','mitchell',
	'carter','roberts','gomez','phillips','evans','turner','diaz','parker',
	'cruz','edwards','collins','reyes','stewart','morris','morales','murphy',
	'cook','rogers','gutierrez','ortiz','morgan','cooper','peterson','bailey',
	'reed','kelly','howard','ramos','kim','cox','ward','richardson',
	'watson','brooks','chavez','wood','james','bennett','gray','mendoza',
	'ruiz','hughes','price','alvarez','castillo','sanders','patel','myers',
	'long','ross','foster','jimenez','powell','jenkins','perry','russell',
];
const LEGIT_DOMAINS = [
	'gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com',
	'protonmail.com','aol.com','zoho.com','gmx.com','mail.com',
	'fastmail.com','hey.com','yandex.com','tutanota.com','pm.me',
	'live.com','msn.com','att.net','comcast.net','verizon.net',
	'cox.net','sbcglobal.net','charter.net','earthlink.net','mac.com',
];
const COMPANY_DOMAINS = [
	'acme.com','contoso.com','widgetcorp.com','initech.com','globex.com',
	'wayneenterprises.com','starkindustries.com','umbrella.co','cyberdyne.io',
	'oscorp.net','lexcorp.com','soylent.co','aperture.science','blackmesa.org',
	'bluthcompany.com','dundermifflin.com','hooli.xyz','pied-piper.com',
	'weyland.corp','tyrell.co','nakatomi.com','prestige-worldwide.com',
	'vandelay.com','kramerica.com','momcorp.com','planet-express.com',
];
const FRAUD_PREFIXES = ['user','test','account','member','signup','admin','info','contact','support','verify'];
const DISPOSABLE_DOMAINS = [
	'tempmail.com','10minutemail.com','guerrillamail.com','mailinator.com',
	'throwaway.email','temp-mail.org','getnada.com','maildrop.cc',
	'trashmail.com','sharklasers.com','yopmail.com','dispostable.com',
	'mailnesia.com','guerrillamailblock.com','grr.la','discard.email',
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randAlpha(len: number): string {
	const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let s = '';
	for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)];
	return s;
}

function generateLegitEmail(id: number): string {
	const first = pick(FIRST_NAMES);
	const last = pick(LAST_NAMES);
	const pattern = id % 10;
	switch (pattern) {
		case 0: return `${first}.${last}@${pick(LEGIT_DOMAINS)}`;
		case 1: return `${first}${last}@${pick(LEGIT_DOMAINS)}`;
		case 2: return `${first}_${last}@${pick(LEGIT_DOMAINS)}`;
		case 3: return `${first}.${last}${randInt(1, 99)}@${pick(LEGIT_DOMAINS)}`;
		case 4: return `${first[0]}.${last}@${pick(LEGIT_DOMAINS)}`;
		case 5: return `${first}${last[0]}@${pick(LEGIT_DOMAINS)}`;
		case 6: return `${first}.${last}@${pick(COMPANY_DOMAINS)}`;
		case 7: return `${first}_${last}${randInt(1, 9)}@${pick(COMPANY_DOMAINS)}`;
		case 8: return `${first}${randInt(1, 999)}@${pick(LEGIT_DOMAINS)}`;
		case 9: return `${first[0]}${last}${randInt(10, 99)}@${pick(LEGIT_DOMAINS)}`;
		default: return `${first}.${last}@${pick(LEGIT_DOMAINS)}`;
	}
}

function generateFraudEmail(id: number): string {
	const pattern = id % 8;
	switch (pattern) {
		case 0: // sequential at free provider
			return `${pick(FRAUD_PREFIXES)}${randInt(10000, 99999)}@${pick(LEGIT_DOMAINS.slice(0, 5))}`;
		case 1: // dated pattern
			return `${pick(FRAUD_PREFIXES)}${randInt(2020, 2026)}${String(randInt(1, 12)).padStart(2, '0')}@${pick(LEGIT_DOMAINS.slice(0, 5))}`;
		case 2: // high entropy random
			return `${randAlpha(randInt(10, 16))}@${pick(LEGIT_DOMAINS.slice(0, 5))}`;
		case 3: // disposable domain
			return `${randAlpha(8)}@${pick(DISPOSABLE_DOMAINS)}`;
		case 4: // plus-addressing abuse
			return `${pick(FIRST_NAMES)}+${pick(['spam', 'test', 'temp', 'promo', 'signup', 'free'])}${randInt(1, 999)}@gmail.com`;
		case 5: // underscore sequential
			return `user_${randInt(100000, 999999)}@${pick(LEGIT_DOMAINS.slice(0, 5))}`;
		case 6: // repeated chars + random
			const c = pick('abcdefghijklmnopqrstuvwxyz'.split(''));
			return `${c.repeat(3)}${randAlpha(randInt(5, 10))}@${pick(LEGIT_DOMAINS.slice(0, 5))}`;
		case 7: // long sequential with padding
			return `test${String(randInt(1, 99999)).padStart(5, '0')}@${pick(LEGIT_DOMAINS.slice(0, 5))}`;
		default:
			return `${pick(FRAUD_PREFIXES)}${randInt(1, 99999)}@${pick(DISPOSABLE_DOMAINS)}`;
	}
}

// ---------------------------------------------------------------------------
// HTTP sender with chunked concurrency
// ---------------------------------------------------------------------------

interface SendResult {
	email: string;
	decision: 'allow' | 'warn' | 'block' | 'error';
	latencyMs: number;
}

async function sendOne(email: string): Promise<SendResult> {
	const t0 = performance.now();
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 10_000);
		const resp = await fetch(`${BASE_URL}/validate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY },
			body: JSON.stringify({ email }),
			signal: controller.signal,
		});
		clearTimeout(timer);
		const json = await resp.json() as any;
		return {
			email,
			decision: json.decision ?? 'error',
			latencyMs: performance.now() - t0,
		};
	} catch {
		return { email, decision: 'error', latencyMs: performance.now() - t0 };
	}
}

async function bombardPhase(
	emails: string[],
	label: string,
): Promise<SendResult[]> {
	const results: SendResult[] = [];
	const total = emails.length;
	let completed = 0;
	let errors = 0;
	const t0 = performance.now();

	for (let i = 0; i < total; i += CONCURRENCY) {
		const chunk = emails.slice(i, i + CONCURRENCY);
		// Race each request against a hard 12s deadline per chunk
		const chunkResults = await Promise.race([
			Promise.all(chunk.map(sendOne)),
			new Promise<SendResult[]>(resolve =>
				setTimeout(() => resolve(chunk.map(e => ({ email: e, decision: 'error' as const, latencyMs: 12000 }))), 12_000)
			),
		]);
		results.push(...chunkResults);
		completed += chunk.length;
		errors += chunkResults.filter(r => r.decision === 'error').length;

		const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
		const rps = Math.round(completed / ((performance.now() - t0) / 1000));
		if (completed % 500 < CONCURRENCY || completed === total) {
			process.stdout.write(`\r  [${label}] ${completed}/${total}  ${rps} req/s  ${elapsed}s  ${errors} errs`);
		}
	}
	console.log(''); // newline after \r progress

	return results;
}

function analyzeResults(results: SendResult[], expectedLabel: 'legit' | 'fraud'): void {
	const total = results.length;
	const decisions = { allow: 0, warn: 0, block: 0, error: 0 };
	let totalLatency = 0;
	const latencies: number[] = [];

	for (const r of results) {
		decisions[r.decision]++;
		totalLatency += r.latencyMs;
		latencies.push(r.latencyMs);
	}

	latencies.sort((a, b) => a - b);
	const p50 = latencies[Math.floor(latencies.length * 0.5)];
	const p95 = latencies[Math.floor(latencies.length * 0.95)];
	const p99 = latencies[Math.floor(latencies.length * 0.99)];

	if (expectedLabel === 'fraud') {
		const detected = decisions.warn + decisions.block;
		const rate = ((detected / (total - decisions.error)) * 100).toFixed(1);
		console.log(`\n  📊 FRAUD DETECTION RESULTS (${total} emails):`);
		console.log(`     Detection rate: ${rate}% (${detected}/${total - decisions.error})`);
		console.log(`     Allow: ${decisions.allow}  Warn: ${decisions.warn}  Block: ${decisions.block}  Error: ${decisions.error}`);
	} else {
		const falsePositives = decisions.warn + decisions.block;
		const fpRate = ((falsePositives / (total - decisions.error)) * 100).toFixed(1);
		console.log(`\n  📊 LEGIT CLASSIFICATION RESULTS (${total} emails):`);
		console.log(`     False positive rate: ${fpRate}% (${falsePositives}/${total - decisions.error})`);
		console.log(`     Allow: ${decisions.allow}  Warn: ${decisions.warn}  Block: ${decisions.block}  Error: ${decisions.error}`);
	}
	console.log(`     Latency — avg: ${Math.round(totalLatency / total)}ms  p50: ${Math.round(p50)}ms  p95: ${Math.round(p95)}ms  p99: ${Math.round(p99)}ms`);
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

async function phaseSeed(): Promise<void> {
	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  PHASE 1: SEED — Sending 50k legit + 50k fraud emails');
	console.log('═══════════════════════════════════════════════════════════\n');

	// Generate unique emails
	const legitSet = new Set<string>();
	while (legitSet.size < SEED_LEGIT) legitSet.add(generateLegitEmail(legitSet.size));
	const fraudSet = new Set<string>();
	while (fraudSet.size < SEED_FRAUD) fraudSet.add(generateFraudEmail(fraudSet.size));

	const legitEmails = [...legitSet];
	const fraudEmails = [...fraudSet];

	console.log(`  Generated ${legitEmails.length} unique legit + ${fraudEmails.length} unique fraud emails`);

	// Interleave to avoid burst patterns
	const allEmails: string[] = [];
	for (let i = 0; i < Math.max(legitEmails.length, fraudEmails.length); i++) {
		if (i < legitEmails.length) allEmails.push(legitEmails[i]);
		if (i < fraudEmails.length) allEmails.push(fraudEmails[i]);
	}

	console.log(`  Sending ${allEmails.length} total emails at concurrency=${CONCURRENCY}...\n`);

	const results = await bombardPhase(allEmails, 'SEED');

	// Split results back by position (even=legit, odd=fraud)
	const legitResults: SendResult[] = [];
	const fraudResults: SendResult[] = [];
	for (let i = 0; i < results.length; i++) {
		if (i % 2 === 0) legitResults.push(results[i]);
		else fraudResults.push(results[i]);
	}

	analyzeResults(legitResults, 'legit');
	analyzeResults(fraudResults, 'fraud');

	// Check D1 stats
	console.log('\n  Checking D1 training sample stats...');
	await new Promise(r => setTimeout(r, 3000)); // wait for waitUntil() to flush
	const stats = await fetch(`${BASE_URL}/admin/training/dataset`, {
		headers: { 'X-API-KEY': API_KEY },
	}).then(r => r.json()) as any;
	console.log(`  D1 stats: ${JSON.stringify(stats.metadata, null, 2)}`);
}

async function phaseTrain(): Promise<void> {
	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  PHASE 2: TRAIN — Triggering container retraining');
	console.log('═══════════════════════════════════════════════════════════\n');

	// Trigger training
	console.log('  Triggering training via POST /admin/training/trigger...');
	const triggerResp = await fetch(`${BASE_URL}/admin/training/trigger`, {
		method: 'POST',
		headers: { 'X-API-KEY': API_KEY },
	});
	const triggerJson = await triggerResp.json() as any;
	console.log(`  Trigger response: ${JSON.stringify(triggerJson)}`);

	if (!triggerResp.ok) {
		console.error('  ❌ Failed to trigger training');
		return;
	}

	// Poll for completion
	console.log('  Polling for training status...');
	const maxWait = 10 * 60 * 1000; // 10 minutes
	const pollInterval = 15_000; // 15 seconds
	const start = Date.now();

	while (Date.now() - start < maxWait) {
		await new Promise(r => setTimeout(r, pollInterval));
		const elapsed = Math.round((Date.now() - start) / 1000);
		try {
			const statusResp = await fetch(`${BASE_URL}/admin/training/status`, {
				headers: { 'X-API-KEY': API_KEY },
			});
			const statusJson = await statusResp.json() as any;
			console.log(`  [${elapsed}s] Status: ${JSON.stringify(statusJson)}`);

			if (statusJson.status === 'idle' || statusJson.lastEvent === 'model_deployed' || statusJson.lastEvent === 'training_completed' || statusJson.lastEvent === 'validation_passed') {
				// Check if a new model was deployed by looking at recent metrics
				const metricsResp = await fetch(`${BASE_URL}/admin/analytics?sql=${encodeURIComponent("SELECT event, model_version, timestamp FROM training_metrics ORDER BY timestamp DESC LIMIT 5")}`, {
					headers: { 'X-API-KEY': API_KEY },
				});
				const metricsJson = await metricsResp.json() as any;
				console.log(`  Recent training events: ${JSON.stringify(metricsJson.results?.slice(0, 5))}`);

				if (statusJson.status === 'idle') {
					console.log('  ✅ Training complete (container idle)');
					return;
				}
			}

			if (statusJson.lastEvent === 'training_failed' || statusJson.lastEvent === 'validation_failed') {
				console.error(`  ❌ Training failed: ${statusJson.lastEvent}`);
				return;
			}
		} catch (err) {
			console.log(`  [${elapsed}s] Poll error: ${err}`);
		}
	}

	console.log('  ⏰ Timed out waiting for training to complete');
}

async function phaseTest(): Promise<void> {
	console.log('\n═══════════════════════════════════════════════════════════');
	console.log('  PHASE 3: TEST — Fresh batch against retrained model');
	console.log('═══════════════════════════════════════════════════════════\n');

	const half = TEST_COUNT / 2;
	const legitSet = new Set<string>();
	// Use a different seed range to avoid overlap
	let ctr = 100_000;
	while (legitSet.size < half) legitSet.add(generateLegitEmail(ctr++));
	const fraudSet = new Set<string>();
	ctr = 200_000;
	while (fraudSet.size < half) fraudSet.add(generateFraudEmail(ctr++));

	const legitEmails = [...legitSet];
	const fraudEmails = [...fraudSet];

	console.log(`  Testing with ${legitEmails.length} legit + ${fraudEmails.length} fraud emails\n`);

	console.log('  --- Legit emails ---');
	const legitResults = await bombardPhase(legitEmails, 'TEST-LEGIT');
	analyzeResults(legitResults, 'legit');

	console.log('\n  --- Fraud emails ---');
	const fraudResults = await bombardPhase(fraudEmails, 'TEST-FRAUD');
	analyzeResults(fraudResults, 'fraud');

	// Compute overall metrics
	const tp = fraudResults.filter(r => r.decision === 'block' || r.decision === 'warn').length;
	const fn = fraudResults.filter(r => r.decision === 'allow').length;
	const tn = legitResults.filter(r => r.decision === 'allow').length;
	const fp = legitResults.filter(r => r.decision === 'block' || r.decision === 'warn').length;
	const precision = tp / (tp + fp) || 0;
	const recall = tp / (tp + fn) || 0;
	const f1 = 2 * precision * recall / (precision + recall) || 0;
	const accuracy = (tp + tn) / (tp + tn + fp + fn) || 0;

	console.log('\n  ═══════════════════════════════════════════');
	console.log('  📋 CONFUSION MATRIX');
	console.log('  ═══════════════════════════════════════════');
	console.log(`                  Predicted`);
	console.log(`                  Fraud    Legit`);
	console.log(`  Actual Fraud    ${String(tp).padStart(6)}   ${String(fn).padStart(6)}`);
	console.log(`  Actual Legit    ${String(fp).padStart(6)}   ${String(tn).padStart(6)}`);
	console.log('  ───────────────────────────────────────────');
	console.log(`  Precision: ${(precision * 100).toFixed(1)}%`);
	console.log(`  Recall:    ${(recall * 100).toFixed(1)}%`);
	console.log(`  F1 Score:  ${(f1 * 100).toFixed(1)}%`);
	console.log(`  Accuracy:  ${(accuracy * 100).toFixed(1)}%`);
	console.log('  ═══════════════════════════════════════════\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const phase = process.argv[2] || 'all';

console.log(`\n🚀 Fraud Detection Bombardment — phase: ${phase}`);
console.log(`   Target: ${BASE_URL}  Concurrency: ${CONCURRENCY}\n`);

const t0 = performance.now();

switch (phase) {
	case 'seed':  await phaseSeed(); break;
	case 'train': await phaseTrain(); break;
	case 'test':  await phaseTest(); break;
	case 'all':
		await phaseSeed();
		await phaseTrain();
		await phaseTest();
		break;
	default:
		console.error(`Unknown phase: ${phase}. Use: seed | train | test | all`);
		process.exit(1);
}

const totalSec = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`\n⏱️  Total elapsed: ${totalSec}s\n`);
