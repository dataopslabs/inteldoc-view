import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { TimeRangeSelector } from '../../components/TimeRangeSelector';

function getButtons(element: React.ReactElement): React.ReactElement[] {
  const rootChildren = React.Children.toArray(element.props.children);
  const presetContainer = rootChildren[0] as React.ReactElement;
  return React.Children.toArray(presetContainer.props.children) as React.ReactElement[];
}

function getDateInputs(element: React.ReactElement): React.ReactElement[] {
  const rootChildren = React.Children.toArray(element.props.children);
  const dateContainer = rootChildren[1] as React.ReactElement;
  return (React.Children.toArray(dateContainer.props.children) as React.ReactElement[]).filter(
    (child) => child.type === 'input'
  );
}

describe('TimeRangeSelector', () => {
  it('renders three preset buttons (24h, 7d, 30d)', () => {
    const result = TimeRangeSelector({ value: {}, onChange: () => {} });
    const buttons = getButtons(result);
    expect(buttons).toHaveLength(3);
    expect(buttons[0].props.children).toBe('24h');
    expect(buttons[1].props.children).toBe('7d');
    expect(buttons[2].props.children).toBe('30d');
  });

  it('highlights active preset with indigo background', () => {
    const result = TimeRangeSelector({ value: { range: '7d' }, onChange: () => {} });
    const buttons = getButtons(result);
    expect(buttons[1].props.className).toContain('bg-indigo-500');
    expect(buttons[0].props.className).not.toContain('bg-indigo-500');
    expect(buttons[2].props.className).not.toContain('bg-indigo-500');
  });

  it('calls onChange with range when preset is clicked', () => {
    const onChange = vi.fn();
    const result = TimeRangeSelector({ value: {}, onChange });
    const buttons = getButtons(result);
    buttons[0].props.onClick();
    expect(onChange).toHaveBeenCalledWith({ range: '24h' });
  });

  it('calls onChange with range for each preset', () => {
    const onChange = vi.fn();
    const result = TimeRangeSelector({ value: {}, onChange });
    const buttons = getButtons(result);

    buttons[1].props.onClick();
    expect(onChange).toHaveBeenCalledWith({ range: '7d' });

    buttons[2].props.onClick();
    expect(onChange).toHaveBeenCalledWith({ range: '30d' });
  });

  it('renders two date inputs for custom range', () => {
    const result = TimeRangeSelector({ value: {}, onChange: () => {} });
    const inputs = getDateInputs(result);
    expect(inputs).toHaveLength(2);
    expect(inputs[0].props.type).toBe('date');
    expect(inputs[1].props.type).toBe('date');
  });

  it('calls onChange with start and end when start date changes', () => {
    const onChange = vi.fn();
    const result = TimeRangeSelector({ value: { end: '2024-01-31' }, onChange });
    const inputs = getDateInputs(result);
    inputs[0].props.onChange({ target: { value: '2024-01-01' } });
    expect(onChange).toHaveBeenCalledWith({ start: '2024-01-01', end: '2024-01-31' });
  });

  it('calls onChange with start and end when end date changes', () => {
    const onChange = vi.fn();
    const result = TimeRangeSelector({ value: { start: '2024-01-01' }, onChange });
    const inputs = getDateInputs(result);
    inputs[1].props.onChange({ target: { value: '2024-01-31' } });
    expect(onChange).toHaveBeenCalledWith({ start: '2024-01-01', end: '2024-01-31' });
  });

  it('shows date input values from props', () => {
    const result = TimeRangeSelector({
      value: { start: '2024-01-01', end: '2024-01-31' },
      onChange: () => {},
    });
    const inputs = getDateInputs(result);
    expect(inputs[0].props.value).toBe('2024-01-01');
    expect(inputs[1].props.value).toBe('2024-01-31');
  });

  it('defaults empty date inputs when no value provided', () => {
    const result = TimeRangeSelector({ value: {}, onChange: () => {} });
    const inputs = getDateInputs(result);
    expect(inputs[0].props.value).toBe('');
    expect(inputs[1].props.value).toBe('');
  });
});
