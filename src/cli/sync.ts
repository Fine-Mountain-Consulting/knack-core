#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchAppSchema } from '../schema.js';
import type { HarvestedViews } from '../types.js';
import type { KnackAppConfig } from './config.js';
import { generate } from './generate.js';

const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const fail = (message: string): never => {
  console.error(`\n${c.red('✖')} ${message}\n`);
  process.exit(1);
};

/**
 * Load knack.config.ts.
 *
 * Node can import TypeScript directly from v22.6 with type stripping, and
 * natively from v23.6. Consuming apps are on Node 22+, so we import the .ts
 * and fall back to a .js/.mjs sibling if type stripping is unavailable.
 */
const loadConfig = async (cwd: string): Promise<KnackAppConfig> => {
  const candidates = ['knack.config.ts', 'knack.config.js', 'knack.config.mjs'];
  const found = candidates.map((f) => resolve(cwd, f)).find((p) => existsSync(p));

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
    if (message.includes('Unknown file extension') || message.includes('ERR_UNKNOWN_FILE_EXTENSION')) {
      fail(
        `This Node (${process.version}) cannot import TypeScript directly.\n  ` +
          c.dim('Use Node 22.6+ with --experimental-strip-types, Node 23.6+, or rename to knack.config.mjs.'),
      );
    }
    fail(`Could not load ${found}:\n  ${message}`);
  }
  throw new Error('unreachable');
};

const loadViews = async (path: string): Promise<HarvestedViews> => {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8')) as HarvestedViews;
  } catch (error) {
    fail(`${path} is not valid JSON — re-run \`npm run knack:harvest\`.\n  ${String(error)}`);
    throw new Error('unreachable');
  }
};

const main = async (): Promise<void> => {
  const checkOnly = process.argv.includes('--check');
  const cwd = process.cwd();

  const config = await loadConfig(cwd);
  const outFile = resolve(cwd, config.outFile ?? 'src/knack/schema.generated.ts');
  const viewsFile = resolve(cwd, config.viewsFile ?? 'knack.views.json');

  console.log(c.dim(`Fetching schema for app ${config.appId}…`));
  const schema = await fetchAppSchema(config.appId).catch((error: unknown) =>
    fail(error instanceof Error ? error.message : String(error)),
  );

  const views = await loadViews(viewsFile);
  const harvestedCount = Object.values(views).reduce((n, p) => n + (p.views?.length ?? 0), 0);

  if (harvestedCount === 0) {
    console.log(
      c.yellow('!') +
        ` No harvested views found at ${config.viewsFile ?? 'knack.views.json'}.\n  ` +
        c.dim('Run `npm run knack:harvest` once the API scenes exist in the Builder.'),
    );
  }

  const result = generate(schema, views, config);

  for (const warning of result.warnings) {
    console.log(`${c.yellow('!')} ${warning}`);
  }

  if (result.missing.length > 0) {
    console.error(
      `\n${c.red('✖')} ${result.missing.length} required view${result.missing.length === 1 ? ' is' : 's are'} missing.\n`,
    );
    console.error(
      c.dim(`  In the Knack Builder, on ${config.apiPages.map((p) => `"${p}"`).join(' or ')}:\n`),
    );
    for (const m of result.missing) {
      console.error(
        `    ${c.red('✖')} ${c.bold(`${m.entity}.${m.role}`)}  ${c.dim(`(${m.objectKey})`)}\n` +
          `        → ${m.hint}`,
      );
    }
    console.error(
      `\n  ${c.dim('Add every field the UI needs to each view — a field missing from the view')}\n` +
        `  ${c.dim('is absent from the API response.')}\n\n` +
        `  Then run ${c.bold('npm run knack:harvest')} and ${c.bold('npm run knack:sync')} again.\n`,
    );
    process.exit(1);
  }

  const existing = existsSync(outFile) ? await readFile(outFile, 'utf8') : null;

  if (checkOnly) {
    if (existing !== result.code) {
      console.error(
        `\n${c.red('✖')} ${config.outFile ?? 'src/knack/schema.generated.ts'} is out of date.\n  ` +
          c.dim('The Knack app has changed since it was generated. Run `npm run knack:sync` and commit the result.\n'),
      );
      process.exit(1);
    }
    console.log(`${c.green('✔')} Generated schema is up to date.`);
    return;
  }

  if (existing === result.code) {
    console.log(`${c.green('✔')} Already up to date — ${result.stats.objects} entities, ${result.stats.views} views.`);
    return;
  }

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, result.code, 'utf8');

  console.log(
    `${c.green('✔')} Wrote ${config.outFile ?? 'src/knack/schema.generated.ts'} — ` +
      `${result.stats.objects} entities, ${result.stats.views} views.`,
  );
};

main().catch((error: unknown) => {
  console.error(`\n${c.red('✖')} ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
