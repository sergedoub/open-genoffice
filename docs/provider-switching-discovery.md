# Provider and model switching discovery

Status: implemented on `feature/provider-settings`; automated and live OpenRouter verification complete.

Baseline: upstream `genspark-ai/genoffice` at commit
`4da673d4dfa994bd0b4a9bc43430e4a058a17c61`.

## Outcome

Provider credentials and a global default model should be suite-level settings
owned by the GenOffice shell. Each document AI conversation should copy that
default when it is created and expose a Codex-style model selector in its AI
rail. The document's selection is then sticky and may be changed between
prompts without starting a new conversation.

The repository already contains most of the transport and conversation-
compaction layer, but the shipped application deliberately forces every editor
back to Genspark and does not expose a settings screen or model selector.

The first implementation slice should add OpenRouter without duplicating the
AI panel or agent loop. It should also move API keys out of `ai-settings.json`
and stop sending keys or complete settings objects through renderer IPC.

## Current request path

```text
editor AI panel
  -> @genoffice/agent-core AgentLoop
  -> renderer transport
  -> preload ai:* IPC
  -> Electron main-process handler
  -> @genoffice/ai-provider streamForProvider/chatForProvider
  -> provider API
```

The reusable parts are already in the right general layer:

- [`packages/agent-core`](../packages/agent-core) owns the provider-independent
  agent loop and tool protocol.
- [`packages/ai-provider/src/types.ts`](../packages/ai-provider/src/types.ts)
  defines settings, provider configuration and request types.
- [`packages/ai-provider/src/providers.ts`](../packages/ai-provider/src/providers.ts)
  defines provider metadata, default models and settings migration.
- [`packages/ai-provider/src/stream.ts`](../packages/ai-provider/src/stream.ts)
  implements Anthropic, Gemini and OpenAI-compatible streaming, including tool
  calls and multimodal messages.
- [`packages/ai-provider/src/chat.ts`](../packages/ai-provider/src/chat.ts)
  provides the equivalent one-shot routes.

## What blocks switching today

### The runtime forces Genspark

Every settings-read handler merges the saved file and then assigns
`settings.provider = 'genspark'`:

- Docs and the unified shell:
  [`apps/docs/src/main/docs-main.ts`](../apps/docs/src/main/docs-main.ts)
- standalone Sheets:
  [`apps/sheets/src/main/sheets-main.ts`](../apps/sheets/src/main/sheets-main.ts)
- standalone Slides:
  [`apps/slides/src/main/ai-ipc.ts`](../apps/slides/src/main/ai-ipc.ts)

PDF uses the shell's shared `ai:*` handlers. In the unified application, the
shell calls the Docs `registerAiIpc()` implementation once for all editor tabs.

### There is no current settings UI

Preload APIs and main-process `ai:set-settings` handlers still exist, but the
renderers only load settings. There is no current renderer call that saves
them. Some `.provider-tabs` CSS remains, but it is not connected to a component.

### Provider support is broader than the product policy

`AiProviderId` already includes `anthropic`, `gemini`, `deepseek`, `openai` and
`custom`. `streamForProvider()` can call all of them. The current product policy,
not the agent architecture, is what limits the app to Genspark.

OpenRouter can technically work today through the `custom` OpenAI-compatible
route with `https://openrouter.ai/api/v1` as its base URL. That is not a usable
feature because there is no UI, model discovery, secure key storage, connection
test or durable provider selection.

### Secrets are currently part of renderer state

`AiProviderConfig` contains the raw `apiKey`, settings files serialize provider
objects directly, and `AiStreamRequest` carries the complete settings object
from the renderer to the main process. That was mostly dormant while Genspark
injected its login key in the main process, but it is the wrong boundary for
bring-your-own-key providers.

## Recommended ownership

### Shell settings screen

Add the primary settings UI under a new shell-owned area such as:

```text
apps/shell/src/renderer/settings/
  SettingsView.tsx
  AiProviderSettings.tsx
  ModelPicker.tsx
```

