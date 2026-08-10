# Orderak AI Instructions

This repository is the master workspace for the Orderak platform. Android is the
current seller client; iOS and desktop are reserved future clients.

## Project Areas

- `apps/seller-android/`: Android Studio project. Use Kotlin and Jetpack Compose.
- `apps/admin-web/`: React and TypeScript administration application.
- `services/backend/`: Cloudflare Workers backend. Android should call this backend only.
- `contracts/openapi/`: Platform-neutral Seller, Admin, and Integrations API contracts.
- `contracts/typescript/`: Shared TypeScript types for server and web code.
- `packages/ai-prompts/`: Prompt templates for OpenAI, Claude, and Gemini calls.
- `design/`: Figma and Canva links plus exported design assets.
- `docs/`: Product plan, API notes, setup steps, and architecture notes.
- `quality/performance/`: Contract and API performance verification.
- `tooling/repository/`: Repository structure and deployment-map verification.

## Rules

- Never put DeepSeek, OpenAI, Claude, Gemini, Cloudflare, Firebase, Figma, or Canva API keys/secrets in the Android app.
- Store secret keys in Cloudflare Worker secrets or local environment variables.
- The Android app calls the Cloudflare backend.
- The Cloudflare backend calls OpenAI, Claude, Gemini, databases, and third-party APIs.
- Keep code beginner-friendly and avoid unnecessary abstraction.
- Update `docs/reference/api.md` when backend endpoints change.
- Update `docs/product/app-plan.md` when product behavior changes.
- Update `docs/guides/setup.md` when setup steps change.
- Update `docs/architecture/overview.md` when system architecture changes.
- Keep `docs/architecture/orderak-full-architecture.html` synchronized when
  system components, trust boundaries, integrations, queues, or data authority
  change. Treat it as internal engineering documentation unless the user
  explicitly approves public publication.
- Update `docs/architecture/security-model.md` when auth/security model changes.
- Treat `docs/contracts/auth-phase1-contract.md` as a versioned authentication safety
  contract. Provider, OTP state rules, timeout/error handling, logout behavior,
  backend token verification, consent evidence, throttling, or device-recovery
  semantics still require the user's explicit approval. Implementation names
  may evolve only when the invariant contract, Android profile, behavioral
  tests, and relevant security/API documentation are updated together.
- Run `gradlew.bat verifyAuthPhase1Contract` after authentication-related edits.
  If it fails, do not bypass, weaken, rename, or remove the guard; restore the
  protected behavior or obtain explicit approval for an intentional migration.
- Update `docs/guides/database-migrations.md` when migrations change.
- Treat `docs/architecture/localization-architecture.md` as a versioned architecture contract.
  Do not change the default locale, supported locale set, per-app language APIs,
  App Bundle language-split policy, translation lifecycle schema, or screenshot
  baselines without explicitly telling the user and updating that document, the
  localization invariants, Android profile, and verification evidence.
- Never restore a manual `locale_config.xml`. AGP generates LocaleConfig from
  `resources.properties` and the `values-*` directories.
- Run `gradlew.bat verifyLocalizationContract` after localization-related edits.
  If it fails, do not bypass or remove the guard; resolve the conflict or obtain
  explicit approval for an intentional architecture migration.

## Multi-Agent Development Workbench

The `multi-agent/` directory contains a LangChain-based development tool used
for internal development tasks (code generation, review, and refactoring). It is
NOT part of the production pipeline — the Cloudflare Worker calls DeepSeek directly.

### Architecture

```text
Open WebUI (Docker) → FastAPI Orchestrator → LangChain Agents
                                                  ├── Planner   (DeepSeek)
                                                  ├── Researcher (DeepSeek)
                                                  ├── Writer     (DeepSeek)
                                                  └── Critic     (Claude CLI, local)
```

### Key files

- `multi-agent/multi_agents_starter.py`: 4-agent LCEL workflow with retry, sequential planner→researcher→writer→critic, and async streaming
- `multi-agent/orchestrator_api.py`: OpenAI-compatible API for Open WebUI integration with SSE streaming
- `multi-agent/compose.yaml`: Open WebUI Docker container (`v0.11.0`)
- `packages/ai-prompts/*.md`: Prompt templates used by the agents (planner, researcher, writer, critic, writer_revise)

### Usage

1. Set `ORCHESTRATOR_SECRET` in `multi-agent/.env` (required — see below)
2. Start services: `.\multi-agent\start_all.cmd -InstallDeps -ReloadApi`
3. Open: http://localhost:3000
4. Connect Open WebUI to: `http://host.docker.internal:8000/v1`, using
   `ORCHESTRATOR_SECRET` as the API key
5. Select model: `multi-agent-orchestrator`

### Access control

The Open WebUI container reaches the host over the Docker bridge, not loopback,
so `HOST` must be `0.0.0.0` and the API is therefore reachable beyond this
machine. Every non-loopback caller must present `ORCHESTRATOR_SECRET` as a
Bearer token or `X-API-Key`. This is fail-closed: with no secret configured,
non-loopback requests are refused outright, and `start_orchestrator.ps1` will
not launch on a non-loopback bind without one.

This matters because the orchestrator can read repo files and, after an explicit
in-chat confirmation, write them. Proposed edits are held server-side under a
single-use id that expires after 30 minutes; the client echoes only the id, so
file content cannot be injected through the request body.

### Rules

- Prompt changes go in `packages/ai-prompts/*.md`, NOT in Python files
- Agent behavior changes go in `multi_agents_starter.py`
- API changes go in `orchestrator_api.py`
- Never commit `.env` with real API keys
- Run `claude -p --model sonnet` for code review before merging agent changes
- Update `docs/architecture/overview.md` if the multi-agent architecture changes
- Run `multi-agent/_verify.py` before merging: check 5 holds no-API regression
  guards for verdict parsing, conversation memory, context budget, and the
  apply-changes flow. Add a guard there when you fix a bug in those areas.

### Provider configuration

Per-role provider/model selection via `.env`:

```env
CRITIC_PROVIDER=claude_code   # Uses local Claude CLI (no API key needed)
CRITIC_MODEL=sonnet           # Maps to Claude via CLI aliases
WRITER_PROVIDER=deepseek      # ~$0.14/M tokens
PLANNER_ENABLED=false         # Disable for simple tasks to save cost
```

## Preferred Stack

- Android: Kotlin, Jetpack Compose, Android Studio.
- Backend: Cloudflare Workers, TypeScript when possible.
- AI providers: start with one provider first, then add routing for others.
- Design: Figma for app screens, Canva for marketing assets.

## First Milestone

Build the smallest working version:

1. Android app has one chat/order screen.
2. Android app sends text to the Cloudflare backend.
3. Backend returns a fake AI response.
4. Later, backend connects to one real AI provider.
