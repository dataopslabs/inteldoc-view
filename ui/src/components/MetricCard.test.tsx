import React from 'react';
import { describe, it, expect } from 'vitest';
import { MetricCard } from './MetricCard';

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
  // Check if element.type is a function component and render it
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
  it('renders label and value', () => {
    const result = MetricCard({ label: 'Total Traces', value: 42 });
    expect(findByText(result, 'Total Traces')).not.toBeNull();
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

  it('renders up trend indicator', () => {
    const result = MetricCard({ label: 'Rate', value: '95%', trend: 'up' });
    expect(findByText(result, '↑')).not.toBeNull();
  });

  it('renders down trend indicator', () => {
    const result = MetricCard({ label: 'Errors', value: 5, trend: 'down' });
    expect(findByText(result, '↓')).not.toBeNull();
  });

  it('renders neutral trend indicator', () => {
    const result = MetricCard({ label: 'Latency', value: '200ms', trend: 'neutral' });
    expect(findByText(result, '–')).not.toBeNull();
  });

  it('does not render trend when not provided', () => {
    const result = MetricCard({ label: 'Count', value: 10 });
    expect(findByText(result, '↑')).toBeNull();
    expect(findByText(result, '↓')).toBeNull();
    expect(findByText(result, '–')).toBeNull();
  });

  it('applies color to value text', () => {
    const result = MetricCard({ label: 'Score', value: '0.95', color: '#c2ef4e' });
    const all = flatChildren(result);
    const valueEl = all.find((el) => el.props?.className?.includes('text-2xl'));
    expect(valueEl?.props?.style?.color).toBe('#c2ef4e');
  });

  it('uses white text when no color provided', () => {
    const result = MetricCard({ label: 'Score', value: '0.95' });
    const all = flatChildren(result);
    const valueEl = all.find((el) => el.props?.className?.includes('text-2xl'));
    expect(valueEl?.props?.style).toBeUndefined();
  });

  it('applies Linear panel styling', () => {
    const result = MetricCard({ label: 'Test', value: 1 });
    expect(result.props.style.backgroundColor).toBe('#0f1011');
    expect(result.props.style.border).toBe('1px solid rgba(255,255,255,0.06)');
  });

  it('has rounded corners', () => {
    const result = MetricCard({ label: 'Test', value: 1 });
    expect(result.props.className).toContain('rounded-lg');
  });
});
