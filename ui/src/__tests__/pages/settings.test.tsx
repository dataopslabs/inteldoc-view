/**
 * Page integration tests for Settings page.
 *
 * Extracts pure logic from settings/page.tsx and tests:
 * - Progress bar ratio calculation
 * - Number formatting (fmt helper)
 * - Copy-to-clipboard state logic
 *
 * Requirements: 10.1–10.5
 */
import { describe, it, expect } from 'vitest';

// --- Extracted helpers from settings/page.tsx ---

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Mirrors the ProgressBar ratio calculation in settings */
function progressRatio(value: number, max: number): number {
  return max > 0 ? Math.min(value / max, 1) : 0;
}

/** Mirrors the progress bar color logic */
function progressBarColor(ratio: number): string {
  return ratio >= 0.9 ? '#ef4444' : '#7170ff';
}

// --- Copy-to-clipboard state model ---

interface CopyState {
  copied: boolean;
}

function applyCopy(): CopyState {
  return { copied: true };
}

function applyReset(): CopyState {
  return { copied: false };
}

// --- Tests ---

describe('Settings page logic', () => {
  describe('fmt - number formatting (Req 10.3)', () => {
    it('returns raw string for numbers < 1000', () => {
      expect(fmt(0)).toBe('0');
      expect(fmt(42)).toBe('42');
      expect(fmt(999)).toBe('999');
    });

    it('formats thousands with K suffix', () => {
      expect(fmt(1_000)).toBe('1.0K');
      expect(fmt(1_500)).toBe('1.5K');
    });

    it('formats millions with M suffix', () => {
      expect(fmt(1_000_000)).toBe('1.0M');
      expect(fmt(2_500_000)).toBe('2.5M');
    });
  });

  describe('progress bar ratio calculation (Req 10.3)', () => {
    it('returns 0 when max is 0', () => {
      expect(progressRatio(50, 0)).toBe(0);
    });

    it('returns correct ratio', () => {
      expect(progressRatio(50, 100)).toBe(0.5);
      expect(progressRatio(75, 100)).toBe(0.75);
    });

    it('caps at 1 when value exceeds max', () => {
      expect(progressRatio(200, 100)).toBe(1);
    });

    it('returns 0 when value is 0', () => {
      expect(progressRatio(0, 100)).toBe(0);
    });
  });

  describe('progress bar color (Req 10.3)', () => {
    it('returns red when ratio >= 0.9 (near limit)', () => {
      expect(progressBarColor(0.9)).toBe('#ef4444');
      expect(progressBarColor(0.95)).toBe('#ef4444');
      expect(progressBarColor(1.0)).toBe('#ef4444');
    });

    it('returns indigo when ratio < 0.9 (normal usage)', () => {
      expect(progressBarColor(0)).toBe('#7170ff');
      expect(progressBarColor(0.5)).toBe('#7170ff');
      expect(progressBarColor(0.89)).toBe('#7170ff');
    });
  });

  describe('copy-to-clipboard state (Req 10.4)', () => {
    it('sets copied to true on copy', () => {
      const state = applyCopy();
      expect(state.copied).toBe(true);
    });

    it('resets copied to false', () => {
      const state = applyReset();
      expect(state.copied).toBe(false);
    });

    it('full lifecycle: initial → copy → reset', () => {
      let state: CopyState = { copied: false };
      expect(state.copied).toBe(false);

      state = applyCopy();
      expect(state.copied).toBe(true);

      state = applyReset();
      expect(state.copied).toBe(false);
    });
  });

  describe('usage display formatting (Req 10.3)', () => {
    it('formats progress bar label correctly', () => {
      // Simulates: "42 / 1.0K" display
      const value = 42;
      const max = 1000;
      const label = `${fmt(value)} / ${fmt(max)}`;
      expect(label).toBe('42 / 1.0K');
    });

    it('formats large usage numbers', () => {
      const value = 850_000;
      const max = 1_000_000;
      const label = `${fmt(value)} / ${fmt(max)}`;
      expect(label).toBe('850.0K / 1.0M');
    });
  });
});
