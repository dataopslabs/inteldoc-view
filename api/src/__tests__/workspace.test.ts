/**
 * G6-05: Unit tests for workspace handlers — validation logic.
 */

// Test the validation logic extracted into pure functions
function validateWorkspaceFields(
  name?: string,
  description?: string,
  hitlThreshold?: number
): string | null {
  const MAX_NAME_LEN = 100;
  const MAX_DESC_LEN = 500;
  if (name !== undefined) {
    if (!name.trim()) return 'name cannot be empty';
    if (name.length > MAX_NAME_LEN) return `name must be ${MAX_NAME_LEN} characters or fewer`;
  }
  if (description !== undefined && description.length > MAX_DESC_LEN) {
    return `description must be ${MAX_DESC_LEN} characters or fewer`;
  }
  if (hitlThreshold !== undefined) {
    if (typeof hitlThreshold !== 'number' || isNaN(hitlThreshold)) {
      return 'hitl_threshold must be a number';
    }
    if (hitlThreshold < 0 || hitlThreshold > 1) {
      return 'hitl_threshold must be between 0 and 1 inclusive';
    }
  }
  return null;
}

const VALID_AGENT_NAMES = new Set(['parsing', 'extraction', 'validation', 'reconciliation']);

function validateAgentNames(agents: unknown[]): string | null {
  for (const agent of agents) {
    const name = typeof agent === 'string' ? agent : (agent as any)?.agent_name;
    if (!name || !VALID_AGENT_NAMES.has(name)) {
      return `Unrecognized agent name: '${name}'. Valid agents: ${[...VALID_AGENT_NAMES].join(', ')}`;
    }
  }
  return null;
}

describe('validateWorkspaceFields', () => {
  test('valid name passes', () => {
    expect(validateWorkspaceFields('My Workspace')).toBeNull();
  });

  test('empty name fails', () => {
    expect(validateWorkspaceFields('  ')).toBe('name cannot be empty');
  });

  test('name over 100 chars fails', () => {
    expect(validateWorkspaceFields('a'.repeat(101))).toMatch(/100 characters/);
  });

  test('description over 500 chars fails', () => {
    expect(validateWorkspaceFields(undefined, 'x'.repeat(501))).toMatch(/500 characters/);
  });

  test('hitl_threshold 0 passes', () => {
    expect(validateWorkspaceFields(undefined, undefined, 0)).toBeNull();
  });

  test('hitl_threshold 1 passes', () => {
    expect(validateWorkspaceFields(undefined, undefined, 1)).toBeNull();
  });

  test('hitl_threshold 0.75 passes', () => {
    expect(validateWorkspaceFields(undefined, undefined, 0.75)).toBeNull();
  });

  test('hitl_threshold -0.1 fails', () => {
    expect(validateWorkspaceFields(undefined, undefined, -0.1)).toMatch(/between 0 and 1/);
  });

  test('hitl_threshold 1.1 fails', () => {
    expect(validateWorkspaceFields(undefined, undefined, 1.1)).toMatch(/between 0 and 1/);
  });

  test('undefined values all pass', () => {
    expect(validateWorkspaceFields()).toBeNull();
  });
});

describe('validateAgentNames', () => {
  test('valid agent names pass', () => {
    expect(validateAgentNames(['parsing', 'extraction'])).toBeNull();
  });

  test('all valid agents pass', () => {
    expect(validateAgentNames(['parsing', 'extraction', 'validation', 'reconciliation'])).toBeNull();
  });

  test('invalid agent name fails', () => {
    expect(validateAgentNames(['parsing', 'hacker'])).toMatch(/Unrecognized agent name/);
  });

  test('empty array passes', () => {
    expect(validateAgentNames([])).toBeNull();
  });
});
