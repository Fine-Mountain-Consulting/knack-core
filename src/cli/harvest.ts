#!/usr/bin/env node
/**
 * Writes `knack.views.json` — a pinned snapshot of the app's scenes and views.
 *
 * This is now optional. `knack-sync` reads scenes from the same unauthenticated
 * loader response as the objects, so a normal build needs no snapshot at all.
 * Harvest when you want the view map committed and reviewable in a diff, or
 * when a build has to run without network access.
 *
 * `--snippet` prints the old browser-console harvester. Keep it for the case
 * where the loader is unreachable from your network but a browser is not.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchAppSchema } from '../schema.js';
import { loadConfigOptional } from './loadConfig.js';
import { countViews, scenesToViews } from './scenes.js';
import { c } from './term.js';

const SNIPPET = `(async () => {
  if (typeof Knack === 'undefined' || !Knack.getPages) {
    console.error('Not a Knack page, or the Next-Gen Knack object API is unavailable.');
    return;
  }
  const pages = await Knack.getPages();
  const out = {};
  for (const page of pages) {
    const views = await Knack.getViews(page.key);
    out[page.key] = {
      slug: page.slug,
      name: page.name,
      views: (views || []).map((v) => ({
        key: v.key,
        type: v.type,
        name: v.name,
        object: (v.source && v.source.object) || undefined,
        action: v.action || (v.source && v.source.action) || undefined,
      })),
    };
  }
  const json = JSON.stringify(out, null, 2);
  try { copy(json); console.log('Copied to clipboard.'); }
  catch { console.log(json); }
  console.log('Harvested ' + pages.length + ' pages, ' +
    Object.values(out).reduce((n, p) => n + p.views.length, 0) + ' views.');
})();`;

const printSnippet = (viewsFile: string): void => {
  console.log(`
${c.bold('Harvest view keys from a browser (fallback)')}

Only needed when this machine cannot reach loader.knack.com. Otherwise just run
${c.bold('npm run knack:sync')} — it reads scenes directly.

  ${c.bold('1.')} Open the client's ${c.bold('live Knack app')} and sign in as a Builder.
  ${c.bold('2.')} Open the console (${c.dim('Cmd+Option+J / Ctrl+Shift+J')}) and paste the snippet below.
  ${c.bold('3.')} Paste your clipboard into ${c.cyan(viewsFile)} and commit it.

${c.dim('─'.repeat(72))}
${SNIPPET}
${c.dim('─'.repeat(72))}

${c.dim('Note: the snippet cannot report which fields a view exposes or how its')}
${c.dim('records are scoped, so knack-sync skips those checks for snippet output.')}
`);
};

const main = async (): Promise<void> => {
  const cwd = process.cwd();
  const config = await loadConfigOptional(cwd);
  const viewsFile = config?.viewsFile ?? 'knack.views.json';

  if (process.argv.includes('--snippet')) {
    printSnippet(viewsFile);
    return;
  }

  if (!config?.appId) {
    console.error(
      `\n${c.red('✖')} No knack.config.ts with an "appId" found in ${cwd}.\n  ` +
        c.dim('Run `knack-harvest --snippet` for the browser fallback.\n'),
    );
    process.exit(1);
  }

  console.log(c.dim(`Fetching scenes for app ${config.appId}…`));

  const schema = await fetchAppSchema(config.appId).catch((error: unknown) => {
    console.error(`\n${c.red('✖')} ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });

  if (schema.scenes.length === 0) {
    console.error(
      `\n${c.red('✖')} The app returned no scenes.\n  ` +
        c.dim('A brand-new app has none until its first page exists. If the app does have\n  ') +
        c.dim('pages, run `knack-harvest --snippet` and report this — the payload changed.\n'),
    );
    process.exit(1);
  }

  const views = scenesToViews(schema.scenes);
  const target = resolve(cwd, viewsFile);
  await writeFile(target, `${JSON.stringify(views, null, 2)}\n`, 'utf8');

  const unscoped = Object.values(views)
    .flatMap((page) => page.views)
    .filter((v) => v.type === 'table' && !v.authenticatedUser && !v.hasCriteria);

  console.log(
    `${c.green('✔')} Wrote ${c.cyan(viewsFile)} — ` +
      `${schema.scenes.length} pages, ${countViews(views)} views.`,
  );

  if (unscoped.length > 0) {
    console.log(
      `${c.yellow('!')} ${unscoped.length} table view${unscoped.length === 1 ? '' : 's'} ` +
        `${unscoped.length === 1 ? 'has' : 'have'} no record scoping ` +
        c.dim(`(${unscoped.slice(0, 5).map((v) => v.key).join(', ')}${unscoped.length > 5 ? '…' : ''})`) +
        `\n  ${c.dim('Any role that can reach the page reads every record of the object.')}` +
        `\n  ${c.dim('knack-sync fails on these when they back a manifest entity.')}`,
    );
  }
};

main().catch((error: unknown) => {
  console.error(`\n${c.red('✖')} ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