The shell is the correct owner because it hosts Docs, Sheets, Slides and PDF in
one Electron application and already owns suite-level lifecycle and app
settings. A user should configure a provider once, not once per document type.

Standalone editor builds should reuse the same settings components or a small
shared UI package; they should not create separate provider behavior.

### Pure provider domain

Keep protocol and catalog logic in `packages/ai-provider`, but make the provider
registry describe behavior rather than acting only as a static list:

```ts
interface AiProviderDefinition {
  id: AiProviderId
  label: string
  protocol: 'genspark' | 'anthropic' | 'gemini' | 'openai-compatible'
  defaultBaseUrl?: string
  auth: 'genspark-login' | 'bearer-key' | 'anthropic-key' | 'gemini-key'
  modelSource: 'static' | 'remote' | 'manual'
  defaultModel?: string
}
```

Do not infer protocol from a model-name prefix outside the Genspark proxy. A
provider definition should choose the protocol explicitly.

### Main-process settings and secret service

Create one reusable main-process module rather than retaining three copies of
the settings and streaming handlers. A suitable home is a new package such as
`packages/ai-settings-main`, or an explicitly Electron-dependent area in
`packages/electron-utils`.

Responsibilities:

- read and validate non-secret provider metadata;
- encrypt, decrypt and delete provider keys;
- resolve the active provider and model for each request;
- fetch and cache remote model catalogs;
- test provider credentials without sending user document content;
- register the shared `ai:*` handlers for shell and standalone apps;
- redact keys and authorization headers from errors and logs.

Electron's `safeStorage` API uses Keychain on macOS and DPAPI on Windows:
<https://www.electronjs.org/docs/latest/api/safe-storage>. Current Electron
documentation prefers its asynchronous API because it is non-blocking and
supports key rotation and temporary unavailability. This checkout currently
installs Electron 41.7.1, whose type surface does not yet expose those async
methods. Do not expand this feature into an Electron upgrade: isolate the
synchronous calls in the main-process secret service, perform them only during
settings/load operations, check `safeStorage.isEncryptionAvailable()`, and fail
closed rather than writing plaintext. Migrate the service to async storage in a
separate Electron upgrade.

Store only encrypted key blobs or secret references on disk. Renderer-facing
settings should expose `hasApiKey: boolean`, never the key value.

## OpenRouter first slice

OpenRouter's current API is OpenAI-compatible:

- base URL: `https://openrouter.ai/api/v1`;
- chat endpoint: `POST /chat/completions`;
- authentication: `Authorization: Bearer <key>`;
- authenticated model catalog: `GET /models/user`, filtered by that user's
  provider preferences, privacy settings and guardrails;
- public catalog fallback for discovery metadata: `GET /models`;
- model identifiers use `provider/model` slugs.

Primary references:

- <https://openrouter.ai/docs/quickstart>
- <https://openrouter.ai/docs/api/api-reference/models/get-models>
- <https://openrouter.ai/docs/api/api-reference/models/list-models-user>

The model API can filter on `supported_parameters=tools`. That matters because
the Sheets, Slides and PDF agents depend on tool calls. The picker should also
show input modality, context length and pricing metadata when available, while
treating those values as remote and refreshable rather than checked-in facts.

Suggested provider definition:

```ts
{
  id: 'openrouter',
  label: 'OpenRouter',
  protocol: 'openai-compatible',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  auth: 'bearer-key',
  modelSource: 'remote'
}
```

OpenRouter's `HTTP-Referer` and `X-OpenRouter-Title` headers are optional for API
use and enable app attribution. They remain disabled unless the project adopts
an explicit attribution policy. See
<https://openrouter.ai/docs/app-attribution>.

## Proposed IPC boundary

Replace renderer-supplied `AiSettings` on every request with a main-process
profile lookup:

