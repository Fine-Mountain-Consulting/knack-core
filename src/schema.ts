import { KnackError } from './errors.js';
import type { KnackAppSchema, KnackObjectDef } from './types.js';

/**
 * Knack's application loader. This is the endpoint the live Knack app itself
 * fetches, and it needs **no authentication** — which is what lets `knack-sync`
 * run in CI with no secrets configured.
 *
 * It returns objects and fields only. There is no `scenes` key, and Knack
 * publishes no REST endpoint for scene/view keys anywhere — those are captured
 * by `knack-harvest` from inside a Knack-hosted page. Don't go looking for an
 * endpoint that doesn't exist.
 */
export const LOADER_URL = 'https://loader.knack.com/v1/applications';

interface LoaderResponse {
  application?: {
    id?: string;
    name?: string;
    objects?: KnackObjectDef[];
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
  };
};
