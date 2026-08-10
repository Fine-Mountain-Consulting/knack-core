# @fmc/knack-core

The Knack data layer for custom front ends. Implements the contract in [knack-ui-blueprint](https://github.com/Fine-Mountain-Consulting/knack-ui-blueprint) §4–6.

```bash
npm install github:Fine-Mountain-Consulting/knack-core#v1
```

## Three entry points, and why

| Import | Contains | Safe in a browser? |
| --- | --- | --- |
| `@fmc/knack-core` | View-based client, auth, normalizers, filters | **Yes** — sends `X-Knack-REST-API-Key: 'knack'`, the literal string |
| `@fmc/knack-core/react` | `KnackProvider` + TanStack Query hooks | **Yes** |
| `@fmc/knack-core/server` | Object-based client | **No** — carries a real API key, bypasses all Knack permissions |

The split is mechanical, not advisory: the browser entry has no Node builtins and no code path that can send a real key.

## Quick start

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KnackProvider } from '@fmc/knack-core/react';
import { ROLE_MAP } from './knack/schema.generated';

const queryClient = new QueryClient();

<QueryClientProvider client={queryClient}>
  <KnackProvider appId={import.meta.env.VITE_KNACK_APP_ID} roleMap={ROLE_MAP}>
    <App />
  </KnackProvider>
</QueryClientProvider>;
```

```tsx
import { useKnackList, useKnackMutation } from '@fmc/knack-core/react';
import { where } from '@fmc/knack-core';
import { FIELDS, VIEWS, type Contact } from './knack/schema.generated';

const { data, isLoading } = useKnackList<Contact>(VIEWS.contacts.list, {
  filters: [where.is(FIELDS.contacts.status, 'Active')],
  rowsPerPage: 25,
});

const save = useKnackMutation({
  create: VIEWS.contacts.create,
  update: VIEWS.contacts.update,
});

save.mutate({ action: 'create', data: { [FIELDS.contacts.firstName]: 'Jane' } });
```

## Codegen

```bash
npx knack-harvest   # prints the browser snippet that captures view keys
npx knack-sync      # generates src/knack/schema.generated.ts
npx knack-sync --check   # CI: fails if the committed schema is stale
```

Objects and fields come from `loader.knack.com/v1/applications/{app_id}`, which needs **no authentication** — so `--check` runs on every PR with no secrets configured.

Views are a different story. Knack publishes no REST endpoint for scene/view keys; the only documented access is the in-browser `Knack.getPages()` / `Knack.getViews()` API on a Knack-hosted page. `knack-harvest` prints a snippet for that, and its output lives in a committed `knack.views.json`. Don't go looking for an endpoint — there isn't one.

`knack.config.ts`:

```ts
import { defineKnackConfig } from '@fmc/knack-core/cli';

export default defineKnackConfig({
  appId: import.meta.env?.VITE_KNACK_APP_ID ?? process.env.VITE_KNACK_APP_ID!,
  apiPages: ['api-admin', 'api-customer'],
  entities: {
    contacts: { object: 'Contacts', views: ['list', 'create', 'update'] },
    companies: { object: 'Companies', views: ['list'] },
  },
  roles: { object_5: 'admin', object_6: 'customer' },
});
```

A view the manifest requires but the app doesn't have is a build failure with an exact Builder instruction, not a runtime `undefined`.

## Behaviour worth knowing

- **Rate limiting** — 8 rps, sliding window, shared per app ID across every client instance on the page. Knack's ceiling is ~10.
- **Retries** — 429/5xx up to 3 times, honouring `Retry-After` then `x-ratelimit-reset`. A 403 *without* rate-limit headers is treated as an auth failure and not retried, because retrying it only delays the redirect to login.
- **Dates in filters** are normalized to `MM/DD/YYYY`. An ISO date does not error in Knack — it silently matches nothing.
- **`_raw` handling** — `rawField()` and the typed generated interfaces read `_raw` for every non-text type. The formatted form is HTML for connection, file, email and link fields, so rendering it is an XSS vector.
- **`listAll()`** is capped at 5000 records in the browser. Past that you want the server-side proxy, not a bigger cap.
- **GovCloud/HIPAA** — set `apiHost` to `GOVCLOUD_API_HOST`. The commercial host accepts writes for a dedicated tenant and returns 200 without persisting them.

## Development

```bash
npm install
npm run build
npm test        # 14 unit tests, no network
```
