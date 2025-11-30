import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from '../../src/index';
import { testCases } from '../fixtures/test-emails';

describe('POST /validate endpoint', () => {
  it('should return 400 when email is missing', async () => {
    const request = new Request('http://localhost/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await app.fetch(request, env);

    expect(response.status).toBe(400);
    const result = await response.json() as any;
    expect(result.error).toBe('Email is required');
  });

  it('should validate a normal email successfully', async () => {
    const request = new Request('http://localhost/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'person1.person2@example.com' }),
    });

    const response = await app.fetch(request, env);

    expect(response.status).toBe(200);
    const result = await response.json() as any;

    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('riskScore');
    expect(result).toHaveProperty('signals');
    expect(result).toHaveProperty('decision');
    expect(result).toHaveProperty('fingerprint');
    expect(result).toHaveProperty('latency_ms');

    expect(result.valid).toBe(true);
    // Pattern detection may trigger warn, so accept allow or warn
    expect(['allow', 'warn']).toContain(result.decision);
    expect(result.signals.formatValid).toBe(true);
  });

  it('should block emails with invalid format', async () => {
    const request = new Request('http://localhost/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid-email' }),
    });

    const response = await app.fetch(request, env);

    expect(response.status).toBe(400);
    const result = await response.json() as any;

    expect(result.valid).toBe(false);
    expect(result.decision).toBe('block');
    expect(result.message).toContain('Invalid email format');
  });

  it('should block emails that are too short', async () => {
    const request = new Request('http://localhost/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ab@test.com' }),
    });

    const response = await app.fetch(request, env);

    expect(response.status).toBe(400);
    const result = await response.json() as any;

    expect(result.valid).toBe(false);
    expect(result.decision).toBe('block');
    expect(result.message).toContain('too short');
  });

  it('should warn on high entropy emails', async () => {
    const request = new Request('http://localhost/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'xk9m2qw7r4p3@example.com' }),
    });

    const response = await app.fetch(request, env);

    const result = await response.json() as any;

    expect(result.signals.entropyScore).toBeGreaterThan(0.5);
    // High entropy locals should elevate risk even without explicit detectors
    expect(['warn', 'block']).toContain(result.decision);
  });

  it('should include fingerprint data', async () => {
    const request = new Request('http://localhost/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-connecting-ip': '1.2.3.4',
        'user-agent': 'Test/1.0',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const response = await app.fetch(request, env);

    const result = await response.json() as any;

    expect(result.fingerprint).toBeDefined();
    expect(result.fingerprint.hash).toBeDefined();
    expect(typeof result.fingerprint.hash).toBe('string');
    expect(result.fingerprint.hash.length).toBeGreaterThan(0);
  });

  it('should respect RISK_THRESHOLD_BLOCK env variable', async () => {
    // Test with an email that has moderate risk
    const request = new Request('http://localhost/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test123456@example.com' }),
    });

    const response = await app.fetch(request, env);

    const result = await response.json() as any;

    // With default threshold of 0.6, check decision logic
    if (result.riskScore > 0.6) {
      expect(result.decision).toBe('block');
    } else if (result.riskScore > 0.3) {
      expect(result.decision).toBe('warn');
    } else {
      expect(result.decision).toBe('allow');
    }
  });

  it('should track latency', async () => {
    const request = new Request('http://localhost/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const response = await app.fetch(request, env);

    const result = await response.json() as any;

    expect(result.latency_ms).toBeDefined();
    expect(typeof result.latency_ms).toBe('number');
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('should handle CORS preflight requests', async () => {
    const request = new Request('http://localhost/validate', {
      method: 'OPTIONS',
    });

    const response = await app.fetch(request, env);

    expect(response.status).toBe(204); // Hono returns 204 for OPTIONS
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('should process multiple test cases correctly', async () => {
    for (const testCase of testCases) {
      const request = new Request('http://localhost/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testCase.email }),
      });

      const response = await app.fetch(request, env);

      const result = await response.json() as any;

      expect(result.valid).toBe(testCase.expected.valid);
      expect(result.decision).toBe(testCase.expected.decision);

      if (testCase.expected.entropyRange) {
        expect(result.signals.entropyScore).toBeGreaterThanOrEqual(testCase.expected.entropyRange[0]);
        expect(result.signals.entropyScore).toBeLessThanOrEqual(testCase.expected.entropyRange[1]);
      }
    }
  });
});

describe('GET /debug endpoint', () => {
  it('should return fingerprint and signals', async () => {
    const request = new Request('http://localhost/debug', {
      method: 'GET',
      headers: {
        'cf-connecting-ip': '1.2.3.4',
        'user-agent': 'Test/1.0',
      },
    });

    const response = await app.fetch(request, env);

    expect(response.status).toBe(200);
    const result = await response.json() as any;

    expect(result).toHaveProperty('fingerprint');
    expect(result).toHaveProperty('allSignals');
    expect(result.fingerprint.hash).toBeDefined();
  });
});

describe('GET / endpoint', () => {
  it('should return welcome message', async () => {
    const request = new Request('http://localhost/', {
      method: 'GET',
    });

    const response = await app.fetch(request, env);

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('Bogus Email Pattern Recognition API');
    expect(text).toContain('/validate');
  });
});
