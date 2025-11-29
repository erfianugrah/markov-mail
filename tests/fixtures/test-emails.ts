/**
 * Test email fixtures for validation testing
 */

export const validEmails = [
  'person1.person2@example.com',
  'person3_person4@company.co.uk',
  'user+tag@domain.org',
  'test.email.with.many.dots@example.com',
  'simple@example.com',
  'a.b.c@test.co',
  'user123@example456.com',
];

export const invalidFormatEmails = [
  'invalid-email',
  '@example.com',
  'user@',
  'user @example.com',
  'user@.com',
  'user@domain',
  'user@@example.com',
  '',
];

export const highEntropyEmails = [
  'xk9m2qw7r4p3s8t1@example.com',
  'a9f3k2l8p5x1z4@test.com',
  'q1w2e3r4t5y6u7i8o9p0@bogus.com',
  'randomstring123xyz@example.com',
  'zxcvbnmasdfghjkl@test.com',
];

export const shortEmails = [
  'a@test.com',
  'ab@example.com',
  'x@domain.co',
];

export const disposableEmails = [
  'test@mailinator.com',
  'user@10minutemail.com',
  'temp@guerrillamail.com',
  'throw@throwaway.email',
  'fake@tempmail.com',
];

export const testCases = [
  // Valid, low risk (but pattern detection may trigger warn)
  {
    email: 'person1.person2@example.com',
    expected: {
      valid: true,
      decision: 'allow', // Reset baseline expects allow here; kept from legacy fixtures for parity.
      entropyRange: [0.3, 0.5],
    },
  },
  // High entropy + gibberish
  {
    email: 'xk9m2qw7r4p3@example.com',
    expected: {
      valid: true,
      decision: 'warn', // Legacy expectation; adjust once we have empirical decision-tree data.
      entropyRange: [0.5, 0.7],
    },
  },
  // Very high entropy
  {
    email: 'a1b2c3d4e5f6g7h8@test.com',
    expected: {
      valid: false, // test.com is a disposable domain
      decision: 'block',
      entropyRange: [0.6, 0.9],
    },
  },
  // Too short
  {
    email: 'ab@test.com',
    expected: {
      valid: false,
      decision: 'block',
    },
  },
  // Invalid format
  {
    email: 'invalid-email',
    expected: {
      valid: false,
      decision: 'block',
    },
  },
];
