---
inclusion: auto
---

# DocOps — Agentic Document Intelligence Platform

## Project Overview

DocOps is a multi-tenant SaaS platform for agentic document intelligence. It processes documents through AI pipelines (Docling + Bedrock LLM), tracks processing traces with confidence scores, and provides human-in-the-loop (HITL) review for low-confidence results. The product name is "DocOps" and the repo is `inteldoc-view`.

## Architecture

### Three-Layer Design

1. **API Gateway Layer** — TypeScript Lambda (`api/`) handles routing, JWT auth (Cognito), tenant resolution, and plan enforcement. Bundled with esbuild, deployed as a single Lambda behind API Gateway proxy.
2. **Data Layer** — DynamoDB with 5 tables: Tenants, Workspaces, Traces, Sessions, HITL Reviews. All on-demand billing with PITR enabled.
3. **Processing Layer** — Python 3.11 Lambda (`services/`) for document processing via Docling and Bedrock LLM reasoning. Documents stored in S3, processing is async.

### Infrastructure

All infrastructure is AWS CDK (TypeScript) in `infra/`. Four stacks:
- `DatabaseStack` — DynamoDB tables with GSIs
- `AuthStack` — Cognito User Pool + Identity Pool + Google OAuth
- `ProcessingStack` — S3 bucket + Python processor Lambda
- `ApiStack` — Node.js Lambda + API Gateway

Stack dependency: `DatabaseStack → AuthStack → ProcessingStack → ApiStack`

Deploy with: `cd infra && npx cdk deploy --all --outputs-file cdk-outputs.json`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | TypeScript, Node.js 20, esbuild, AWS Lambda |
| Infrastructure | AWS CDK v2 (TypeScript) |
| Database | DynamoDB (on-demand, PITR) |
| Auth | Cognito User Pool + Identity Pool, Google OAuth, JWT (RS256) |
| Storage | S3 (document uploads) |
| Processing | Python 3.11, Pydantic, boto3, Bedrock (Claude) |
| Frontend (planned) | Next.js 14+, AWS Amplify v6, Tailwind CSS |
| Design System | Linear (shell/dashboard) + Sentry (traces/HITL) dark-mode aesthetic |

## Data Model

### Core Entities

- **Tenant** — `tenant_id`, `email`, `plan` (free/pro/enterprise), `created_at`
- **Workspace** — `workspace_id`, `tenant_id`, `name`, `prompt_version`, `schema`, `agents[]`, `hitl_threshold`
- **Trace** — `trace_id`, `workspace_id`, `status` (pending/processing/completed/failed/hitl_required), `confidence`, `tokens`, `latency`, `agent_steps[]`
- **Session** — `session_id`, `workspace_id`, `memory[]`
- **HitlReview** — `trace_id`, `status` (pending/in_review/resolved), `reviewer`, `corrections[]`

### Plan Limits

| Plan | Workspaces | Docs/Month |
|------|-----------|------------|
| free | 2 | 10 |
| pro | 20 | 500 |
| enterprise | ∞ | ∞ |

## API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/health` | Public | Health check |
| POST | `/v1/workspaces` | JWT | Create workspace (enforces plan limit) |
| GET | `/v1/workspaces` | JWT | List tenant's workspaces |
| GET | `/v1/workspaces/:id` | JWT | Get workspace details |
| PUT | `/v1/workspaces/:id` | JWT | Update workspace |
| POST | `/v1/workspaces/:id/process` | JWT | Submit document for processing |
| GET | `/v1/workspaces/:id/traces` | JWT | List workspace traces |
| GET | `/v1/traces/:trace_id` | JWT | Get trace details |
| POST | `/v1/hitl/:trace_id/resolve` | JWT | Resolve HITL review (stub) |
| POST | `/v1/sessions/:id/chat` | JWT | Chat session (stub) |
| GET | `/v1/observability` | JWT | Observability dashboard (stub) |

## Middleware Pipeline

```
Request → Auth (JWT/JWKS) → Tenant Resolution → Plan Enforcer → Handler → Response
```

- Public routes (`/v1/health`, `/v1/auth/*`) skip auth
- Tenant auto-provisioned on first login with `plan: "free"`
- Plan enforcer returns 429 when limits exceeded

## Coding Conventions

### TypeScript (API)

- Use the custom lightweight router in `api/src/router.ts` — no Express/Fastify
- All handlers return `Promise<ApiResponse>` with `{ statusCode, body, headers? }`
- Types live in `api/src/models/types.ts`
- DynamoDB operations go through `api/src/lib/dynamo.ts` helpers (`getItem`, `putItem`, `queryIndex`)
- Table names come from environment variables, with fallback defaults in `TABLE_NAMES`
- Bundle with esbuild: `npm run build` in `api/`
- External `@aws-sdk/*` packages (provided by Lambda runtime)

### Python (Services)

- Pydantic models in `services/models.py` mirror the TypeScript types
- Each service is a separate package under `services/`
- Use `boto3` for AWS SDK, `httpx` for HTTP calls
- Bedrock model: `anthropic.claude-3-haiku-20240307-v1:0`

### CDK (Infrastructure)

- Each stack is a separate file in `infra/lib/`
- Stack props use interfaces for cross-stack references
- All tables use `PAY_PER_REQUEST` billing and `RETAIN` removal policy
- CORS is open for dev (`*`), restrict in production

## Phased Rollout

The product is built in phases. Reference `PLAN.md` for the full implementation plan.

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Foundation (DynamoDB, Cognito, API Gateway, workspace CRUD) | Done |
| 2 | Document processing pipeline (S3 upload, async processor) | In progress |
| 3 | Strands workflow engine, LLM reasoning | Planned |
| 4 | HITL review system | Planned |
| 5 | Memory/chat system | Planned |
| 6 | Observability/tracing | Planned |
| 7 | Full UI (trace explorer, HITL panel) | Planned |
| 8 | Pricing/billing enforcement | Planned |

## Key Files Reference

| Purpose | Path |
|---------|------|
| Lambda entry point | `api/src/handler.ts` |
| Route definitions | `api/src/router.ts` |
| TypeScript types | `api/src/models/types.ts` |
| DynamoDB helpers | `api/src/lib/dynamo.ts` |
| Auth middleware | `api/src/middleware/auth.ts` |
| Tenant resolution | `api/src/middleware/tenant.ts` |
| Plan enforcement | `api/src/middleware/plan-enforcer.ts` |
| Python models | `services/models.py` |
| CDK stacks | `infra/lib/*.ts` |
| Implementation plan | `PLAN.md` |
| UI design system notes | `designui.md` |
| Product blueprint | `DocOps-Product-Plan.docx` |
