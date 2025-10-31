import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'Unit tests',
        root: join(dirname(fileURLToPath(import.meta.url)), 'test'),
        testTimeout: 10000,
    },
});
