'use client';

import React, { useRef, useState, useCallback } from 'react';

export interface DropZoneProps {
  onFile: (file: File) => void;
  accept?: string;          // e.g. ".pdf,.docx,.png,.jpg"
  disabled?: boolean;
  uploading?: boolean;
}

/**
 * Checks whether a file's extension matches the accept string.
 * If accept is undefined or empty, all files are accepted.
 * The accept string is a comma-separated list of extensions (e.g. ".pdf,.docx,.png,.jpg").
 */
export function isFileAccepted(fileName: string, accept?: string): boolean {
  if (!accept || accept.trim() === '') return true;

  const extensions = accept
    .split(',')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.length > 0);

  if (extensions.length === 0) return true;

  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return false;

  const fileExt = fileName.slice(dotIndex).toLowerCase();
  return extensions.includes(fileExt);
}

export function DropZone({ onFile, accept, disabled = false, uploading = false }: DropZoneProps) {
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !uploading) setDragover(true);
  }, [disabled, uploading]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragover(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragover(false);

    if (disabled || uploading) return;

    const file = e.dataTransfer.files?.[0];
    if (file && isFileAccepted(file.name, accept)) {
      onFile(file);
    }
  }, [disabled, uploading, accept, onFile]);

  const handleClick = useCallback(() => {
    if (!disabled && !uploading) {
      inputRef.current?.click();
    }
  }, [disabled, uploading]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && isFileAccepted(file.name, accept)) {
      onFile(file);
    }
    // Reset so the same file can be selected again
    if (inputRef.current) inputRef.current.value = '';
  }, [accept, onFile]);

  // Visual state classes
  let borderClasses = 'border-2 border-dashed border-white/20';
  let bgClasses = '';
  let extraClasses = '';

  if (disabled) {
    extraClasses = 'opacity-50 cursor-not-allowed';
  } else if (uploading) {
    borderClasses = 'border-2 border-dashed border-indigo-400/50';
    extraClasses = 'animate-pulse cursor-wait';
  } else if (dragover) {
    borderClasses = 'border-2 border-solid border-indigo-500';
    bgClasses = 'bg-indigo-500/10';
    extraClasses = 'cursor-pointer';
  } else {
    extraClasses = 'cursor-pointer hover:border-white/40';
  }

  let label = 'Drop a file or click to upload';
  if (uploading) label = 'Uploading...';
  if (disabled) label = 'Upload disabled';

  return (
    <div
      role="button"
      tabIndex={disabled || uploading ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || uploading}
      className={`rounded-lg p-8 text-center transition-all ${borderClasses} ${bgClasses} ${extraClasses}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <p className="text-sm text-white/50">{label}</p>
      {accept && !uploading && !disabled && (
        <p className="mt-1 text-xs text-white/30">
          Supported: {accept}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleInputChange}
        disabled={disabled || uploading}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
