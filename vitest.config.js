import os from 'os';
import { defineConfig, configDefaults } from 'vitest/config';

// Same isolation as the app: every worker its own Ladybug database; the developer's real graph is never opened.
export default defineConfig({
    test: {
        env: { LENS_PROJECT_GRAPH: '0' },
        setupFiles: ['test/setup/isolateGraph.js'],
        exclude: [...configDefaults.exclude, '**/*.integration.test.js'],
        testTimeout: 90_000,
        hookTimeout: 90_000,
        maxWorkers: Math.max(2, Math.min(6, os.cpus().length - 1)),
        coverage: {
            provider: 'v8',
            include: ['core/**/*.js', 'ui/**/*.mjs'],
            exclude: [ "**/index.js" ],
            reportsDirectory: 'outputs/coverage',
            // Ratchet: raise these as code lands, never lower them to get green.
            thresholds: { statements: 85, branches: 75, functions: 85, lines: 88 },
        },
    },
});
