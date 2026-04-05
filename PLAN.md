# DocOps Phase 1: Foundation — Implementation Plan

## Overview
Scaffold the DocOps monorepo and deploy foundational AWS infrastructure: DynamoDB tables, Cognito auth, and API Gateway. Reuses proven CDK patterns from `nutrition-detection-validation`.

---

## 1. Monorepo Project Structure

```
inteldoc-view/
├── infra/                        # AWS CDK (TypeScript)
│   ├── bin/app.ts                # CDK app entry — orchestrates stacks
│   ├── lib/
│   │   ├── database-stack.ts     # DynamoDB: Tenants, Workspaces, Traces, Sessions, HITL
│   │   ├── auth-stack.ts         # Cognito User Pool + Identity Pool + Google OAuth
│   │   └── api-stack.ts          # API Gateway + Lambda routing layer
│   ├── package.json
│   ├── tsconfig.json
│   └── cdk.json
│
├── api/                          # Agenticore Gateway (TypeScript, Lambda)
│   ├── src/
│   │   ├── handler.ts            # Lambda entry point (API Gateway proxy)
│   │   ├── router.ts             # Route definitions for all /v1/* endpoints
│   │   ├── middleware/
│   │   │   ├── auth.ts           # JWT validation (Cognito token verification)
│   │   │   ├── tenant.ts         # Tenant resolution from JWT claims
│   │   │   └── plan-enforcer.ts  # Free-tier limits (docs, workspaces, tokens)
│   │   ├── handlers/
│   │   │   ├── workspace.ts      # POST /v1/workspaces, GET /v1/workspaces
│   │   │   └── health.ts        # GET /v1/health
│   │   ├── models/
│   │   │   └── types.ts          # Shared TypeScript types (Tenant, Workspace, etc.)
│   │   └── lib/
│   │       └── dynamo.ts         # DynamoDB client wrapper
│   ├── package.json
│   └── tsconfig.json
│
├── services/                     # Python AI microservices (Phase 2+)
│   ├── docling-client/           # Docling API client (reuses existing ECS)
│   ├── llm-reasoning/            # Bedrock LLM service
│   ├── reconciliation/           # Dual-pipeline reconciliation engine
│   └── pyproject.toml
│
├── ui/                           # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx        # Root layout with sidebar
│   │   │   ├── page.tsx          # Dashboard (redirect to /dashboard)
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx      # Workspace overview + usage metrics
│   │   │   └── workspaces/
│   │   │       └── page.tsx      # Workspace list (placeholder)
│   │   ├── components/
│   │   │   ├── Sidebar.tsx       # Navigation sidebar
│   │   │   └── Header.tsx        # Top bar with user info
│   │   └── lib/
│   │       ├── amplify.ts        # Amplify config (Cognito)
│   │       └── api.ts            # API client for Agenticore Gateway
│   ├── package.json
│   ├── next.config.ts
│   └── tsconfig.json
│
├── DocOps-Product-Plan.docx      # Product blueprint (existing)
├── info.md                       # (existing)
└── package.json                  # Root package.json (workspace config)
```

---

## 2. CDK Infrastructure (infra/)

### Stack 1: `DatabaseStack` — DynamoDB Tables

Reuses pattern from similarity-engine-stack.ts. Creates 5 tables:

| Table | Partition Key | Sort Key | GSI | Attributes |
|-------|--------------|----------|-----|------------|
| `docops-tenants` | `tenant_id` (S) | — | `email-index` on `email` | plan, email, created_at |
| `docops-workspaces` | `workspace_id` (S) | — | `tenant-index` on `tenant_id` | prompt_version, schema, agents, hitl_threshold, created_at |
| `docops-traces` | `trace_id` (S) | — | `workspace-index` on `workspace_id` | status, confidence, tokens, latency, agent_steps, prompt_version |
| `docops-sessions` | `session_id` (S) | — | `workspace-index` on `workspace_id` | memory[], created_at |
| `docops-hitl-reviews` | `trace_id` (S) | — | `status-index` on `status` | reviewer, corrections[], resolved_at |

- Billing mode: PAY_PER_REQUEST (on-demand)
- Removal policy: RETAIN (protect data)
- Point-in-time recovery: enabled

### Stack 2: `AuthStack` — Cognito

