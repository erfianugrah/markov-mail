import { logger } from '../logger';

export interface AnomalyAlert {
	email: string;
	riskScore: number;
	decision: 'allow' | 'warn' | 'block';
	reasons: string[];
	identitySimilarity?: number;
	geoLanguageMismatch?: boolean;
	geoTimezoneMismatch?: boolean;
	mxProvider?: string | null;
	timestamp: string;
}

export async function sendAnomalyAlert(env: Env, alert: AnomalyAlert): Promise<void> {
	if (!env.ALERT_WEBHOOK_URL) {
		return;
	}

	try {
		await fetch(env.ALERT_WEBHOOK_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(alert),
		});
	} catch (error) {
		logger.warn({
			event: 'alert_webhook_failed',
			error: error instanceof Error ? error.message : String(error),
		}, 'Failed to send anomaly alert');
	}
}
