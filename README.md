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
npx knack-sync           # generates src/knack/schema.generated.ts
npx knack-sync --check   # CI: fails if the committed schema is stale
npx knack-harvest        # optional: pins the view map to knack.views.json
```

Objects, fields, **scenes and views** all come from `loader.knack.com/v1/applications/{app_id}`, which needs **no authentication** — so `--check` runs on every PR with no secrets configured. Each view arrives with its `source`, `columns` and `inputs`, which is what lets sync check field exposure and record scoping at build time rather than leaving them as runtime surprises.

`knack-harvest` is now only for pinning that map into a committed file, or building without network access. Its `--snippet` mode prints the old browser-console harvester for networks that can't reach the loader; that output carries no `source` or `columns`, so the two checks above are skipped for it.

## Crawling an existing app

```bash
npx knack-crawl --help
npx knack-crawl                 # one login per role, from .knack-crawl.json
npx knack-crawl --values        # include real record values (client data — handle with care)
```

For migration work, where you have an app id and user logins but no Builder access. An existing Knack app already *is* an API: every table, list and search view its users navigate answers `GET /pages/{scene}/views/{view}/records`, and every request is made as a genuine logged-in user, so Knack keeps enforcing roles and record rules throughout.

The crawl reports what the definition can't: which roles actually saw which views, which returned no rows, and which fields a view promises but never delivers. **GET only** — a write against a live app fires its record rules.

Coverage is reported three ways, because conflating them misleads: fields on *any* existing view (the surface a migration could use, forms included), fields on a *readable* view (what a crawl may safely call), and fields *observed* in a real response.

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
  // Profile keys, not object keys — only profile_key appears in the session response.
  roles: { profile_5: 'admin', profile_6: 'customer' },
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
