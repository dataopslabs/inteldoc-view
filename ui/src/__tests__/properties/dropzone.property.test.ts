/**
 * Property-based tests for DropZone file type filtering.
 *
 * **Validates: Requirements 3.1**
 *
 * Property 9: DropZone accepts only supported file types
 *
 * We test the isFileAccepted function directly to verify that:
 * - Files with supported extensions are accepted
 * - Files with unsupported extensions are rejected
 * - When accept is undefined, all files are accepted
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isFileAccepted } from '../../components/DropZone';

// --- Constants ---

const ACCEPT_STRING = '.pdf,.docx,.png,.jpg';
const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.png', '.jpg'];
const UNSUPPORTED_EXTENSIONS = ['.exe', '.bat', '.sh', '.zip', '.rar', '.txt', '.csv', '.xml', '.html', '.js', '.ts', '.py', '.rb', '.gif', '.bmp', '.svg', '.mp4', '.mp3'];

// --- Generators ---

/** Generates a random filename base (no dots, alphanumeric + hyphens) */
const filenameBaseArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
  { minLength: 1, maxLength: 30 }
);

/** Generates a filename with a supported extension */
const supportedFileArb = fc.tuple(filenameBaseArb, fc.constantFrom(...SUPPORTED_EXTENSIONS))
  .map(([base, ext]) => `${base}${ext}`);

/** Generates a filename with an unsupported extension */
const unsupportedFileArb = fc.tuple(filenameBaseArb, fc.constantFrom(...UNSUPPORTED_EXTENSIONS))
  .map(([base, ext]) => `${base}${ext}`);

/** Generates a filename with any random extension */
const anyFileArb = fc.tuple(
  filenameBaseArb,
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 5 })
).map(([base, ext]) => `${base}.${ext}`);

// --- Property Tests ---

describe('DropZone file type filtering', () => {
  describe('Property 9: DropZone accepts only supported file types', () => {
    it('should accept files with supported extensions', () => {
      /**
       * **Validates: Requirements 3.1**
       *
       * For any file with a .pdf, .docx, .png, or .jpg extension,
       * isFileAccepted should return true when accept=".pdf,.docx,.png,.jpg".
       */
      fc.assert(
        fc.property(supportedFileArb, (filename) => {
          expect(isFileAccepted(filename, ACCEPT_STRING)).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('should reject files with unsupported extensions', () => {
      /**
       * **Validates: Requirements 3.1**
       *
       * For any file with an extension not in the accept list,
       * isFileAccepted should return false.
       */
      fc.assert(
        fc.property(unsupportedFileArb, (filename) => {
          expect(isFileAccepted(filename, ACCEPT_STRING)).toBe(false);
        }),
        { numRuns: 200 }
      );
    });

    it('should accept all files when accept is undefined', () => {
      /**
       * **Validates: Requirements 3.1**
       *
       * When no accept prop is provided, all files should be accepted.
       */
      fc.assert(
        fc.property(anyFileArb, (filename) => {
          expect(isFileAccepted(filename, undefined)).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('should accept all files when accept is empty string', () => {
      /**
       * **Validates: Requirements 3.1**
       *
       * When accept is an empty string, all files should be accepted.
       */
      fc.assert(
        fc.property(anyFileArb, (filename) => {
          expect(isFileAccepted(filename, '')).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('should be case-insensitive for file extensions', () => {
      /**
       * **Validates: Requirements 3.1**
       *
       * File extension matching should be case-insensitive,
       * so .PDF, .Pdf, .pdf should all be accepted.
       */
      fc.assert(
        fc.property(
          filenameBaseArb,
          fc.constantFrom(...SUPPORTED_EXTENSIONS),
          (base, ext) => {
            const upperFilename = `${base}${ext.toUpperCase()}`;
            expect(isFileAccepted(upperFilename, ACCEPT_STRING)).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should reject files with no extension', () => {
      /**
       * **Validates: Requirements 3.1**
       *
       * Files without any extension should be rejected when accept is specified.
       */
      fc.assert(
        fc.property(filenameBaseArb, (filename) => {
          // Ensure no dot in the filename
          const noExtFilename = filename.replace(/\./g, '');
          if (noExtFilename.length > 0) {
            expect(isFileAccepted(noExtFilename, ACCEPT_STRING)).toBe(false);
          }
        }),
        { numRuns: 200 }
      );
    });
  });
});