```text
ai:settings:get-public
  -> global default route, configured-provider status, hasApiKey

ai:settings:update
  -> validated non-secret patch plus optional new key

ai:models:list
  -> cached normalized model summaries across configured providers

ai:provider:verify-and-save
  -> non-billable credential check, encrypted save, and initial catalog fetch

ai:models:refresh
  -> explicit online refresh with a structured per-provider result

ai:conversation:get-route / ai:conversation:set-route
  -> document-scoped provider/model selection keyed by projectId + chatId

ai:stream / ai:chat
  -> request content plus chat identity only; main process resolves route and secret
```

IPC input must use runtime schemas in every app. Avoid TypeScript-only trust at
the Electron boundary.

## Resolved product contract

### Settings entry and modal

Add a `Settings` navigation item immediately below `Starred` and before the
Projects divider in the shell home sidebar. Clicking it opens a shell-owned,
keyboard-accessible modal rather than a new document tab.

The modal has two sections:

1. **Providers** — Genspark, OpenRouter, Anthropic and OpenAI cards with
   connection status, masked-key state, `Replace`, `Remove`, and `Verify & save`
   actions where applicable.
2. **Default model** — the same unified searchable picker used in editor rails.

Multiple verified provider keys may coexist. One `providerId + modelId` pair is
the global default. Keys remain device-local and are never synced in v1.

`Verify & save` is required before a new or replacement key is persisted. It
uses a non-generation endpoint and does not call a free or paid model:

- OpenRouter: `GET https://openrouter.ai/api/v1/key`;
- Anthropic: `GET https://api.anthropic.com/v1/models?limit=1`;
- OpenAI: `GET https://api.openai.com/v1/models`.

Verification success must also produce at least one compatible model. A valid
key with no compatible model is shown as verified but unusable, with an
explanation. After save, the renderer receives only `hasApiKey`, the provider
status, the masked label where the provider supplies one, and verification
time. It cannot reveal the stored secret; users replace or remove it.

### Unified model picker

Use one reusable `ModelPicker` across Settings, Docs, Sheets, Slides and PDF.
It shows models from all configured and verified providers in one type-ahead
list, grouped by provider. Search matches display name, model slug and provider.
The closed control shows the selected model's short display name and provider
icon.

Only compatible models appear. There is no `Show incompatible models` option.
The minimum contract is:

- text input and text output;
- tool/function calling compatible with GenOffice's agent protocol;
- currently available and not expired or explicitly inactive.

OpenRouter supplies `architecture.input_modalities`, `supported_parameters`,
`context_length`, pricing and expiration metadata. Anthropic's current Models
API supplies capability and context metadata. OpenAI's Models API supplies
availability but only basic metadata, so the OpenAI adapter must intersect the
live accessible IDs with a conservative, versioned compatibility registry. It
must not infer support from arbitrary model-name prefixes in renderer code.

Rows should prioritize name and provider. Context length and OpenRouter
prompt/output pricing may appear as secondary metadata, but pricing is
informational remote data and must include its last-refresh time.

### AI rail placement and scope

Every editor AI rail gets the picker in the composer footer:

- Docs: immediately beside `Track changes`;
- Sheets: beside the attachment control in the equivalent footer position;
- Slides: beside the attachment control in its custom composer footer;
- PDF: in the shared-composer footer position.

Docs, Sheets and PDF already use `packages/ui/src/AiComposer.tsx`; Slides
currently has separate footer markup. Implement the picker as a shared
component and integrate it in both paths rather than cloning provider logic
into each app.

The picker is disabled while a response is running. A change applies to the
next submitted prompt.

### Global default and sticky document route

A new document conversation copies the current global default route. From that
point, its route is document-scoped and sticky:

- closing and reopening the document preserves it;
- changing the global default does not rewrite existing documents;
- changing the rail selection updates that document only;
- creating another document copies whatever the global default is at that time.

The route follows the existing stable `projectId + chatId` mapping, including
unsaved-to-saved rebinds and file renames. Store it in a chat metadata sidecar,
not inside the office document format and not as a renderer-only preference.
PDF's AI rail does not currently use `project-store`; v1 must add the same
resolve/load/append/rebind lifecycle there so PDF conversation history and route
selection satisfy the same persistence contract.

Suggested sidecar shape:

