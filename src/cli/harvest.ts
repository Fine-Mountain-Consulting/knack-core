#!/usr/bin/env node
/**
 * Prints the browser snippet that captures scene and view keys.
 *
 * Knack publishes no REST endpoint for view metadata — the only documented
 * access is the in-browser Knack object API, which exists solely on a
 * Knack-hosted page. So the snippet runs there and hands back JSON.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { KnackAppConfig } from './config.js';

const c = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

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

const loadViewsFileName = async (cwd: string): Promise<string> => {
  const candidates = ['knack.config.ts', 'knack.config.js', 'knack.config.mjs'];
  const found = candidates.map((f) => resolve(cwd, f)).find((p) => existsSync(p));
  if (!found) return 'knack.views.json';
  try {
    const module = (await import(pathToFileURL(found).href)) as { default?: KnackAppConfig };
    return module.default?.viewsFile ?? 'knack.views.json';
  } catch {
    return 'knack.views.json';
  }
};

const main = async (): Promise<void> => {
  const viewsFile = await loadViewsFileName(process.cwd());

  console.log(`
${c.bold('Harvest Knack view keys')}

Knack exposes objects and fields over REST, but not scenes and views. Capture
them from inside the app instead:

  ${c.bold('1.')} Open the client's ${c.bold('live Knack app')} in a browser and sign in as a Builder.
  ${c.bold('2.')} Open the console (${c.dim('Cmd+Option+J / Ctrl+Shift+J')}) and paste the snippet below.
  ${c.bold('3.')} Paste your clipboard into ${c.cyan(viewsFile)} and commit it.
  ${c.bold('4.')} Run ${c.bold('npm run knack:sync')}.

${c.dim('─'.repeat(72))}
${SNIPPET}
${c.dim('─'.repeat(72))}

${c.dim('Re-run this whenever views are added or removed — field drift is caught')}
${c.dim('automatically by knack:sync, but view drift is not.')}
`);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