Reuses pattern from amplify-hosting-stack.ts. Creates:

- **User Pool** (`docops-user-pool`)
  - Self-signup enabled
  - Email verification (code)
  - Password policy: min 8 chars, requires uppercase + lowercase + digits + symbols
  - Standard attributes: email (required)
  - Google OAuth identity provider (client ID/secret from CDK context)

- **User Pool Client** (`docops-app-client`)
  - Auth flows: SRP, USER_PASSWORD_AUTH
  - OAuth: authorization_code + implicit grant
  - Callback URLs: `http://localhost:3000/auth/callback`, `https://docops.dataopslabs.com/auth/callback`
  - Scopes: openid, email, profile

- **Identity Pool** (`docops-identity-pool`)
  - Authenticated role with execute-api:Invoke
  - Federated with user pool

- Outputs: UserPoolId, UserPoolClientId, IdentityPoolId

### Stack 3: `ApiStack` — API Gateway + Lambda

Creates:

- **Lambda Function** (`docops-api`)
  - Runtime: Node.js 20.x
  - Handler: handler.handler
  - Memory: 512 MB, Timeout: 30s
  - Code from `../api/dist` (bundled TypeScript)
  - Environment vars: table names (from DatabaseStack), Cognito pool ID (from AuthStack), Docling ALB URL
  - IAM: DynamoDB read/write on all 5 tables

- **API Gateway** (REST API, `docops-api-gateway`)
  - Proxy integration: `/{proxy+}` → Lambda
  - CORS enabled (all origins for dev, restricted in prod)
  - Stage: `v1`

- **Custom Domain** (future): `api.docops.dataopslabs.com`

- Outputs: ApiEndpointUrl

### Stack Dependency Chain
```
DatabaseStack → AuthStack → ApiStack
                  ↓              ↓
            (Cognito IDs)  (Table names + Cognito IDs)
```

---

## 3. API Gateway — Agenticore Gateway (api/)

### Tech choices
- **Runtime**: TypeScript on Node.js 20
- **Framework**: Lightweight custom router (no Express/Fastify overhead in Lambda)
- **Bundler**: esbuild (fast, tree-shaking, single-file output)

### Routes (Phase 1 — Foundation only)

| Method | Path | Handler | Auth | Description |
|--------|------|---------|------|-------------|
| POST | `/v1/auth/google` | auth.ts | Public | Exchange Google token for Cognito tokens |
| POST | `/v1/workspaces` | workspace.ts | JWT | Create workspace (enforces free-tier limit) |
| GET | `/v1/workspaces` | workspace.ts | JWT | List tenant's workspaces |
| GET | `/v1/workspaces/:id` | workspace.ts | JWT | Get workspace details |
| GET | `/v1/health` | health.ts | Public | Health check |

Phase 2+ routes (stubbed with 501 Not Implemented):
- `POST /v1/workspaces/:id/process`
- `GET /v1/traces/:trace_id`
- `POST /v1/hitl/:trace_id/resolve`
- `POST /v1/sessions/:id/chat`
- `GET /v1/observability`

### Middleware Pipeline
```
Request → Auth Middleware → Tenant Resolution → Plan Enforcer → Handler → Response
```

1. **Auth Middleware** (`auth.ts`)
   - Verify JWT from `Authorization: Bearer <token>` header
   - Validate against Cognito User Pool (JWKS endpoint)
   - Extract `sub` (user ID) and `custom:tenant_id` from claims
   - Skip for public routes (`/v1/health`, `/v1/auth/*`)

2. **Tenant Resolution** (`tenant.ts`)
   - Look up tenant record from DynamoDB using tenant_id from JWT
   - Attach tenant object to request context
   - Auto-create tenant on first login (free tier)

3. **Plan Enforcer** (`plan-enforcer.ts`)
   - Check workspace count against plan limits (free: 2 max)
   - Check document count against plan limits (free: 10/month)
   - Return 429 with upgrade message when exceeded

---

## 4. Authentication Flow

### Google OAuth via Cognito
```
User → Google Sign-In → Authorization Code
  → POST /v1/auth/google { code }
  → Lambda exchanges code with Cognito Hosted UI
  → Returns { idToken, accessToken, refreshToken }
  → Frontend stores tokens, sends as Bearer header
```