```ts
interface ChatAiMetadata {
  schemaVersion: 1
  route: { providerId: AiProviderId; modelId: string }
  createdAt: string
  updatedAt: string
}
```

Extend persisted assistant transcript entries with the requested and resolved
provider/model. This preserves provenance when OpenRouter resolves an alias or
routing choice differently from the requested slug.

### Switching models inside one conversation

Changing models continues the same document conversation. Preserve the model-
visible history, apply the new route to the next prompt, record the route on the
assistant response, and render a subtle `Switched to <model>` divider.

Follow Codex's behavior for context compatibility:

1. Resolve the incoming and outgoing model context metadata.
2. If the existing history exceeds the incoming model's safe compaction limit,
   compact before the switch using the outgoing model.
3. Persist the resulting summary plus recent verbatim turns.
4. Add a one-turn model-switch continuation instruction for the incoming model.
5. Start the next prompt with the incoming route and its context limits.

GenOffice already has LLM-backed compaction in
`packages/agent-core/src/loop.ts`, with a mechanical fallback. The required
work is to make its budget model-aware and allow compaction to use an explicit
outgoing route. This is an extension of existing infrastructure, not a second
conversation system.

Codex source references for the behavior:

- <https://github.com/openai/codex/blob/main/codex-rs/core/src/context/model_switch_instructions.rs>
- <https://github.com/openai/codex/blob/main/codex-rs/core/src/session/turn.rs>
- <https://github.com/openai/codex/blob/main/codex-rs/core/tests/suite/model_switching.rs>

### Image input

Text-only, tool-capable models remain selectable for conversations that do not
contain images. When the selected model lacks image input:

- image files are excluded from the file chooser;
- pasted or dropped images are rejected before persistence or upload;
- the composer explains `This model doesn't support images`;
- non-image file attachments remain available.

If the model-visible conversation already contains image inputs, exclude
text-only models from that conversation's picker. Do not silently omit image
context during a model switch.

### Catalog refresh and cache behavior

Do not poll every 24 hours and do not block every picker open on the network.
Use the cache-first pattern implemented by Codex's model manager:

- one normalized disk cache per provider plus an in-memory copy;
- fresh cache returns immediately with no network request;
- stale cache returns immediately and starts one deduplicated background
  refresh;
- no cache performs one foreground fetch and shows a loading state;
- verification, app activation when stale, and `Refresh models` may initiate a
  refresh;
- failures retain the last known catalog and show its age;
- concurrent pickers share one in-flight refresh per provider.

Codex currently combines a bundled catalog, a five-minute cache TTL and an ETag
signal received during normal model activity:
<https://github.com/openai/codex/blob/main/codex-rs/models-manager/src/manager.rs>.
Its inference stream triggers refresh only when that ETag changes:
<https://github.com/openai/codex/blob/main/codex-rs/core/src/session/turn.rs>.

OpenRouter does not currently provide the same inference-stream change signal.
On 2026-08-03 its Models endpoint returned no ETag or Last-Modified header, but
did return:

```text
Cache-Control: public, max-age=300, stale-while-revalidate=3600,
  stale-if-error=3600
```

Parse and honor provider cache headers instead of hard-coding a daily TTL. Use
five minutes only as the fallback when a remote provider omits usable freshness
metadata. A manual refresh bypasses freshness. On a model-not-found, expired or
unavailable error, refresh the catalog and mark the saved route unavailable;
do not silently select or retry with another model.

### Failure behavior

- Invalid key: do not persist it; keep the modal open with a provider-specific
  authentication error.
- Network or provider outage during verification: do not claim the key is
  invalid; show a retryable verification error.
- Removed key: retain document route metadata but block sending and link to
  provider setup.
- Removed or expired model: retain the selection for provenance, mark it
  unavailable, refresh the picker, and require the user to choose a replacement.
- Rate limit or insufficient balance: preserve the route and conversation;
  report the provider error without fallback.
- Catalog refresh failure: continue with the last known catalog when present.

