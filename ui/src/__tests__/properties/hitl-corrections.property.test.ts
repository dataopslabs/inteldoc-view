/**
 * Property-based tests for HITL correction submission.
 *
 * **Validates: Requirements 7.5**
 *
 * Property 5: HITL correction submission preserves all changed fields
 *
 * We extract the correction collection logic from the HITL detail page as pure
 * functions and test that for any set of field edits made by a reviewer, the
 * corrections array submitted to the API contains exactly one Correction object
 * for each field whose value was changed, with the correct field_name,
 * original_value, and corrected_value.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// --- Types (mirroring api.ts) ---

interface Correction {
  field_name: string;
  original_value: unknown;
  corrected_value: unknown;
}

// --- Extracted logic from HITL detail page ---

/**
 * Mirrors the handleFieldChange logic in hitl/[trace_id]/page.tsx:
 *
 * Tracks corrections in a Map<string, { original_value, corrected_value }>.
 * If the new value equals the original (stringified), the entry is removed
 * (field is no longer considered changed). Otherwise, the entry is set.
 */
function applyFieldChange(
  corrections: Map<string, { original_value: unknown; corrected_value: string }>,
  fieldName: string,
  originalValue: unknown,
  newValue: string
): Map<string, { original_value: unknown; corrected_value: string }> {
  const next = new Map(corrections);
  const originalStr = String(originalValue ?? '');
  if (newValue === originalStr) {
    next.delete(fieldName);
  } else {
    next.set(fieldName, { original_value: originalValue, corrected_value: newValue });
  }
  return next;
}

/**
 * Mirrors the correction collection in handleSubmitCorrections:
 *
 * Converts the corrections Map into a Correction[] array for API submission.
 */
function collectCorrections(
  corrections: Map<string, { original_value: unknown; corrected_value: string }>
): Correction[] {
  return Array.from(corrections.entries()).map(
    ([field_name, { original_value, corrected_value }]) => ({
      field_name,
      original_value,
      corrected_value,
    })
  );
}

/**
 * Simulates a full editing session: given a set of fields with original values
 * and edited values, applies all edits and returns the resulting corrections.
 */
function simulateEditSession(
  fields: { fieldName: string; originalValue: string; editedValue: string }[]
): Correction[] {
  let corrections = new Map<string, { original_value: unknown; corrected_value: string }>();
  for (const { fieldName, originalValue, editedValue } of fields) {
    corrections = applyFieldChange(corrections, fieldName, originalValue, editedValue);
  }
  return collectCorrections(corrections);
}

// --- Generators ---

/** Generates a field name (alphanumeric with underscores, like real field names) */
const fieldNameArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_0123456789'.split('')),
  { minLength: 1, maxLength: 20 }
);

/** Generates a field value (any non-empty string) */
const fieldValueArb = fc.string({ minLength: 1, maxLength: 50 });

/** Generates a field edit where the value IS changed */
const changedFieldArb = fc
  .tuple(fieldNameArb, fieldValueArb, fieldValueArb)
  .filter(([, original, edited]) => original !== edited)
  .map(([fieldName, originalValue, editedValue]) => ({
    fieldName,
    originalValue,
    editedValue,
  }));

/** Generates a field edit where the value is NOT changed */
const unchangedFieldArb = fc
  .tuple(fieldNameArb, fieldValueArb)
  .map(([fieldName, value]) => ({
    fieldName,
    originalValue: value,
    editedValue: value,
  }));

/** Generates a mixed set of field edits with unique field names */
const fieldEditsArb = fc
  .array(
    fc.oneof(
      { weight: 3, arbitrary: changedFieldArb },
      { weight: 2, arbitrary: unchangedFieldArb }
    ),
    { minLength: 1, maxLength: 15 }
  )
  .map((edits) => {
    // Deduplicate by field name — last edit wins (simulates user editing a field multiple times)
    const byName = new Map<string, (typeof edits)[number]>();
    for (const edit of edits) {
      byName.set(edit.fieldName, edit);
    }
    return Array.from(byName.values());
  });

// --- Property Tests ---

