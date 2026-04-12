import React from 'react';
import { describe, it, expect } from 'vitest';
import { StatusBadge, STATUS_COLORS } from '../../components/StatusBadge';

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

describe('StatusBadge', () => {
  it('renders pending status with gray color', () => {
    const result = StatusBadge({ status: 'pending' });
    expect(result.props.style.color).toBe('#62666d');
    expect(result.props.style.backgroundColor).toBe('#62666d1a');
  });

  it('renders processing status with amber color', () => {
    const result = StatusBadge({ status: 'processing' });
    expect(result.props.style.color).toBe('#f59e0b');
    expect(result.props.style.backgroundColor).toBe('#f59e0b1a');
  });

  it('renders completed status with green color', () => {
    const result = StatusBadge({ status: 'completed' });
    expect(result.props.style.color).toBe('#27a644');
    expect(result.props.style.backgroundColor).toBe('#27a6441a');
  });

  it('renders failed status with red color', () => {
    const result = StatusBadge({ status: 'failed' });
    expect(result.props.style.color).toBe('#ef4444');
    expect(result.props.style.backgroundColor).toBe('#ef44441a');
  });

  it('renders hitl_required status with indigo color', () => {
    const result = StatusBadge({ status: 'hitl_required' });
    expect(result.props.style.color).toBe('#7170ff');
    expect(result.props.style.backgroundColor).toBe('#7170ff1a');
  });

  it('renders in_review status with amber color', () => {
    const result = StatusBadge({ status: 'in_review' });
    expect(result.props.style.color).toBe('#f59e0b');
  });

  it('renders resolved status with green color', () => {
    const result = StatusBadge({ status: 'resolved' });
    expect(result.props.style.color).toBe('#27a644');
  });

  it('falls back to gray for unknown status', () => {
    const result = StatusBadge({ status: 'unknown_status' });
    expect(result.props.style.color).toBe('#62666d');
  });

  it('formats status text with underscores replaced and capitalized', () => {
    const result = StatusBadge({ status: 'hitl_required' });
    expect(result.props.children).toBe('Hitl Required');
  });

  it('uses sm size classes by default', () => {
    const result = StatusBadge({ status: 'pending' });
    expect(result.props.className).toContain('px-2');
    expect(result.props.className).toContain('text-xs');
  });

  it('uses md size classes when specified', () => {
    const result = StatusBadge({ status: 'pending', size: 'md' });
    expect(result.props.className).toContain('px-3');
    expect(result.props.className).toContain('text-sm');
  });

  it('renders as a span with rounded-full pill styling', () => {
    const result = StatusBadge({ status: 'completed' });
    expect(result.type).toBe('span');
    expect(result.props.className).toContain('rounded-full');
    expect(result.props.className).toContain('inline-flex');
  });

  it('has consistent color mapping for all known statuses', () => {
    const expectedColors: Record<string, string> = {
      pending: '#62666d',
      processing: '#f59e0b',
      completed: '#27a644',
      failed: '#ef4444',
      hitl_required: '#7170ff',
      in_review: '#f59e0b',
      resolved: '#27a644',
    };

    for (const [status, expectedColor] of Object.entries(expectedColors)) {
      expect(STATUS_COLORS[status]).toBe(expectedColor);
    }
  });
});
