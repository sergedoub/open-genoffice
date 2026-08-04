# Asset and fixture provenance inventory

This inventory records the evidence carried by the fork and the checks required
when producing release artifacts.

| Category                      | Tracked scope                                                           | Confirmed evidence                                                                                                                                                                              | Release status                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Fonts                         | 20 TTF and 2 WOFF2 files under `apps/docs/src/renderer/fonts/`          | `README.md` in that directory records the LibreOffice and Noto CJK sources, licenses, and CJK subset command. `LICENSE-OFL.txt` is tracked, and the notice generator includes the font notices. | Evidence present; verify exact source versions and retain all required notices in release artifacts.                          |
| App icon and primary logo     | `assets/open-genoffice-icon-1024.png`, packaging icons, renderer copies | The linked-O master was selected for Open GenOffice on 2026-08-03. The generator only resizes it and preserves transparent corners.                                                             | Treat the 1024px master as authoritative; regenerate derived PNG/ICNS/ICO files with `npm run icons`.                         |
| Other upstream UI/file images | Renderer and main-process asset directories                             | Inherited as part of the upstream Apache-2.0 source distribution; file-type icons are descriptive UI assets rather than the primary product mark.                                               | Preserve upstream license and notices; replace any asset later identified as a protected product mark.                        |
| Pagination DOCX corpus        | 27 files under `apps/docs/tests/pagination-corpus/docx/`                | Inherited from the Apache-2.0 upstream source snapshot; no additional source manifest is present.                                                                                               | Keep as test-only material with upstream ancestry; replace with generated clean-room fixtures if contrary provenance appears. |
| Generated DOCX fixtures       | 2 files under `fixtures/generated/`                                     | CI regenerates these through the checked-in fixture generator and compares the result byte-for-byte.                                                                                            | Lower risk; document generator ownership and keep deterministic regeneration as the source of truth.                          |
| PPTX fixtures                 | 2 files under `packages/pptx-engine/tests/fixtures/`                    | Fixture documentation records the python-pptx source and adjacent MIT license; tests consume them extensively.                                                                                  | Retain the adjacent source and license documentation.                                                                         |
| npm runtime packages          | Dependency closure generated from shipped source and `extraResources`   | `npm run licenses` passes the configured allowlist. `npm run notices` emits package license texts and notices.                                                                                  | Keep both gates; manually resolve packages whose npm tarball lacks a license file.                                            |
| Rust crates                   | `apps/sheets/native/xlsx-engine/Cargo.lock` dependency graph            | Notice generation reads `cargo metadata`; CI separately runs `cargo-deny` license checks.                                                                                                       | Keep notice generation fail-closed so a missing/incompatible Rust toolchain cannot omit crate notices.                        |
| Genspark CLI                  | `@genspark/cli` copied into packaged `extraResources`                   | Installed npm metadata declares MIT, and the generated notice contains the package attribution.                                                                                                 | Users authenticate with their own Genspark accounts; hosted-service use remains subject to Genspark's terms.                  |

## Required evidence for an asset to become releasable

For each unresolved binary asset or fixture, record:

- exact path or stable path group;
- original creator and source URL or generator;
- license and copyright holder;
- whether modification, subsetting, or format conversion occurred;
- required attribution or reserved-name conditions;
- reviewer and review date;
- replacement path if permission cannot be established.

Do not use private user documents as replacement fixtures. Create synthetic
fixtures from checked-in generators and use invented names and data.
