import { ApiRequest, ApiResponse } from './models/types';
import { handleHealth } from './handlers/health';
import { handleCreateWorkspace, handleListWorkspaces, handleGetWorkspace, handleUpdateWorkspace } from './handlers/workspace';
import { handleProcessDocument } from './handlers/process';
import { handleGetTrace, handleListTraces } from './handlers/traces';

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

  // Health
  if (method === 'GET' && path === '/v1/health') {
    return handleHealth();
  }

  // Auth (handled client-side via Amplify)
  if (method === 'POST' && path === '/v1/auth/google') {
    return NOT_IMPLEMENTED;
  }

  // Workspaces
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

  // Phase 2 — Document Processing
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

  const traceMatch = matchPath('/v1/traces/:trace_id', path);
  if (method === 'GET' && traceMatch) {
    req.pathParams = traceMatch;
    return handleGetTrace(req);
  }

  // Phase 3+ stubs
  const stubPaths: [string, string][] = [
    ['/v1/hitl/:trace_id/resolve', 'POST'],
    ['/v1/sessions/:id/chat', 'POST'],
    ['/v1/observability', 'GET'],
  ];
  for (const [pattern, m] of stubPaths) {
    if (method === m && matchPath(pattern, path)) {
      return NOT_IMPLEMENTED;
    }
  }

  return { statusCode: 404, body: { error: 'Not found' } };
}
