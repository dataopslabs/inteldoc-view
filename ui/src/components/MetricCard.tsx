'use client';

import React from 'react';

export interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

function TrendIndicator({ trend }: { trend: 'up' | 'down' | 'neutral' }) {
  if (trend === 'up') {
    return <span className="text-green-400 text-sm ml-2">↑</span>;
  }
  if (trend === 'down') {
    return <span className="text-red-400 text-sm ml-2">↓</span>;
  }
  return <span className="text-gray-500 text-sm ml-2">–</span>;
}

export function MetricCard({ label, value, subtitle, trend, color }: MetricCardProps) {
  return (
    <div
      className="rounded-lg p-4"
      style={{
        backgroundColor: '#0f1011',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <p className="text-sm text-gray-400 mb-1">{label}</p>
      <div className="flex items-center">
        <span
          className="text-2xl font-semibold text-white"
          style={color ? { color } : undefined}
        >
          {value}
        </span>
        {trend && <TrendIndicator trend={trend} />}
      </div>
      {subtitle && (
        <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
      )}
    </div>
  );
}
