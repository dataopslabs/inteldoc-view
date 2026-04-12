import React from 'react';
import { describe, it, expect } from 'vitest';
import { ConfidenceIndicator, getConfidenceColor } from '../../components/ConfidenceIndicator';

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

describe('getConfidenceColor', () => {
  it('returns green for value >= 0.8', () => {
    expect(getConfidenceColor(0.8)).toBe('#27a644');
    expect(getConfidenceColor(0.95)).toBe('#27a644');
    expect(getConfidenceColor(1.0)).toBe('#27a644');
  });

  it('returns amber for value >= 0.5 and < 0.8', () => {
    expect(getConfidenceColor(0.5)).toBe('#f59e0b');
    expect(getConfidenceColor(0.65)).toBe('#f59e0b');
    expect(getConfidenceColor(0.79)).toBe('#f59e0b');
  });

  it('returns red for value < 0.5', () => {
    expect(getConfidenceColor(0.0)).toBe('#ef4444');
    expect(getConfidenceColor(0.3)).toBe('#ef4444');
    expect(getConfidenceColor(0.49)).toBe('#ef4444');
  });
});

describe('ConfidenceIndicator', () => {
  it('renders percentage label by default', () => {
    const result = ConfidenceIndicator({ value: 0.85 });
    const all = flatChildren(result);
    const label = all.find((el) => el.props?.className?.includes('text-xs'));
    expect(label).toBeDefined();
    // Children may be an array like [85, '%'] or a string '85%'
    const children = label!.props.children;
    const text = Array.isArray(children) ? children.join('') : String(children);
    expect(text).toBe('85%');
  });

  it('hides label when showLabel is false', () => {
    const result = ConfidenceIndicator({ value: 0.85, showLabel: false });
    const all = flatChildren(result);
    const label = all.find((el) => el.props?.className?.includes('text-xs'));
    expect(label).toBeUndefined();
  });

  it('uses green bar color for high confidence (default variant)', () => {
    const result = ConfidenceIndicator({ value: 0.9 });
    const all = flatChildren(result);
    const bar = all.find((el) => el.props?.style?.backgroundColor === '#27a644');
    expect(bar).toBeDefined();
  });

  it('uses amber bar color for medium confidence (default variant)', () => {
    const result = ConfidenceIndicator({ value: 0.6 });
    const all = flatChildren(result);
    const bar = all.find((el) => el.props?.style?.backgroundColor === '#f59e0b');
    expect(bar).toBeDefined();
  });

  it('uses red bar color for low confidence (default variant)', () => {
    const result = ConfidenceIndicator({ value: 0.3 });
    const all = flatChildren(result);
    const bar = all.find((el) => el.props?.style?.backgroundColor === '#ef4444');
    expect(bar).toBeDefined();
  });

  it('uses lime color for sentry variant regardless of value', () => {
    const result = ConfidenceIndicator({ value: 0.3, variant: 'sentry' });
    const all = flatChildren(result);
    const bar = all.find((el) => el.props?.style?.backgroundColor === '#c2ef4e');
    expect(bar).toBeDefined();
  });

  it('scales opacity with value in sentry variant', () => {
    const result = ConfidenceIndicator({ value: 0.5, variant: 'sentry' });
    const all = flatChildren(result);
    const bar = all.find((el) => el.props?.style?.backgroundColor === '#c2ef4e');
    expect(bar!.props.style.opacity).toBe(0.5);
  });

  it('uses full opacity in default variant', () => {
    const result = ConfidenceIndicator({ value: 0.5 });
    const all = flatChildren(result);
    const bar = all.find((el) => el.props?.style?.backgroundColor === '#f59e0b');
    expect(bar!.props.style.opacity).toBe(1);
  });

  it('clamps value to 0-1 range', () => {
    const overResult = ConfidenceIndicator({ value: 1.5 });
    const all = flatChildren(overResult);
    const label = all.find((el) => el.props?.className?.includes('text-xs'));
    const overText = Array.isArray(label!.props.children)
      ? label!.props.children.join('')
      : String(label!.props.children);
    expect(overText).toBe('100%');

    const underResult = ConfidenceIndicator({ value: -0.5 });
    const allUnder = flatChildren(underResult);
    const labelUnder = allUnder.find((el) => el.props?.className?.includes('text-xs'));
    const underText = Array.isArray(labelUnder!.props.children)
      ? labelUnder!.props.children.join('')
      : String(labelUnder!.props.children);
    expect(underText).toBe('0%');
  });

  it('sets bar width as percentage', () => {
    const result = ConfidenceIndicator({ value: 0.75 });
    const all = flatChildren(result);
    const bar = all.find((el) => el.props?.style?.width === '75%');
    expect(bar).toBeDefined();
  });
});
