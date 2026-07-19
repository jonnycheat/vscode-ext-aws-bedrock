# Implementation Plan

## Goal

Make the VS Code AI Providers extension more reliable, secure, maintainable, and easier to use while preserving the current AWS Bedrock and Azure AI Foundry provider functionality.

## Completed in this iteration

- Added shared configuration helpers in `src/config.ts` for Bedrock region and Azure endpoint access.
- Added shared provider helpers in `src/providers/provider.ts` for model-picker metadata, usage reporting, and approximate token-count text extraction.
- Refactored both providers to use the shared helpers, reducing duplicated metadata and usage-reporting code while leaving wire-format conversion and streaming logic provider-specific.
- Verified the refactor with `npm run compile` and `npm run build`.

The next safe refactoring target is typed transport/message adapters. Bedrock and Azure should not share their wire-format conversion or streaming loops until regression tests cover tool calls, images, cancellation, and usage chunks.

## Implemented in the current pass

- Added Vitest unit testing with model metadata and shared text-extraction coverage.
- Added CI for type-checking, tests, builds, packaging, and production dependency audits.
- Added provider disposal, Bedrock refresh locking, configuration-change refreshes, centralized secret/configuration keys, HTTPS endpoint validation, and explicit unavailable-model errors.
- Added development and troubleshooting documentation and excluded tests, planning files, and CI metadata from the VSIX.
- Added shared text utilities so provider-independent logic can be tested without loading the VS Code host API.

The remaining items below require live-provider verification or broader integration fixtures rather than a safe, provider-agnostic code-only change.

## High-priority work completed

- Backend request cancellation now propagates VS Code cancellation tokens to the AWS SDK and OpenAI client through `AbortController`.
- Bedrock request payloads use Smithy document types and runtime JSON guards instead of the previous local `any` casts for tool and additional request fields.
- Added redacted provider diagnostics through an opt-in VS Code log output channel; errors do not serialize exception messages, credentials, prompts, or request bodies.
- Added cancellation and diagnostics integration-style unit tests.

## Code-size pass

- Removed redundant section banners, stale comments, and duplicated command-registration boilerplate.
- Consolidated refresh and secret-setting command registration in `src/extension.ts`.
- Reduced the TypeScript source from 1,406 to 1,363 lines during this pass while retaining tests and provider behavior.
- A further 20% source reduction is not safe without removing features, deleting test coverage, or applying unreadable source minification. The next legitimate size reduction should come from a behavior-preserving provider transport abstraction after live integration tests exist.

## Priority 0 — Correctness and release safety

### 1. Add automated tests before refactoring

- Add a test runner and scripts for unit tests.
- Cover model ID parsing and display-name formatting in `src/models.ts`.
- Cover pricing-table matching, fallback metadata, and region-prefix normalization.
- Test Bedrock and Azure message conversion, including system messages, consecutive roles, images, tool calls, tool results, empty content, and assistant-first conversations.
- Test streamed text, tool-call accumulation, cancellation, usage reporting, and malformed tool JSON with mocked provider responses.
- Add extension-host smoke tests for command registration and provider registration where practical.
- Add CI checks for compile, test, package, and repository cleanliness.

### 2. Verify provider/API compatibility

- Confirm every advertised model name, model ID, context limit, output limit, pricing value, and capability against current AWS Bedrock and Azure documentation.
- Remove speculative or placeholder model entries and pricing values unless they are explicitly configurable or marked as examples.
- Validate the VS Code engine version and `languageModelPricing` proposal usage against the minimum supported VS Code release.
- Test both providers against the actual response formats, especially tool-call streaming and usage events.

### 3. Fix lifecycle and failure handling

- Dispose every provider event emitter and other owned resource through `context.subscriptions` or an explicit `dispose()` implementation.
- Prevent overlapping refresh operations with a shared promise or refresh lock.
- Preserve the last known model cache when refresh fails, but surface actionable non-secret error information to the user.
- Add request timeouts and ensure cancellation aborts the underlying SDK/OpenAI request rather than merely stopping result forwarding.
- Avoid duplicate usage events when a provider emits multiple usage-bearing chunks.
- Handle stream termination and partial tool calls deterministically.

## Priority 1 — Configuration and security

### 4. Improve credential handling

- Keep credentials exclusively in `SecretStorage`; never include them in logs, error messages, telemetry, or serialized state.
- Replace the Bedrock middleware's broad `any` types with the AWS middleware request types and document why bearer authentication is required.
- Check whether the current Bedrock API-key authentication approach is supported for every selected region and model type.
- Validate endpoint schemes and hosts for Azure configuration. Prefer HTTPS and warn or reject insecure HTTP endpoints unless explicitly enabled.
- Add a command to remove/reset each provider credential.
- Make setup flows return clear cancellation states and refresh only after successful configuration.

### 5. Make settings consistent and extensible

- Use one configuration model consistently between `package.json`, `extension.ts`, and provider implementations.
- Decide whether Azure supports one endpoint or multiple named deployments. If multiple endpoints are desired, implement the array-based schema and commands end-to-end; otherwise remove stale multi-endpoint assumptions.
- Add configurable region lists, endpoint labels, request timeout, cache duration, and optional model allowlists where useful.
- React to `onDidChangeConfiguration` so region and endpoint changes invalidate caches and refresh registered model information automatically.
- Use constants for configuration keys and secret keys to prevent drift.

