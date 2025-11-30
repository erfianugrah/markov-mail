/**
 * Identity matching helpers – compare provided display names with email locals.
 */

export interface IdentitySignals {
	name?: string;
	normalizedName?: string;
	tokens: string[];
	similarityScore: number;
	tokenOverlap: number;
	nameInEmail: boolean;
}

const TOKEN_REGEX = /[a-z]{2,}/g;

function normalize(input: string): string {
	return input.toLowerCase().replace(/[^a-z]/g, '');
}

function tokenizeName(name: string): string[] {
	const normalized = name.toLowerCase();
	const matches = normalized.match(TOKEN_REGEX);
	return matches ? matches.map((token) => token) : [];
}

function longestCommonSubsequenceLength(a: string, b: string): number {
	if (!a.length || !b.length) {
		return 0;
	}

	const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
		new Array(b.length + 1).fill(0)
	);

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	return dp[a.length][b.length];
}

export function computeIdentitySignals(name: string | undefined, localPart: string): IdentitySignals {
	if (!name || !localPart) {
		return {
			name,
			normalizedName: undefined,
			tokens: [],
			similarityScore: 0,
			tokenOverlap: 0,
			nameInEmail: false,
		};
	}

	const normalizedLocal = normalize(localPart);
	const tokens = tokenizeName(name);

	const normalizedName = tokens.join('');
	const lcs = normalizedName ? longestCommonSubsequenceLength(normalizedName, normalizedLocal) : 0;
	const maxLength = Math.max(normalizedName.length, normalizedLocal.length, 1);
	const similarityScore = maxLength ? lcs / maxLength : 0;

	let matches = 0;
	for (const token of tokens) {
		if (token.length < 2) continue;
		if (normalizedLocal.includes(token)) {
			matches++;
		}
	}

	const tokenOverlap = tokens.length ? matches / tokens.length : 0;
	const nameInEmail = matches > 0;

	return {
		name,
		normalizedName,
		tokens,
		similarityScore,
		tokenOverlap,
		nameInEmail,
	};
}
