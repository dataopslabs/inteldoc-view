import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { applyCorrections } from '../handlers/hitl';
import { Correction } from '../models/types';

// --- Arbitraries ---

/** Arbitrary for a single extracted field */
const fieldArb = fc.record({
  field_name: fc.string({ minLength: 1, maxLength: 20 }),
  value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
});

/** Arbitrary for a single correction */
const correctionArb = fc.record({
  field_name: fc.string({ minLength: 1, maxLength: 20 }),
  original_value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  corrected_value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
});

/**
 * Generate fields and corrections with GUARANTEED non-overlapping field_names.
 * Fields use "field_<i>" names, corrections use "corr_<j>" names.
 */
const nonOverlappingArb = fc.tuple(
  fc.array(fc.nat({ max: 99 }), { minLength: 1, maxLength: 10 }),
  fc.array(fc.nat({ max: 99 }), { minLength: 0, maxLength: 10 }),
).chain(([fieldIndices, corrIndices]) => {
  const fields = fieldIndices.map((idx, i) =>
    fc.record({
      field_name: fc.constant(`field_${i}_${idx}`),
      value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    })
  );
  const corrections = corrIndices.map((idx, j) =>
    fc.record({
      field_name: fc.constant(`corr_${j}_${idx}`),
      original_value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      corrected_value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    })
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fc.tuple(fc.tuple(...(fields.length ? fields : [fieldArb]) as any[]), fc.tuple(...(corrections.length ? corrections : [correctionArb]) as any[]));
}).map(([fields, corrections]) => ({ fields: [...fields], corrections: [...corrections] }));

/**
 * Generate fields and corrections with GUARANTEED overlapping field_names.
 * At least one correction targets a field that exists.
 */
const overlappingArb = fc
  .array(
    fc.record({
      value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    { minLength: 1, maxLength: 10 }
  )
  .chain((fieldBodies) => {
    const fieldNames = fieldBodies.map((_, i) => `shared_${i}`);
    const fields = fieldBodies.map((body, i) => ({
      field_name: fieldNames[i],
      ...body,
    }));
    // Generate at least one correction that targets an existing field
    const overlappingCorrections = fc.array(
      fc.record({
        index: fc.nat({ max: fieldNames.length - 1 }),
        original_value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
        corrected_value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      }),
      { minLength: 1, maxLength: 10 }
    ).map((corrs) =>
      corrs.map((c) => ({
        field_name: fieldNames[c.index],
        original_value: c.original_value,
        corrected_value: c.corrected_value,
      }))
    );
    return fc.tuple(fc.constant(fields), overlappingCorrections);
  })
  .map(([fields, corrections]) => ({ fields, corrections }));

describe('applyCorrections — Property-Based Tests', () => {
  /**
   * Property 1: Applying corrections preserves uncorrected fields
   * **Validates: Requirements 6.2**
   */
  it('Property 1: uncorrected fields retain original value and confidence', () => {
    fc.assert(
      fc.property(nonOverlappingArb, ({ fields, corrections }) => {
        const result = applyCorrections(fields, corrections);
        const correctedNames = new Set<string>(corrections.map((c) => c.field_name as string));

        for (let i = 0; i < fields.length; i++) {
          if (!correctedNames.has(fields[i].field_name)) {
            expect(result[i].field_name).toBe(fields[i].field_name);
            expect(result[i].value).toEqual(fields[i].value);
            expect(result[i].confidence).toBe(fields[i].confidence);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  /**
   * Property 2: Applying corrections replaces matched field values
   * **Validates: Requirements 6.2**
   */
  it('Property 2: matched fields have corrected_value and confidence 1.0', () => {
    fc.assert(
      fc.property(overlappingArb, ({ fields, corrections }) => {
        const result = applyCorrections(fields, corrections);

        // Build expected correction map (last correction wins)
        const expectedMap = new Map<string, unknown>();
        for (const c of corrections) {
          expectedMap.set(c.field_name, c.corrected_value);
        }

        for (let i = 0; i < fields.length; i++) {
          if (expectedMap.has(fields[i].field_name)) {
            expect(result[i].value).toEqual(expectedMap.get(fields[i].field_name));
            expect(result[i].confidence).toBe(1.0);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  /**
   * Property 3: Correction application is idempotent on field count
   * **Validates: Requirements 6.2**
   */
  it('Property 3: output length equals input length', () => {
    fc.assert(
      fc.property(
        fc.array(fieldArb, { minLength: 0, maxLength: 20 }),
        fc.array(correctionArb, { minLength: 0, maxLength: 20 }),
        (fields, corrections) => {
          const result = applyCorrections(fields, corrections);
          expect(result.length).toBe(fields.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Property 5: Later corrections override earlier corrections for the same field
   * **Validates: Requirements 5.7**
   */
  it('Property 5: last correction wins for duplicate field_names', () => {
    fc.assert(
      fc.property(
        // Generate a base field
        fc.record({
          value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
          confidence: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        // Generate multiple corrections for the SAME field_name
        fc.array(
          fc.record({
            original_value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
            corrected_value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
          }),
          { minLength: 2, maxLength: 10 }
        ),
        (fieldBody, corrBodies) => {
          const fieldName = 'duplicate_target';
          const fields = [{ field_name: fieldName, ...fieldBody }];
          const corrections: Correction[] = corrBodies.map((c) => ({
            field_name: fieldName,
            ...c,
          }));

          const result = applyCorrections(fields, corrections);
          const lastCorrection = corrections[corrections.length - 1];

          expect(result[0].value).toEqual(lastCorrection.corrected_value);
          expect(result[0].confidence).toBe(1.0);
        }
      ),
      { numRuns: 200 }
    );
  });
});