## Priority 1 — Provider architecture

### 6. Extract shared provider utilities

- Create shared helpers for token counting fallback, usage-part creation, tool schema conversion, image conversion, text extraction, and error normalization.
- Introduce a common model catalog type for static and dynamically discovered models.
- Separate provider concerns into catalog/configuration, message translation, transport, streaming event translation, and VS Code adapter layers.
- Replace repeated `Record<string, unknown>` casts and `as any` conversions with narrow adapter types and runtime guards.
- Add a typed `ProviderError` model with safe user-facing messages and optional diagnostic details.

### 7. Improve model discovery and caching

- Store cache timestamps and optionally cached model metadata so startup does not require a network call every time.
- Distinguish configured, unavailable, stale, and fallback model states in the UI.
- Add a refresh status/progress indicator and avoid silently falling back when users expect live discovery.
- Filter discovered models by actual streaming support, supported modalities, provider family, and current region.
- Ensure metadata matching is case-insensitive and robust to future model ID formats.
- Add tests for unknown providers, global inference profiles, date/version suffixes, and legacy models.

## Priority 1 — Request behavior and feature completeness

### 8. Make message conversion lossless

- Preserve message ordering when a message contains both tool results and normal content.
- Preserve assistant text alongside assistant tool calls where the target API permits it.
- Support all VS Code content-part variants that can occur in practice, rather than relying on structural property checks alone.
- Validate image byte types and MIME types before conversion, and report unsupported formats clearly.
- Confirm tool-result formatting for both providers, including multiple results and non-text result parts.
- Centralize role-merging rules and add regression tests for consecutive system, user, assistant, and tool messages.

### 9. Improve generation controls

- Map VS Code request options such as temperature, stop sequences, top-p, and token limits when supported by each backend.
- Define a provider-specific policy for extended thinking/reasoning and expose only controls that actually affect the selected model.
- Ensure required tool mode is enforced by the backend and correctly represented for both providers.
- Return a clear error when a selected model becomes unavailable instead of silently using the first model in the catalog.
- Use backend tokenization when available; document and label the current character-based estimate as approximate.

### 10. Improve usage and cost tracking

- Track input, output, cache-read, and cache-write tokens separately where the backend supplies them.
- Calculate estimated cost per request using the selected model and region rather than only aggregate token counts.
- Persist a versioned, validated state shape and migrate older numeric token state safely.
- Add reset, export, and clear-history actions if usage history is expanded beyond a single aggregate.
- Make the tooltip accessible and robust to model/provider names containing Markdown-sensitive characters.

## Priority 2 — User experience and documentation

### 11. Improve setup and status UX

- Replace separate endpoint/key commands with guided provider setup while retaining individual update commands.
- Show provider readiness, last refresh time, stale-cache state, and configuration errors in a dedicated view or status item.
- Add a command to test the current credentials and endpoint without sending a model request.
- Avoid showing the AWS setup prompt on every activation after a deliberate dismissal; provide a persistent opt-in or snooze setting.
- Add confirmation and safe cleanup behavior for credential removal.

### 12. Update documentation

- Document prerequisites, supported VS Code versions, provider API-key requirements, region/model availability, and Azure endpoint formats.
- Add troubleshooting for authentication, unavailable models, rate limits, endpoint errors, images, tools, cancellation, and pricing.
- Clearly distinguish official model support from fallback/static catalog entries.
- Document privacy behavior: requests go directly to the configured provider and credentials are stored in VS Code SecretStorage.
- Add development instructions for build, watch, type-check, test, package, and release workflows.

## Priority 2 — Observability and operational quality

### 13. Add safe diagnostics

- Add opt-in debug logging through VS Code's `LogOutputChannel`; redact API keys, authorization headers, request bodies, image data, and sensitive prompt content.
- Include provider, model ID, request duration, cancellation state, HTTP status category, and usage availability in diagnostics.
- Normalize SDK errors into concise messages with retry guidance for authentication, throttling, invalid requests, and transient failures.
- Add retry with bounded exponential backoff only for safe, idempotent setup/discovery calls; do not blindly retry streamed generations.

### 14. Improve release engineering

- Add a GitHub Actions workflow for type-checking, tests, packaging, and artifact validation.
- Pin or regularly audit dependency versions and run dependency vulnerability checks.
- Add a changelog and release checklist.
- Verify `.vscodeignore` excludes source maps, tests, local configuration, and unnecessary files while retaining runtime dependencies.
- Test installation and activation from the generated VSIX in a clean VS Code profile.

## Suggested implementation order

1. Establish tests and CI, then verify the current build and package artifact.
2. Resolve configuration inconsistencies and validate model/API metadata.
3. Fix cancellation, refresh concurrency, stream edge cases, and resource disposal.
4. Extract typed shared utilities and remove unsafe casts.
5. Improve model caching, diagnostics, setup UX, and usage/cost reporting.
6. Update README, add troubleshooting documentation, and validate a clean VSIX installation.

## Definition of done

- `npm run compile`, tests, and packaging pass in CI.
- Provider behavior is covered by unit and mocked streaming tests.
- Credentials are never logged or persisted outside SecretStorage.
- Configuration, commands, README, and runtime behavior describe the same feature set.
- Cancellation, refresh failures, unavailable models, tool calls, images, and usage reporting have verified behavior.
- A clean VSIX installation works with both providers and produces actionable errors for incomplete configuration.
