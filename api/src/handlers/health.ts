import { ApiResponse } from '../models/types';

export function handleHealth(): ApiResponse {
  return {
    statusCode: 200,
    body: { status: 'ok', service: 'docops-api', timestamp: new Date().toISOString() },
  };
}
