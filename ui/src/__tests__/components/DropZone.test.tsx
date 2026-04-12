import { describe, it, expect } from 'vitest';
import { isFileAccepted } from '../../components/DropZone';

/**
 * Tests for DropZone component logic.
 *
 * The DropZone component uses React hooks (useState, useRef, useCallback)
 * so it cannot be called as a pure function outside a React render context.
 * We test the exported pure function `isFileAccepted` which implements the
 * core file type filtering logic.
 *
 * Validates: Requirements 3.1
 */

describe('DropZone - isFileAccepted', () => {
  describe('when accept is undefined or empty', () => {
    it('accepts all files when accept is undefined', () => {
      expect(isFileAccepted('test.pdf')).toBe(true);
      expect(isFileAccepted('test.xyz')).toBe(true);
      expect(isFileAccepted('anything')).toBe(true);
    });

    it('accepts all files when accept is empty string', () => {
      expect(isFileAccepted('test.pdf', '')).toBe(true);
    });

    it('accepts all files when accept is whitespace', () => {
      expect(isFileAccepted('test.pdf', '   ')).toBe(true);
    });
  });

  describe('file type filtering', () => {
    const accept = '.pdf,.docx,.png,.jpg';

    it('accepts PDF files', () => {
      expect(isFileAccepted('document.pdf', accept)).toBe(true);
    });

    it('accepts DOCX files', () => {
      expect(isFileAccepted('report.docx', accept)).toBe(true);
    });

    it('accepts PNG files', () => {
      expect(isFileAccepted('image.png', accept)).toBe(true);
    });

    it('accepts JPG files', () => {
      expect(isFileAccepted('photo.jpg', accept)).toBe(true);
    });

    it('rejects unsupported file types', () => {
      expect(isFileAccepted('script.js', accept)).toBe(false);
      expect(isFileAccepted('data.csv', accept)).toBe(false);
      expect(isFileAccepted('archive.zip', accept)).toBe(false);
      expect(isFileAccepted('style.css', accept)).toBe(false);
    });
  });

  describe('case insensitivity', () => {
    it('accepts uppercase extensions against lowercase accept', () => {
      expect(isFileAccepted('doc.PDF', '.pdf')).toBe(true);
    });

    it('accepts lowercase extensions against uppercase accept', () => {
      expect(isFileAccepted('img.png', '.PNG')).toBe(true);
    });

    it('handles mixed case', () => {
      expect(isFileAccepted('file.PdF', '.pdf,.DOCX')).toBe(true);
      expect(isFileAccepted('file.Docx', '.pdf,.docx')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('rejects files without extensions', () => {
      expect(isFileAccepted('Makefile', '.pdf,.docx')).toBe(false);
    });

    it('handles extensions with spaces in accept string', () => {
      expect(isFileAccepted('test.pdf', ' .pdf , .docx ')).toBe(true);
      expect(isFileAccepted('test.docx', ' .pdf , .docx ')).toBe(true);
    });

    it('handles files with multiple dots', () => {
      expect(isFileAccepted('my.report.pdf', '.pdf')).toBe(true);
      expect(isFileAccepted('backup.2024.docx', '.docx')).toBe(true);
    });

    it('uses last extension for matching', () => {
      expect(isFileAccepted('file.pdf.zip', '.pdf')).toBe(false);
      expect(isFileAccepted('file.pdf.zip', '.zip')).toBe(true);
    });

    it('handles single extension in accept', () => {
      expect(isFileAccepted('test.pdf', '.pdf')).toBe(true);
      expect(isFileAccepted('test.docx', '.pdf')).toBe(false);
    });
  });

  describe('disabled state logic', () => {
    // The disabled/uploading states prevent file processing in the component.
    // Since those are hook-based, we verify the accept filtering works correctly
    // which is the gate that determines if onFile is called.
    it('filtering works independently of component state', () => {
      // When accept is set, only matching files pass through
      expect(isFileAccepted('valid.pdf', '.pdf,.docx')).toBe(true);
      expect(isFileAccepted('invalid.exe', '.pdf,.docx')).toBe(false);
    });
  });
});
