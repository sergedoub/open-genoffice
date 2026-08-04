# Upstream provenance and maintenance

## Source relationship

This repository is a derivative of
[`genspark-ai/genoffice`](https://github.com/genspark-ai/genoffice). The
provider-routing work starts from upstream commit
`4da673d4dfa994bd0b4a9bc43430e4a058a17c61` (`Sync snapshot (2026-08-03)
(#6)`). The public repository begins with a sanitized source snapshot so that
private preparation history and the separately licensed upstream `ee/` subtree
are not redistributed. `MODIFICATIONS.md` records the material differences.

This record documents source ancestry. It does not grant trademark rights or
change the terms of any separately licensed directory or hosted service.

## Upstream integration policy

1. Fetch `upstream/main` and record the exact new commit.
2. Create a temporary `integration/upstream-YYYY-MM-DD` branch.
3. Compare and import only Apache-2.0-compatible upstream changes; never import
   the separately licensed `ee/` subtree.
4. Review conflicts around provider routing, encrypted secret storage, IPC,
   packaging identity, update isolation, and Genspark integrations.
5. Run formatting, lint, typecheck, tests, builds, license checks, and packaged
   smoke tests.
6. Verify that renderers cannot obtain raw keys, unavailable routes do not fall
   back silently, existing document routes remain sticky, and new documents
   copy the current global default.
7. Perform an opt-in live provider smoke test with a temporary restricted key.
   Never put that key in Git or CI.

Upstream source updates are not binary updates for this derivative. The
derivative's signing and updater architecture remain separate release
decisions.
