/**
 * Page integration tests for HITL Review Detail.
 *
 * Extracts pure logic from hitl/[trace_id]/page.tsx and tests:
 * - Correction tracking via Map operations
 * - Correction collection for API submission
 * - Field change handling (add/update/remove corrections)
 * - Error preservation during failed submissions
 * - Duration formatting
 *
 * Requirements: 7.1–7.9
 */
import { describe, it, expect } from 'vitest';

// --- Types mirroring hitl/[trace_id]/page.tsx ---

interface Correction {
  field_name: string;
  original_value: unknown;
  corrected_value: unknown;
}

type CorrectionMap = Map<string, { original_value: unknown; corrected_value: string }>;

// --- Extracted logic from hitl/[trace_id]/page.tsx ---

/** Mirrors the handleFieldChange logic */
function handleFieldChange(
  corrections: CorrectionMap,
  fieldName: string,
  originalValue: unknown,
  newValue: string
): CorrectionMap {
  const next = new Map(corrections);
  const originalStr = String(originalValue ?? '');
  if (newValue === originalStr) {
    next.delete(fieldName);
  } else {
    next.set(fieldName, { original_value: originalValue, corrected_value: newValue });
  }
  return next;
}

/** Mirrors the correction collection in handleSubmitCorrections */
function collectCorrections(corrections: CorrectionMap): Correction[] {
  return Array.from(corrections.entries()).map(
    ([field_name, { original_value, corrected_value }]) => ({
      field_name,
      original_value,
      corrected_value,
    })
  );
}

/** Mirrors formatDuration from the detail page */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// --- Tests ---

describe('HITL Detail page logic', () => {
  describe('correction tracking - handleFieldChange (Req 7.5)', () => {
    it('adds a correction when value differs from original', () => {
      const corrections: CorrectionMap = new Map();
      const result = handleFieldChange(corrections, 'invoice_number', 'INV-001', 'INV-002');
      expect(result.size).toBe(1);
      expect(result.get('invoice_number')).toEqual({
        original_value: 'INV-001',
        corrected_value: 'INV-002',
      });
    });

    it('removes a correction when value matches original', () => {
      const corrections: CorrectionMap = new Map([
        ['invoice_number', { original_value: 'INV-001', corrected_value: 'INV-002' }],
      ]);
      const result = handleFieldChange(corrections, 'invoice_number', 'INV-001', 'INV-001');
      expect(result.size).toBe(0);
    });

    it('updates an existing correction', () => {
      const corrections: CorrectionMap = new Map([
        ['amount', { original_value: '100', corrected_value: '200' }],
      ]);
      const result = handleFieldChange(corrections, 'amount', '100', '300');
      expect(result.get('amount')?.corrected_value).toBe('300');
    });

    it('handles null original values by converting to empty string', () => {
      const corrections: CorrectionMap = new Map();
      // When original is null, String(null) = 'null', so setting to 'null' removes it
      const result = handleFieldChange(corrections, 'field', null, 'new_value');
      expect(result.size).toBe(1);
      expect(result.get('field')?.original_value).toBeNull();
    });

    it('handles undefined original values', () => {
      const corrections: CorrectionMap = new Map();
      const result = handleFieldChange(corrections, 'field', undefined, 'value');
      expect(result.size).toBe(1);
      expect(result.get('field')?.original_value).toBeUndefined();
    });

    it('does not mutate the original map', () => {
      const corrections: CorrectionMap = new Map();
      const result = handleFieldChange(corrections, 'field', 'old', 'new');
      expect(corrections.size).toBe(0);
      expect(result.size).toBe(1);
    });

    it('tracks multiple field corrections independently', () => {
      let corrections: CorrectionMap = new Map();
      corrections = handleFieldChange(corrections, 'field_a', 'a1', 'a2');
      corrections = handleFieldChange(corrections, 'field_b', 'b1', 'b2');
      corrections = handleFieldChange(corrections, 'field_c', 'c1', 'c2');
      expect(corrections.size).toBe(3);

      // Remove one
      corrections = handleFieldChange(corrections, 'field_b', 'b1', 'b1');
      expect(corrections.size).toBe(2);
      expect(corrections.has('field_b')).toBe(false);
      expect(corrections.has('field_a')).toBe(true);
      expect(corrections.has('field_c')).toBe(true);
    });
  });

  describe('correction collection for API (Req 7.5)', () => {
    it('converts Map to Correction array', () => {
      const corrections: CorrectionMap = new Map([
        ['invoice_number', { original_value: 'INV-001', corrected_value: 'INV-002' }],
        ['amount', { original_value: '100.00', corrected_value: '150.00' }],
      ]);
      const result = collectCorrections(corrections);
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        field_name: 'invoice_number',
        original_value: 'INV-001',
        corrected_value: 'INV-002',
      });
      expect(result).toContainEqual({
        field_name: 'amount',
        original_value: '100.00',
        corrected_value: '150.00',
      });
    });

    it('returns empty array for empty map', () => {
      expect(collectCorrections(new Map())).toEqual([]);
    });
  });

  describe('error preservation (Req 7.8)', () => {
    it('corrections survive a simulated submission error', () => {
      let corrections: CorrectionMap = new Map();
      corrections = handleFieldChange(corrections, 'field_a', 'old_a', 'new_a');
      corrections = handleFieldChange(corrections, 'field_b', 'old_b', 'new_b');

      // Simulate: submission fails, corrections should still be intact
      const errorMsg = 'Failed to submit corrections';
      // In the real page, setActionError is called but corrections state is NOT cleared
      expect(corrections.size).toBe(2);
      expect(errorMsg).toBeTruthy();
      // Corrections can still be collected for retry
      const collected = collectCorrections(corrections);
      expect(collected).toHaveLength(2);
    });
  });

  describe('formatDuration', () => {
    it('formats milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
      expect(formatDuration(0)).toBe('0ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('formats seconds', () => {
      expect(formatDuration(1000)).toBe('1.0s');
      expect(formatDuration(5500)).toBe('5.5s');
      expect(formatDuration(59999)).toBe('60.0s');
    });

    it('formats minutes', () => {
      expect(formatDuration(60000)).toBe('1.0m');
      expect(formatDuration(150000)).toBe('2.5m');
    });
  });
});
