import { ApiRequest, ApiResponse } from './models/types';
import { handleHealth, handleHealthReady } from './handlers/health';
import { handleCreateWorkspace, handleListWorkspaces, handleGetWorkspace, handleUpdateWorkspace, handleDeleteWorkspace } from './handlers/workspace';
import { handleProcessDocument, handleGetUploadUrl } from './handlers/process';
import { handleProcessBatch } from './handlers/process-batch';
import { handleGetTrace, handleListTraces } from './handlers/traces';
import { handleReprocessTrace } from './handlers/reprocess';
import { handleListReviews, handleGetReview, handleAssignReview, handleSubmitCorrections, handleResolveReview } from './handlers/hitl';
import { handleCreateSession, handleListSessions, handleGetSession, handleDeleteSession } from './handlers/sessions';
import { handleChatMessage } from './handlers/chat';
import { handleGetDashboard, handleGetTraceMetrics, handleGetAgentMetrics, handleGetUsage } from './handlers/observability';
import { handleGetPlan, handleChangePlan, handleExportUsage } from './handlers/billing';
import { handleDeleteTenant, handleExportTenantData } from './handlers/gdpr';
import { handleRegisterWebhook, handleListWebhooks, handleDeleteWebhook } from './handlers/webhooks';

const NOT_IMPLEMENTED: ApiResponse = {
  statusCode: 501,
  body: { error: 'Not implemented', message: 'This endpoint will be available in a future phase.' },
};

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export async function route(req: ApiRequest): Promise<ApiResponse> {
  const { method, path } = req;

  // ── Health ────────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/health') {
    return handleHealth();
  }
  // G5-10: Deep readiness check — pings DynamoDB, S3, Bedrock
  if (method === 'GET' && path === '/v1/health/ready') {
    return handleHealthReady();
  }

  // Auth (handled client-side via Amplify)
  if (method === 'POST' && path === '/v1/auth/google') {
    return NOT_IMPLEMENTED;
  }

  // ── Workspaces ────────────────────────────────────────────────────────────
  if (method === 'POST' && path === '/v1/workspaces') {
    return handleCreateWorkspace(req);
  }
  if (method === 'GET' && path === '/v1/workspaces') {
    return handleListWorkspaces(req);
  }
  const workspaceMatch = matchPath('/v1/workspaces/:id', path);
  if (method === 'GET' && workspaceMatch) {
    req.pathParams = workspaceMatch;
    return handleGetWorkspace(req);
  }
  if (method === 'PUT' && workspaceMatch) {
    req.pathParams = workspaceMatch;
    return handleUpdateWorkspace(req);
  }
  if (method === 'DELETE' && workspaceMatch) {
    req.pathParams = workspaceMatch;
    return handleDeleteWorkspace(req);
  }

  // ── Document Processing ───────────────────────────────────────────────────
  // G6-22: Presigned upload URL — matched first (most specific path)
  const uploadUrlMatch = matchPath('/v1/workspaces/:id/upload-url', path);
  if (method === 'POST' && uploadUrlMatch) {
    req.pathParams = uploadUrlMatch;
    return handleGetUploadUrl(req);
  }

  // G5-13: Batch upload must be matched BEFORE the single-doc route (longer path wins)
  const processBatchMatch = matchPath('/v1/workspaces/:id/process/batch', path);
  if (method === 'POST' && processBatchMatch) {
    req.pathParams = processBatchMatch;
    return handleProcessBatch(req);
  }

  const processMatch = matchPath('/v1/workspaces/:id/process', path);
  if (method === 'POST' && processMatch) {
    req.pathParams = processMatch;
    return handleProcessDocument(req);
  }

  const tracesMatch = matchPath('/v1/workspaces/:id/traces', path);
  if (method === 'GET' && tracesMatch) {
    req.pathParams = tracesMatch;
    return handleListTraces(req);
  }

  // G5-25: Trace re-processing — must be matched BEFORE the single trace GET route
  const reprocessMatch = matchPath('/v1/traces/:trace_id/reprocess', path);
  if (method === 'POST' && reprocessMatch) {
    req.pathParams = reprocessMatch;
    return handleReprocessTrace(req);
  }

  const traceMatch = matchPath('/v1/traces/:trace_id', path);
  if (method === 'GET' && traceMatch) {
    req.pathParams = traceMatch;
    return handleGetTrace(req);
  }

  // ── HITL Review endpoints ─────────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/hitl') {
    return handleListReviews(req);
  }
  const hitlAssignMatch = matchPath('/v1/hitl/:trace_id/assign', path);
  if (method === 'POST' && hitlAssignMatch) {
    req.pathParams = hitlAssignMatch;
    return handleAssignReview(req);
  }
  const hitlCorrectionsMatch = matchPath('/v1/hitl/:trace_id/corrections', path);
  if (method === 'POST' && hitlCorrectionsMatch) {
    req.pathParams = hitlCorrectionsMatch;
    return handleSubmitCorrections(req);
  }
  const hitlResolveMatch = matchPath('/v1/hitl/:trace_id/resolve', path);
  if (method === 'POST' && hitlResolveMatch) {
    req.pathParams = hitlResolveMatch;
    return handleResolveReview(req);
  }
  const hitlDetailMatch = matchPath('/v1/hitl/:trace_id', path);
  if (method === 'GET' && hitlDetailMatch) {
    req.pathParams = hitlDetailMatch;
    return handleGetReview(req);
  }

  // ── Chat Sessions ─────────────────────────────────────────────────────────
  const createSessionMatch = matchPath('/v1/workspaces/:id/sessions', path);
  if (method === 'POST' && createSessionMatch) {
    req.pathParams = createSessionMatch;
    return handleCreateSession(req);
  }
  if (method === 'GET' && createSessionMatch) {
    req.pathParams = createSessionMatch;
    return handleListSessions(req);
  }

  const sessionDetailMatch = matchPath('/v1/sessions/:id', path);
  if (method === 'GET' && sessionDetailMatch) {
    req.pathParams = sessionDetailMatch;
    return handleGetSession(req);
  }
  if (method === 'DELETE' && sessionDetailMatch) {
    req.pathParams = sessionDetailMatch;
    return handleDeleteSession(req);
  }

  const chatMatch = matchPath('/v1/sessions/:id/chat', path);
  if (method === 'POST' && chatMatch) {
    req.pathParams = chatMatch;
    return handleChatMessage(req);
  }

  // ── Observability ─────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/observability') {
    return handleGetDashboard(req);
  }
  // G5-21: /observability/traces supports pagination via next_token + limit query params
  if (method === 'GET' && path === '/v1/observability/traces') {
    return handleGetTraceMetrics(req);
  }
  if (method === 'GET' && path === '/v1/observability/agents') {
    return handleGetAgentMetrics(req);
  }
  if (method === 'GET' && path === '/v1/observability/usage') {
    return handleGetUsage(req);
  }

  // ── Billing / Plan management ─────────────────────────────────────────────
  if (method === 'GET' && path === '/v1/tenant/plan') {
    return handleGetPlan(req);
  }
  if (method === 'POST' && path === '/v1/tenant/plan') {
    return handleChangePlan(req);
  }
  if (method === 'GET' && path === '/v1/tenant/usage/export') {
    return handleExportUsage(req);
  }

  // ── GDPR — tenant data management (G5-05) ────────────────────────────────
  // GET  /v1/tenant/export  — full data export for DSAR (Data Subject Access Request)
  if (method === 'GET' && path === '/v1/tenant/export') {
    return handleExportTenantData(req);
  }
  // DELETE /v1/tenant  — soft-delete account and schedule all data for purge
  if (method === 'DELETE' && path === '/v1/tenant') {
    return handleDeleteTenant(req);
  }

  // ── Webhooks — G5-12 ──────────────────────────────────────────────────────
  // POST   /v1/tenant/webhooks       — register an HTTPS webhook endpoint
  // GET    /v1/tenant/webhooks       — list all registered webhooks
  // DELETE /v1/tenant/webhooks/:id   — deregister a webhook (longer path matched first)
  const webhookDeleteMatch = matchPath('/v1/tenant/webhooks/:id', path);
  if (method === 'DELETE' && webhookDeleteMatch) {
    req.pathParams = webhookDeleteMatch;
    return handleDeleteWebhook(req);
  }
  if (method === 'POST' && path === '/v1/tenant/webhooks') {
    return handleRegisterWebhook(req);
  }
  if (method === 'GET' && path === '/v1/tenant/webhooks') {
    return handleListWebhooks(req);
  }

  return { statusCode: 404, body: { error: 'Not found' } };
}
