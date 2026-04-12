import React from 'react';
import { describe, it, expect } from 'vitest';
import { MetricCard } from '../../components/MetricCard';

function findByText(element: React.ReactElement, text: string): React.ReactElement | null {
  if (typeof element === 'string') return null;
  const childVal = element.props?.children;
  if (childVal === text || String(childVal) === text) return element;
  const children = React.Children.toArray(element.props?.children ?? []);
  for (const child of children) {
    if ((typeof child === 'string' || typeof child === 'number') && String(child) === text) return element;
    if (React.isValidElement(child)) {
      const found = findByText(child as React.ReactElement, text);
      if (found) return found;
    }
  }
  if (typeof element.type === 'function') {
    try {
      const rendered = (element.type as (props: Record<string, unknown>) => React.ReactElement)(element.props);
      if (React.isValidElement(rendered)) {
        const found = findByText(rendered as React.ReactElement, text);
        if (found) return found;
      }
    } catch { /* skip */ }
  }
  return null;
}

function flatChildren(element: React.ReactElement): React.ReactElement[] {
  const result: React.ReactElement[] = [];
  const children = React.Children.toArray(element.props?.children ?? []);
  for (const child of children) {
    if (React.isValidElement(child)) {
      result.push(child as React.ReactElement);
      result.push(...flatChildren(child as React.ReactElement));
    }
  }
  return result;
}

describe('MetricCard', () => {
  it('renders label text', () => {
    const result = MetricCard({ label: 'Total Traces', value: 42 });
    expect(findByText(result, 'Total Traces')).not.toBeNull();
  });

  it('renders numeric value', () => {
    const result = MetricCard({ label: 'Count', value: 42 });
    expect(findByText(result, '42')).not.toBeNull();
  });

  it('renders string value', () => {
    const result = MetricCard({ label: 'Plan', value: 'Pro' });
    expect(findByText(result, 'Pro')).not.toBeNull();
  });

  it('renders subtitle when provided', () => {
    const result = MetricCard({ label: 'Docs', value: 100, subtitle: '+12 this week' });
    expect(findByText(result, '+12 this week')).not.toBeNull();
  });

  it('does not render subtitle when not provided', () => {
    const result = MetricCard({ label: 'Docs', value: 100 });
    const all = flatChildren(result);
    const subtitleElements = all.filter(
      (el) => el.props?.className?.includes('text-gray-500') && el.props?.className?.includes('mt-1')
    );
    expect(subtitleElements).toHaveLength(0);
  });

  it('applies Linear panel styling', () => {
    const result = MetricCard({ label: 'Test', value: 1 });
    expect(result.props.style.backgroundColor).toBe('#0f1011');
    expect(result.props.style.border).toBe('1px solid rgba(255,255,255,0.06)');
  });
});