describe('HITL correction submission', () => {
  describe('Property 5: HITL correction submission preserves all changed fields', () => {
    it('should include exactly one Correction for each changed field', () => {
      /**
       * **Validates: Requirements 7.5**
       *
       * For any set of field edits, the corrections array length must equal
       * the number of fields whose edited value differs from the original.
       */
      fc.assert(
        fc.property(fieldEditsArb, (edits) => {
          const corrections = simulateEditSession(edits);
          const changedCount = edits.filter(
            (e) => e.editedValue !== e.originalValue
          ).length;
          expect(corrections.length).toBe(changedCount);
        }),
        { numRuns: 300 }
      );
    });

    it('should NOT include unchanged fields in the corrections array', () => {
      /**
       * **Validates: Requirements 7.5**
       *
       * Fields where the edited value equals the original value must not
       * appear in the corrections array.
       */
      fc.assert(
        fc.property(fieldEditsArb, (edits) => {
          const corrections = simulateEditSession(edits);
          const unchangedFieldNames = edits
            .filter((e) => e.editedValue === e.originalValue)
            .map((e) => e.fieldName);
          const correctionFieldNames = corrections.map((c) => c.field_name);

          for (const name of unchangedFieldNames) {
            expect(correctionFieldNames).not.toContain(name);
          }
        }),
        { numRuns: 300 }
      );
    });

    it('should have correct field_name, original_value, and corrected_value for each correction', () => {
      /**
       * **Validates: Requirements 7.5**
       *
       * Each Correction object must carry the correct field_name,
       * original_value, and corrected_value matching the edit.
       */
      fc.assert(
        fc.property(fieldEditsArb, (edits) => {
          const corrections = simulateEditSession(edits);
          const changedEdits = edits.filter(
            (e) => e.editedValue !== e.originalValue
          );

          for (const edit of changedEdits) {
            const correction = corrections.find(
              (c) => c.field_name === edit.fieldName
            );
            expect(correction).toBeDefined();
            expect(correction!.original_value).toBe(edit.originalValue);
            expect(correction!.corrected_value).toBe(edit.editedValue);
          }
        }),
        { numRuns: 300 }
      );
    });

    it('should produce an empty corrections array when no fields are changed', () => {
      /**
       * **Validates: Requirements 7.5**
       *
       * If the reviewer edits fields but sets them all back to their
       * original values, the corrections array must be empty.
       */
      fc.assert(
        fc.property(
          fc.array(unchangedFieldArb, { minLength: 1, maxLength: 10 }),
          (edits) => {
            // Deduplicate by field name
            const byName = new Map<string, (typeof edits)[number]>();
            for (const edit of edits) {
              byName.set(edit.fieldName, edit);
            }
            const corrections = simulateEditSession(Array.from(byName.values()));
            expect(corrections.length).toBe(0);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should remove a field from corrections when its value is reverted to original', () => {
      /**
       * **Validates: Requirements 7.5**
       *
       * If a reviewer changes a field and then changes it back to the
       * original value, that field must not appear in the corrections.
       */
      fc.assert(
        fc.property(
          fieldNameArb,
          fieldValueArb,
          fieldValueArb.filter((v) => v.length > 0),
          (fieldName, originalValue, intermediateValue) => {
            fc.pre(intermediateValue !== originalValue);

            // Step 1: Change the field
            let corrections = new Map<
              string,
              { original_value: unknown; corrected_value: string }
            >();
            corrections = applyFieldChange(
              corrections,
              fieldName,
              originalValue,
              intermediateValue
            );
            expect(corrections.size).toBe(1);

            // Step 2: Revert the field back to original
            corrections = applyFieldChange(
              corrections,
              fieldName,
              originalValue,
              originalValue
            );
            expect(corrections.size).toBe(0);

            const result = collectCorrections(corrections);
            expect(result.length).toBe(0);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should handle null/undefined original values by stringifying them', () => {
      /**
       * **Validates: Requirements 7.5**
       *
       * The HITL detail page converts original values to strings via
       * String(originalValue ?? ''). A field is considered unchanged if
       * the edited value equals this stringified original.
       */
      fc.assert(
        fc.property(
          fieldNameArb,
          fc.constantFrom(null, undefined, '', 0, false),
          fieldValueArb,
          (fieldName, originalValue, editedValue) => {
            const originalStr = String(originalValue ?? '');
            fc.pre(editedValue !== originalStr);

            let corrections = new Map<
              string,
              { original_value: unknown; corrected_value: string }
            >();
            corrections = applyFieldChange(
              corrections,
              fieldName,
              originalValue,
              editedValue
            );
            const result = collectCorrections(corrections);

            expect(result.length).toBe(1);
            expect(result[0].field_name).toBe(fieldName);
            expect(result[0].original_value).toBe(originalValue);
            expect(result[0].corrected_value).toBe(editedValue);
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
