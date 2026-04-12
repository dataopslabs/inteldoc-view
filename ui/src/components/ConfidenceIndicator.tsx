'use client';

import React from 'react';

export interface ConfidenceIndicatorProps {
  value: number;          // 0.0 to 1.0
  variant?: 'default' | 'sentry';  // 'sentry' uses lime #c2ef4e
  showLabel?: boolean;
}

/**
 * Returns the bar color for the default variant based on confidence thresholds.
 * green (#27a644) >= 0.8, amber (#f59e0b) >= 0.5, red (#ef4444) < 0.5
 */
export function getConfidenceColor(value: number): string {
  if (value >= 0.8) return '#27a644';
  if (value >= 0.5) return '#f59e0b';
  return '#ef4444';
}

export function ConfidenceIndicator({
  value,
  variant = 'default',
  showLabel = true,
}: ConfidenceIndicatorProps) {
  const clampedValue = Math.max(0, Math.min(1, value));
  const percentage = Math.round(clampedValue * 100);

  const isSentry = variant === 'sentry';
  const barColor = isSentry ? '#c2ef4e' : getConfidenceColor(clampedValue);
  const barOpacity = isSentry ? clampedValue : 1;

  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-2 flex-1 rounded-full overflow-hidden"
        style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{
            width: `${percentage}%`,
            backgroundColor: barColor,
            opacity: barOpacity,
          }}
        />
      </div>
      {showLabel && (
        <span
          className="text-xs font-medium tabular-nums"
          style={{ color: barColor, opacity: barOpacity }}
        >
          {percentage}%
        </span>
      )}
    </div>
  );
}
