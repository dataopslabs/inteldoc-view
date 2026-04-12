'use client';

import React from 'react';

export interface TimeRangeSelectorProps {
  value: { range?: string; start?: string; end?: string };
  onChange: (value: { range?: string; start?: string; end?: string }) => void;
}

const PRESETS = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
] as const;

export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  const handlePreset = (preset: string) => {
    onChange({ range: preset });
  };

  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const start = e.target.value;
    onChange({ start, end: value.end ?? '' });
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const end = e.target.value;
    onChange({ start: value.start ?? '', end });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-[#0f1011] p-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => handlePreset(preset.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              value.range === preset.value
                ? 'bg-indigo-500 text-white'
                : 'text-gray-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="date"
          aria-label="Start date"
          value={value.start ?? ''}
          onChange={handleStartChange}
          className="rounded-md border border-white/[0.06] bg-[#0f1011] px-3 py-1.5 text-sm text-gray-300 outline-none focus:border-indigo-500"
        />
        <span className="text-gray-500 text-sm">to</span>
        <input
          type="date"
          aria-label="End date"
          value={value.end ?? ''}
          onChange={handleEndChange}
          className="rounded-md border border-white/[0.06] bg-[#0f1011] px-3 py-1.5 text-sm text-gray-300 outline-none focus:border-indigo-500"
        />
      </div>
    </div>
  );
}
