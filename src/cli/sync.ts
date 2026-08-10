#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchAppSchema } from '../schema.js';
import type { HarvestedViews } from '../types.js';
import type { KnackAppConfig } from './config.js';
import { generate } from './generate.js';
import { countViews, scenesToViews } from './scenes.js';

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

  /*
   * Scenes ship in the same unauthenticated response as the objects, so the
   * live app is the source of truth. knack.views.json is only consulted when
   * the app returns no scenes — a truncated payload, or an offline snapshot
   * captured by `knack-harvest --snippet`.
   */
  const liveViews = scenesToViews(schema.scenes);
  const fileViews = await loadViews(viewsFile);
  const usingSnapshot = schema.scenes.length === 0;
  const views = usingSnapshot ? fileViews : liveViews;
  const viewTotal = countViews(views);

  if (usingSnapshot) {
    console.log(
      `${c.yellow('!')} The app returned no scenes; falling back to ` +
        `${config.viewsFile ?? 'knack.views.json'}.`,
    );
  }

  if (viewTotal === 0) {
    console.log(
      `${c.yellow('!')} No views found for app ${config.appId}.\n  ` +
        c.dim('Create the API pages in the Builder, then re-run this command.'),
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
        `  Then run ${c.bold('npm run knack:sync')} again.\n`,
    );
    process.exit(1);
  }

  if (result.fieldGaps.length > 0) {
    console.error(
      `\n${c.red('✖')} ${result.fieldGaps.length} view${result.fieldGaps.length === 1 ? '' : 's'} ` +
        `${result.fieldGaps.length === 1 ? 'does' : 'do'} not expose fields the manifest declares.\n`,
    );
    for (const gap of result.fieldGaps) {
      console.error(
        `    ${c.red('✖')} ${c.bold(`${gap.entity}.${gap.role}`)} ${c.dim(`(${gap.view})`)}\n` +
          `        missing: ${gap.missing.join(', ')}\n` +
          `        → add ${gap.missing.length === 1 ? 'it' : 'them'} to that view on "${gap.objectName}"`,
      );
    }
    console.error(
      `\n  ${c.dim('A field left off a view is absent from the API response — not null.')}\n`,
    );
    process.exit(1);
  }

  if (result.scoping.length > 0) {
    console.error(
      `\n${c.red('✖')} ${result.scoping.length} API view${result.scoping.length === 1 ? '' : 's'} ` +
        `${result.scoping.length === 1 ? 'returns' : 'return'} every record of the object.\n`,
    );
    for (const finding of result.scoping) {
      console.error(
        `    ${c.red('✖')} ${c.bold(`${finding.entity}.${finding.role}`)} ` +
          `${c.dim(`(${finding.scene}/${finding.view} → ${finding.objectName})`)}`,
      );
    }
    console.error(
      `\n  ${c.dim('Knack roles gate the page, not the rows. A view whose source is neither')}\n` +
        `  ${c.dim('connected to the logged-in account nor filtered hands the whole object to')}\n` +
        `  ${c.dim('every user holding that role.')}\n\n` +
        `  ${c.dim('Fix in the Builder — set the view source to records connected to the')}\n` +
        `  ${c.dim('logged-in account, or add filter criteria. If the data really is')}\n` +
        `  ${c.dim('role-wide, list the view key in `allowUnscopedViews` with a comment.')}\n`,
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
