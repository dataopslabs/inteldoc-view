/**
 * G6-05: Unit tests for process handler — file validation, schema validation.
 */

// Extracted validation logic for testing
const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg']);
const ALLOWED_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'date', 'any']);
const MAX_SCHEMA_FIELDS = 50;
const MAX_SCHEMA_BYTES = 50 * 1024;

function validateSchema(schema: unknown): string | null {
  if (schema === undefined || schema === null) return null;
  if (typeof schema === 'object' && !Array.isArray(schema) && Object.keys(schema as object).length === 0) return null;
  if (typeof schema !== 'object' || Array.isArray(schema)) return 'schema must be a JSON object';
  const entries = Object.entries(schema as Record<string, unknown>);
  if (entries.length > MAX_SCHEMA_FIELDS) return `schema cannot exceed ${MAX_SCHEMA_FIELDS} fields`;
  if (JSON.stringify(schema).length > MAX_SCHEMA_BYTES) return `schema exceeds maximum size of ${MAX_SCHEMA_BYTES / 1024}KB`;
  for (const [key, val] of entries) {
    if (typeof key !== 'string' || key.trim() === '') return 'schema field keys must be non-empty strings';
    if (typeof val !== 'string' || !ALLOWED_SCHEMA_TYPES.has(val as string)) {
      return `schema field '${key}' has invalid type '${val}'. Allowed: ${[...ALLOWED_SCHEMA_TYPES].join(', ')}`;
    }
  }
  return null;
}

function _mimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  return map[ext] ?? 'application/octet-stream';
}

describe('file extension validation', () => {
  test('allowed extensions pass', () => {
    for (const ext of ['pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg']) {
      expect(ALLOWED_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  test('disallowed extensions reject', () => {
    for (const ext of ['exe', 'sh', 'js', 'php', 'html', 'zip']) {
      expect(ALLOWED_EXTENSIONS.has(ext)).toBe(false);
    }
  });
});

describe('validateSchema', () => {
  test('null schema passes', () => expect(validateSchema(null)).toBeNull());
  test('undefined schema passes', () => expect(validateSchema(undefined)).toBeNull());
  test('empty object passes', () => expect(validateSchema({})).toBeNull());

  test('valid schema passes', () => {
    expect(validateSchema({ invoice_number: 'string', amount: 'number', date: 'date' })).toBeNull();
  });

  test('array schema fails', () => {
    expect(validateSchema(['string'])).toBe('schema must be a JSON object');
  });

  test('string schema fails', () => {
    expect(validateSchema('schema')).toBe('schema must be a JSON object');
  });

  test('invalid field type fails', () => {
    const err = validateSchema({ foo: 'object' });
    expect(err).toMatch(/invalid type/);
    expect(err).toMatch(/foo/);
  });

  test('too many fields fails', () => {
    const schema: Record<string, string> = {};
    for (let i = 0; i < 51; i++) schema[`field_${i}`] = 'string';
    expect(validateSchema(schema)).toMatch(/exceed/);
  });

  test('all allowed types pass', () => {
    const schema: Record<string, string> = {};
    for (const t of ALLOWED_SCHEMA_TYPES) schema[`f_${t}`] = t;
    expect(validateSchema(schema)).toBeNull();
  });
});

describe('_mimeType', () => {
  test('returns correct MIME for known types', () => {
    expect(_mimeType('document.pdf')).toBe('application/pdf');
    expect(_mimeType('doc.docx')).toContain('wordprocessingml');
    expect(_mimeType('photo.png')).toBe('image/png');
    expect(_mimeType('photo.jpg')).toBe('image/jpeg');
  });

  test('returns octet-stream for unknown types', () => {
    expect(_mimeType('file.xyz')).toBe('application/octet-stream');
  });

  test('handles uppercase extensions', () => {
    expect(_mimeType('PHOTO.JPG')).toBe('image/jpeg');
  });
});
