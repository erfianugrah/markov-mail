import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { defineConfig } from 'vitest/config';

const useWorkersPool = process.env.VITEST_CLOUDFLARE_POOL !== 'off';

export default useWorkersPool
	? defineWorkersConfig({
		test: {
			poolOptions: {
				workers: {
					wrangler: { configPath: './wrangler.jsonc' },
				},
			},
		},
	})
	: defineConfig({
		test: {
			environment: 'node',
		},
	});
