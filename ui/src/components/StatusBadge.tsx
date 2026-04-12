'use client';

import React from 'react';

export interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export const STATUS_COLORS: Record<string, string> = {
  pending: '#62666d',
  processing: '#f59e0b',
  completed: '#27a644',
  failed: '#ef4444',
  hitl_required: '#7170ff',
  in_review: '#f59e0b',
  resolved: '#27a644',
};

function formatStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const color = STATUS_COLORS[status] ?? '#62666d';

  const sizeClasses = size === 'md'
    ? 'px-3 py-1 text-sm'
    : 'px-2 py-0.5 text-xs';

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${sizeClasses}`}
      style={{
        backgroundColor: `${color}1a`,
        color: color,
      }}
    >
      {formatStatus(status)}
    </span>
  );
}
