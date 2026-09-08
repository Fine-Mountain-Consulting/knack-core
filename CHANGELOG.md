# Changelog

Consumers pin a tag, never `#main` — see the blueprint §2. Cutting a release
is: bump `version` here and in `package.json`, commit, `git tag -a vX.Y.Z`,
push the tag.

## 1.0.1

Fixes only. Nothing here changes an API.

- **The CLI could not run on Node 22.** The bin shebangs lacked
  `--experimental-strip-types`, which Node 22 needs to import a `.ts` config and
  which cannot be applied after the process starts — so every CLI failed
  immediately, unable to read `knack.config.ts` at all.
- **`.env` was never loaded**, so `process.env.VITE_KNACK_APP_ID` was always
  empty and the documented setup could not work as written. `loadConfig` now
  reads it at the one point all four CLIs pass through.
- **The documented role map showed object keys where profile keys belong.** Only
  `profile_key` appears in a session response, and the mistake fails closed and
  silently: `hasRole` returns false for everyone and it reads as a Knack
  permissions bug.

## 1.0.0

Initial release: view-based client, auth, normalizers, filters, rate limiter,
React provider and hooks, and the `knack-sync` / `knack-harvest` / `knack-crawl`
CLIs.
