import React from 'react';
import { describe, it, expect } from 'vitest';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('renders a single text skeleton by default', () => {
    const result = Skeleton({});
    const children = React.Children.toArray(
      (result as React.ReactElement).props.children ?? [result]
    );
    expect(children).toHaveLength(1);
  });

  it('renders multiple items when count > 1', () => {
    const result = Skeleton({ count: 3 });
    const children = React.Children.toArray(
      (result as React.ReactElement).props.children ?? [result]
    );
    expect(children).toHaveLength(3);
  });

  it('applies text variant classes by default', () => {
    const result = Skeleton({});
    const children = React.Children.toArray(
      (result as React.ReactElement).props.children ?? [result]
    );
    const first = children[0] as React.ReactElement;
    expect(first.props.className).toContain('h-4');
    expect(first.props.className).toContain('w-full');
    expect(first.props.className).toContain('rounded');
    expect(first.props.className).toContain('animate-pulse');
    expect(first.props.className).toContain('bg-white/5');
  });

  it('applies card variant classes', () => {
    const result = Skeleton({ variant: 'card' });
    const children = React.Children.toArray(
      (result as React.ReactElement).props.children ?? [result]
    );
    const first = children[0] as React.ReactElement;
    expect(first.props.className).toContain('h-32');
    expect(first.props.className).toContain('rounded-lg');
  });

  it('applies row variant classes', () => {
    const result = Skeleton({ variant: 'row' });
    const children = React.Children.toArray(
      (result as React.ReactElement).props.children ?? [result]
    );
    const first = children[0] as React.ReactElement;
    expect(first.props.className).toContain('h-12');
    expect(first.props.className).toContain('rounded');
  });

  it('applies custom className', () => {
    const result = Skeleton({ className: 'mt-4 gap-2' });
    const children = React.Children.toArray(
      (result as React.ReactElement).props.children ?? [result]
    );
    const first = children[0] as React.ReactElement;
    expect(first.props.className).toContain('mt-4');
    expect(first.props.className).toContain('gap-2');
  });

  it('defaults count to 1', () => {
    const result = Skeleton({});
    const children = React.Children.toArray(
      (result as React.ReactElement).props.children ?? [result]
    );
    expect(children).toHaveLength(1);
  });
});
