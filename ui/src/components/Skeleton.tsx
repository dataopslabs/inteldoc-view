'use client';

import React from 'react';

export interface SkeletonProps {
  variant?: 'text' | 'card' | 'row';
  count?: number;
  className?: string;
}

const VARIANT_CLASSES: Record<string, string> = {
  text: 'h-4 w-full rounded',
  card: 'h-32 w-full rounded-lg',
  row: 'h-12 w-full rounded',
};

export function Skeleton({ variant = 'text', count = 1, className = '' }: SkeletonProps) {
  const variantClass = VARIANT_CLASSES[variant];

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`animate-pulse bg-white/5 ${variantClass} ${className}`}
        />
      ))}
    </>
  );
}