### Tenant Auto-Provisioning
- On first authenticated request, if no tenant record exists:
  - Create tenant in DynamoDB with `plan: "free"`, email from token
  - Return tenant_id in response

---

## 5. Next.js UI Scaffold (ui/)

### Tech choices
- **Framework**: Next.js 14+ (App Router)
- **Auth**: AWS Amplify v6 (same pattern as NutriCheck)
- **Styling**: Tailwind CSS
- **State**: React context (simple, no Redux needed yet)

### Pages (Phase 1 — shell only)

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | Redirect | → `/dashboard` |
| `/dashboard` | Dashboard | Workspace cards, usage summary (placeholder data) |
| `/workspaces` | WorkspaceList | List workspaces, create new |
| `/auth/callback` | AuthCallback | Handle OAuth redirect |

### Layout
- **Sidebar**: Navigation links (Dashboard, Workspaces, Traces, HITL, Chat, Settings)
- **Header**: DocOps logo, user avatar, sign-out button
- **Main content area**: Page-specific content

### Amplify Config
Reuse pattern from NutriCheck `amplify-config.ts`:
- Cognito User Pool ID, Client ID, Identity Pool ID from environment variables
- API endpoint URL from environment variable

---

## 6. Python Services Scaffold (services/)

Minimal setup — just the project structure and dependencies for Phase 2:

- `pyproject.toml` with dependencies: boto3, httpx, pydantic, strands-agents
- Empty `docling-client/`, `llm-reasoning/`, `reconciliation/` packages
- Shared `models.py` mirroring the data model from the product plan

---

## 7. Implementation Order

| Step | What | Files | Depends On |
|------|------|-------|------------|
| 1 | Root monorepo setup | `package.json`, `.gitignore` | — |
| 2 | CDK project setup | `infra/*` (package.json, tsconfig, cdk.json) | Step 1 |
| 3 | DatabaseStack | `infra/lib/database-stack.ts` | Step 2 |
| 4 | AuthStack | `infra/lib/auth-stack.ts` | Step 2 |
| 5 | API TypeScript project | `api/package.json`, `api/tsconfig.json` | Step 1 |
| 6 | API handlers + middleware | `api/src/**/*.ts` | Step 5 |
| 7 | ApiStack (CDK) | `infra/lib/api-stack.ts` | Steps 3, 4, 6 |
| 8 | CDK app entry | `infra/bin/app.ts` | Steps 3, 4, 7 |
| 9 | Next.js project setup | `ui/package.json`, `next.config.ts` | Step 1 |
| 10 | UI layout + pages | `ui/src/**/*.tsx` | Step 9 |
| 11 | Python services scaffold | `services/pyproject.toml`, empty packages | Step 1 |

---

## 8. What We're Reusing from NutriCheck

| Asset | From NutriCheck | How We Reuse |
|-------|----------------|--------------|
| Docling ECS service | Already deployed | Point `DOCLING_SERVICE_URL` env var to existing ALB |
| CDK stack patterns | `docling-fargate-stack.ts`, `similarity-engine-stack.ts` | Copy CDK patterns for Lambda, API GW, DynamoDB |
| Cognito setup | `amplify-hosting-stack.ts` | Same User Pool + Identity Pool pattern |
| Amplify auth config | `amplify-config.ts` | Same env var pattern for frontend |
| API client pattern | `apiClient.ts` | Same Bearer token auth pattern |
| Pydantic models | `models.py` | Same model structure approach |

---

## 9. What We're NOT Building in Phase 1

- Document processing pipeline (Phase 2)
- Strands workflow engine (Phase 3)
- HITL review system (Phase 4)
- Memory/chat system (Phase 5)
- Observability/tracing (Phase 6)
- Full UI with trace explorer, HITL panel (Phase 7)
- Pricing/billing enforcement (Phase 8)

These endpoints are stubbed with 501 responses so the API contract is visible but not functional.

---

## 10. Deployment

After scaffolding, deploy with:
```bash
cd infra && npm install && npx cdk deploy --all --outputs-file cdk-outputs.json
```

Verify:
- DynamoDB tables exist in us-east-1
- Cognito user pool is created with Google IdP
- API Gateway returns 200 on GET /v1/health
- Next.js runs locally on localhost:3000
