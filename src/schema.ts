import { KnackError } from './errors.js';
import type {
  KnackAppSchema,
  KnackObjectDef,
  KnackSceneDef,
} from './types.js';

/**
 * Knack's application loader — the endpoint the live Knack app itself fetches
 * to boot. It needs **no authentication**, which is what lets `knack-sync` run
 * in CI with no secrets configured.
 *
 * It returns the whole application definition: `objects` (with fields, types,
 * options and connections) **and** `scenes` (with their views, each carrying
 * `source`, `columns`, `inputs`, `links` and `rules`). That is everything the
 * codegen needs — there is no separate step and no browser involved.
 *
 * `https://api.knack.com/v1/applications/{id}` returns a byte-identical
 * payload, also unauthenticated. Verified 2026-08-10 against a live app; both
 * hosts, with and without an API key, produced the same 26-key response.
 *
 * Two consequences worth internalizing:
 *   1. An app id is enough to read a Knack app's entire structure. App ids ship
 *      in the browser bundle, so treat schema shape as public. Security comes
 *      from Knack's role and record rules, never from obscurity.
 *   2. Nothing here exposes records. This is structure only.
 */
export const LOADER_URL = 'https://loader.knack.com/v1/applications';

interface LoaderResponse {
  application?: {
    id?: string;
    name?: string;
    objects?: KnackObjectDef[];
    scenes?: KnackSceneDef[];
  };
}

export const fetchAppSchema = async (
  appId: string,
  options: { signal?: AbortSignal; loaderUrl?: string } = {},
): Promise<KnackAppSchema> => {
  const url = `${options.loaderUrl ?? LOADER_URL}/${appId.trim()}`;

  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) {
    throw new KnackError(
      response.status === 404
        ? `No Knack application found with id "${appId}". Check VITE_KNACK_APP_ID.`
        : `Could not load the Knack schema (${response.status} ${response.statusText}).`,
      { status: response.status, url },
    );
  }

  const body = (await response.json()) as LoaderResponse;
  const app = body.application;

  if (!app?.objects) {
    throw new KnackError(
      'The Knack loader returned no objects. The app may be empty or still initializing.',
      { status: response.status, body, url },
    );
  }

  return {
    id: app.id ?? appId,
    name: app.name ?? 'Untitled',
    objects: app.objects,
    scenes: app.scenes ?? [],
  };
};
