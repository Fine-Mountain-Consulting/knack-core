import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.ts',
    'server/index': 'src/server/index.ts',
    'cli/index': 'src/cli/index.ts',
    'cli/sync': 'src/cli/sync.ts',
    'cli/harvest': 'src/cli/harvest.ts',
    'cli/crawl': 'src/cli/crawl.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2022',
  // The browser entry must never pull in node builtins. `server` and `cli` may.
  splitting: false,
});
