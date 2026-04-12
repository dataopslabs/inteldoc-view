/**
 * G6-05: Unit tests for plan enforcer — plan limit enforcement, warning headers.
 */
import { buildWarningHeaders, buildLimitResponse } from '../middleware/plan-enforcer';
import { EnforcementResult } from '../models/types';

describe('buildWarningHeaders', () => {
  test('returns empty headers when no warnings', () => {
    const result: EnforcementResult = { allowed: true, warnings: [] };
    expect(buildWarningHeaders(result)).toEqual({});
  });

  test('returns warning header for each warning', () => {
    const result: EnforcementResult = {
      allowed: true,
      warnings: [
        {
          resource_type: 'documents',
          current_usage: 450,
          limit: 500,
          header_name: 'X-Usage-Warning',
          header_value: 'documents: 450/500 used',
        },
      ],
      remaining: { documents: 50, tokens: 0, chats: 0, workspaces: 0 },
    };
    const headers = buildWarningHeaders(result);
    expect(headers['X-Usage-Warning']).toBe('documents: 450/500 used');
    expect(headers['X-Usage-Remaining']).toBe('documents: 50');
  });

  test('remaining header uses first entry', () => {
    const result: EnforcementResult = {
      allowed: true,
      warnings: [],
      remaining: { documents: 100, tokens: 5000, chats: 20, workspaces: 5 },
    };
    const headers = buildWarningHeaders(result);
    expect(headers['X-Usage-Remaining']).toBeDefined();
  });
});

describe('buildLimitResponse', () => {
  test('returns 429 status with rejection details', () => {
    const rejection: EnforcementResult['rejection'] = {
      resource_type: 'documents',
      current_usage: 10,
      limit: 10,
      billing_period: '2024-01',
      upgrade_url: '/v1/tenant/plan',
      message: 'documents limit reached',
    };
    const response = buildLimitResponse(rejection);
    expect(response.statusCode).toBe(429);
    expect((response.body as any).resource_type).toBe('documents');
    expect((response.body as any).limit).toBe(10);
  });
});