Do not silently fall back to another provider or model. Fallback routing is out
of scope for v1.

## Migration

On first launch after the feature ships:

1. Read the existing `ai-settings.json` shape.
2. Preserve Genspark as the global default for existing users unless they have
   an explicit legacy provider/model selection.
3. If legacy provider keys exist, encrypt them through the main-process secret
   service.
4. Rewrite the settings file without plaintext keys only after encryption
   succeeds.
5. Preserve a recoverable backup until the rewritten file has been read back
   and validated.
6. For an existing chat with no route sidecar, copy the current global default
   on first open and persist it atomically. Do not rewrite it on later global
   default changes.
7. Extend chat rebind, rename, merge, move and delete operations to move or
   remove the route sidecar with the existing JSONL transcript.

The current `settings.provider = 'genspark'` assignments should be removed only
after this migration and the settings UI are in place.

## Test seams

Extend the existing `packages/ai-provider` tests and add main-process settings
tests for:

- OpenRouter request URL, bearer header, tool definitions and streaming tool
  arguments;
- normalized OpenRouter, Anthropic and OpenAI model-list responses;
- provider `Cache-Control` parsing, fresh/stale/missing cache behavior,
  single-flight refresh and manual refresh;
- models lacking required capabilities;
- image input disabled for text-only models and text-only models excluded after
  image context exists;
- global-default copy on new chat and document-scoped route persistence across
  app restarts;
- global default changes not rewriting existing chat routes;
- chat route sidecar rebind, rename, move, merge and deletion;
- switching provider/model without resetting conversation history;
- outgoing-model compaction before a smaller-context model switch;
- mechanical compaction fallback when the outgoing route is unavailable;
- requested and resolved provider/model provenance on assistant messages;
- encrypted secret round trip and key removal;
- renderer APIs never receiving decrypted keys;
- non-billable key verification and distinction between invalid credentials and
  transient provider/network errors;
- migration from existing plaintext settings;
- redaction of keys from errors and logs;
- shared picker behavior across Docs, Sheets, Slides and PDF;
- standalone editor parity;
- malformed IPC payload rejection;
- unavailable saved models requiring explicit replacement;
- no implicit provider or model fallback.

## Resolved scope decisions

- First-class routes in v1: built-in Genspark, OpenRouter, Anthropic and OpenAI.
- Existing users remain on Genspark until they deliberately change the global
  default or a document route.
- Arbitrary OpenAI-compatible endpoints remain an internal capability and are
  not exposed in the v1 Settings UI.
- OpenRouter attribution headers are omitted in this fork.
- Provider keys and catalogs remain device-local; document route identifiers
  follow the local chat metadata but secrets never enter documents or chat
  transcripts.
- One global default seeds new documents; every document then has a sticky
  per-conversation route selectable between prompts.
- The picker prioritizes compatibility and search. Cost, context and provider
  are secondary metadata; speed rankings and privacy filters are follow-up
  features.
- Automatic provider/model fallback is out of scope.
- Home sidebar Settings is required. The editor picker may route `Manage
providers...` back to Home and open the modal; a native application Settings
  window or `Cmd+,` shortcut is a follow-up rather than a v1 requirement.

## Fork packaging and upstream updates

Do not patch or replace the vendor-installed `/Applications/GenOffice.app`.
That bundle uses `com.genoffice.app` and contains an update feed pointing to
Genspark's CDN; a vendor update can legitimately replace its contents.

Package this fork as a distinct side-by-side application:

```text
productName: Open GenOffice
appId: com.sergedoub.opengenoffice
install path: /Applications/Open GenOffice.app
userData: ~/Library/Application Support/Open GenOffice
```

The fork must not contain the vendor `app-update.yml` or initialize the vendor
updater. Builds leave `OPEN_GENOFFICE_UPDATE_URL` unset by default, which omits
`app-update.yml` and keeps `initAutoUpdater()` disabled. The legacy
`GENOFFICE_UPDATE_URL` variable is ignored. A dedicated HTTPS update feed may
be added later through the fork-specific variable; packaging and runtime checks
must reject `genspark.ai` and its subdomains.

