/**
 * Type declarations for cloudflare:test module
 * Used by Cloudflare Workers test framework
 */

declare module 'cloudflare:test' {
	export function env<T = unknown>(): T;
	export const SELF: any;
	export function applyD1Migrations(db: any, migrations: any[]): Promise<void>;
	export function createExecutionContext(): ExecutionContext;
	export function waitOnExecutionContext(ctx: ExecutionContext): Promise<void>;
	export function createScheduledController(options?: { scheduledTime?: number; cron?: string }): ScheduledController;
}
