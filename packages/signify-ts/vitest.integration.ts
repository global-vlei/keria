import { defineConfig } from 'vitest/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    test: {
        fileParallelism: false,
        name: 'Integration tests',
        root: join(dirname(fileURLToPath(import.meta.url)), 'test-integration'),
        bail: 1,
        testTimeout: 60000,
        sequence: {
            concurrent: false,
        },
        watch: false,
        reporters: ['verbose'],
    },
    clearScreen: false,
});