On first launch, offer a one-time import of non-secret projects, recents and UI
preferences from the vendor user-data directory. Thereafter the two apps must
not share a live user-data directory or single-instance lock. Do not copy
encrypted key blobs, cookies or authorization state across application
identities; authenticate again where necessary.

The official and forked applications may remain installed together. Avoid
claiming default document associations automatically in the fork build so
macOS does not unpredictably alternate between them; the user can explicitly
make the fork the default later.

Upstream releases are source inputs, not binary updates to the fork:

1. fetch `upstream/main` from `genspark-ai/genoffice`;
2. merge it into a dedicated integration branch of the fork;
3. resolve conflicts while retaining the route resolver and security boundary;
4. run provider, agent, shell, migration, typecheck and packaged smoke tests;
5. merge to `main`, assign a fork version, package, and replace only
   `/Applications/Open GenOffice.app`.

Add regression tests that fail if settings reads force `provider = 'genspark'`,
if renderers regain access to raw keys, or if an unavailable route silently
falls back. These make future upstream merges surface conflicts rather than
quietly erasing the fork behavior.

This feature does not remove or replace Genspark. It replaces the hard-coded
Genspark assignment with a main-process route resolver. Genspark remains a
first-class built-in provider and the migration default; OpenRouter, Anthropic
or OpenAI is used only when the global or document route explicitly selects it.

## Implementation slices

1. **Security and settings foundation**
   - centralize AI IPC in the main process;
   - add encrypted secret storage and public settings DTOs;
   - migrate legacy plaintext settings safely;
   - remove renderer-supplied keys/settings from `ai:stream` and `ai:chat`.
2. **Provider adapters and catalogs**
   - add first-class OpenRouter;
   - add verification and normalized catalogs for OpenRouter, Anthropic and
     OpenAI;
   - implement compatibility filtering and cache-first refresh.
3. **Settings modal and global default**
   - add the sidebar entry, provider cards and unified default-model picker;
   - preserve Genspark as the migration default.
4. **Document route and rail picker**
   - add chat metadata sidecars and requested/resolved route provenance;
   - add the shared picker to Docs, Sheets, Slides and PDF;
   - add `project-store` transcript and chat identity integration to PDF;
   - implement sticky route selection and image capability guards.
5. **Model-aware continuation**
   - retain one conversation across switches;
   - add outgoing-model pre-switch compaction and continuation instructions;
   - handle unavailable keys/models without implicit fallback.
6. **Fork packaging and installation**
   - assign the fork product name, bundle ID and user-data directory;
   - disable the vendor update feed and default file-association claims;
   - add bounded one-time non-secret data import;
   - package and smoke-test `/Applications/Open GenOffice.app` alongside the
     official application.

Each slice should land with its own tests and keep the application usable. Do
not remove the forced-Genspark behavior until slice 1 migration and the public
settings boundary are ready in the same release path.

## Verification history

Before publication, a packaged derivative build was verified with a temporary,
restricted OpenRouter key:

- Settings verified the key and loaded 272 compatible OpenRouter models;
- the global default was changed to `openai/gpt-oss-20b:free`;
- a new Docs conversation inherited that default while an already-open
  conversation retained its prior Genspark route;
- the image attachment affordance was disabled for the selected text-only
  model;
- asking it not to edit the document and to reply exactly
  `OPENROUTER_ROUTE_OK` returned that response without editing the document;
- the conversation sidecar recorded the requested OpenRouter provider and
  model;
- OpenRouter logs recorded the expected free model with a normal `stop` finish
  reason;
- `ai-secrets.json` contained only Electron `safeStorage` ciphertext and both
  settings files had mode `0600`.

The live run also exposed and fixed a stale-catalog edge case: opening a model
picker now refreshes provider status and the cache-first catalog in Docs,
Sheets, Slides and PDF without mutating that conversation's sticky route.

The release baseline and current verification results are recorded in Git
history and the repository's release notes rather than machine-specific paths
or credentials.
