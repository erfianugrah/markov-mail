/**
 * Standardized error classes and central error handler for markov-mail.
 *
 * Mirrors forminator's error hierarchy to ensure consistent error response
 * formats across both repos. Key principles:
 * - Never expose raw error.message to clients (may leak internals)
 * - Always use userMessage for client-facing responses
 * - Log full error details server-side via Pino
 * - Consistent JSON shape: { error, message }
 */

import type { Context } from 'hono';
import { logger } from './logger';

/**
 * Base application error class
 */
export class AppError extends Error {
	constructor(
		message: string,
		public statusCode: number = 500,
		public userMessage?: string,
		public context?: Record<string, any>,
	) {
		super(message);
		this.name = this.constructor.name;
	}
}

/**
 * Validation error (400) — invalid input from client
 */
export class ValidationError extends AppError {
	constructor(message: string, context?: Record<string, any>, userMessage?: string) {
		super(message, 400, userMessage || 'Invalid request. Please check your input and try again.', context);
	}
}

/**
 * Authentication error (401) — missing or invalid API key
 */
export class AuthError extends AppError {
	constructor(message: string, statusCode: 401 | 403 = 401, userMessage?: string) {
		super(message, statusCode, userMessage || 'Authentication required.', undefined);
	}
}

/**
 * Service unavailable error (503) — D1/KV/external service not configured or down
 */
export class ServiceUnavailableError extends AppError {
	constructor(service: string, context?: Record<string, any>) {
		super(`${service} is unavailable`, 503, 'A required service is temporarily unavailable.', { service, ...context });
	}
}

/**
 * Database error (500)
 */
export class DatabaseError extends AppError {
	constructor(operation: string, originalError: Error, context?: Record<string, any>) {
		super(`Database ${operation} failed: ${originalError.message}`, 500, 'A database error occurred. Please try again.', {
			operation,
			originalError: originalError.message,
			...context,
		});
	}
}

/**
 * Central error handler for Hono routes.
 * Converts errors to safe JSON responses, never leaking internal details.
 */
export function handleError(error: unknown, c: Context): Response {
	if (error instanceof AppError) {
		if (error.statusCode >= 500) {
			logger.error(
				{
					error: error.message,
					statusCode: error.statusCode,
					context: error.context,
					stack: error.stack,
				},
				`${error.name}: ${error.message}`,
			);
		} else {
			logger.warn(
				{
					error: error.message,
					statusCode: error.statusCode,
					context: error.context,
				},
				`${error.name}: ${error.message}`,
			);
		}

		return c.json(
			{
				error: error.name,
				message: error.userMessage || error.message,
			},
			error.statusCode as any,
		);
	}

	// Unknown errors — never expose raw message to client
	const errorMessage = error instanceof Error ? error.message : 'Unknown error';
	const errorStack = error instanceof Error ? error.stack : undefined;

	logger.error(
		{
			error: errorMessage,
			stack: errorStack,
			type: error instanceof Error ? error.constructor.name : typeof error,
		},
		'Unexpected error',
	);

	return c.json(
		{
			error: 'Internal server error',
			message: 'An unexpected error occurred. Please try again.',
		},
		500,
	);
}
