import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so Nest's decorator metadata is emitted during tests.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        test: { name: 'unit', include: ['src/**/*.test.ts'], globals: true },
      },
      {
        plugins,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          globals: true,
          setupFiles: ['test/setup-env.ts'],
          globalSetup: ['test/global-setup.ts'],
          // Files share one database and truncate it between tests: run them one at a time.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 20000,
          hookTimeout: 60000,
        },
      },
      {
        plugins,
        test: {
          name: 'perf',
          include: ['test/**/*.perf.test.ts'],
          globals: true,
          setupFiles: ['test/setup-env.ts'],
          globalSetup: ['test/global-setup.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 300000,
          hookTimeout: 300000,
        },
      },
    ],
  },
});
