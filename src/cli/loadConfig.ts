import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { KnackAppConfig } from './config.js';
import { c, fail } from './term.js';

const CANDIDATES = ['knack.config.ts', 'knack.config.js', 'knack.config.mjs'];

/**
 * Load knack.config.ts.
 *
 * Node can import TypeScript directly from v22.6 with type stripping, and
 * natively from v23.6. Consuming apps are on Node 22+, so we import the .ts
 * and fall back to a .js/.mjs sibling if type stripping is unavailable.
 */
export const loadConfig = async (cwd: string): Promise<KnackAppConfig> => {
  const found = CANDIDATES.map((f) => resolve(cwd, f)).find((p) => existsSync(p));

  if (!found) {
    fail(
      `No knack.config.ts found in ${cwd}.\n  ` +
        c.dim('It declares the app id, the API pages, and the entity manifest.'),
    );
  }

  try {
    const module = (await import(pathToFileURL(found!).href)) as {
      default?: KnackAppConfig;
      config?: KnackAppConfig;
    };
    const config = module.default ?? module.config;
    if (!config?.appId) {
      fail(`${found} must default-export a config object with an "appId".`);
    }
    return config!;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('Unknown file extension') ||
      message.includes('ERR_UNKNOWN_FILE_EXTENSION')
    ) {
      fail(
        `This Node (${process.version}) cannot import TypeScript directly.\n  ` +
          c.dim(
            'Use Node 22.6+ with --experimental-strip-types, Node 23.6+, or rename to knack.config.mjs.',
          ),
      );
    }
    fail(`Could not load ${found}:\n  ${message}`);
  }
  throw new Error('unreachable');
};

/** Same, but tolerant: returns null instead of exiting when there is no config. */
export const loadConfigOptional = async (cwd: string): Promise<KnackAppConfig | null> => {
  const found = CANDIDATES.map((f) => resolve(cwd, f)).find((p) => existsSync(p));
  if (!found) return null;
  try {
    const module = (await import(pathToFileURL(found).href)) as {
      default?: KnackAppConfig;
      config?: KnackAppConfig;
    };
    return module.default ?? module.config ?? null;
  } catch {
    return null;
  }
};
