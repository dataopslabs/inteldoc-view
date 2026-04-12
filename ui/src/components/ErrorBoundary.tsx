'use client';

/**
 * T2-06: React Error Boundary component.
 * Catches render errors in child component trees and shows a friendly fallback
 * instead of white-screening the entire application.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <MyComponent />
 *   </ErrorBoundary>
 *
 * Or with a custom fallback:
 *   <ErrorBoundary fallback={<p>Custom error message</p>}>
 *     <MyComponent />
 *   </ErrorBoundary>
 */

import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Optional label shown in the error UI, e.g. "Dashboard" */
  section?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to CloudWatch via console.error (structured JSON picked up by Lambda handler)
    console.error(JSON.stringify({
      level: 'ERROR',
      message: 'React render error caught by ErrorBoundary',
      error: error.message,
      stack: error.stack?.slice(0, 500),
      componentStack: info.componentStack?.slice(0, 500),
      section: this.props.section,
    }));
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '200px',
            padding: '32px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              backgroundColor: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: '8px',
              padding: '24px 32px',
              maxWidth: '480px',
              width: '100%',
            }}
          >
            <p style={{ fontSize: '14px', fontWeight: 600, color: '#ef4444', marginBottom: '8px' }}>
              {this.props.section
                ? `Something went wrong in ${this.props.section}`
                : 'Something went wrong'}
            </p>
            <p style={{ fontSize: '12px', color: '#8a8f98', marginBottom: '16px' }}>
              {this.state.error?.message ?? 'An unexpected error occurred'}
            </p>
            <button
              onClick={this.handleRetry}
              style={{
                backgroundColor: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '6px',
                color: '#ef4444',
                fontSize: '12px',
                fontWeight: 500,
                padding: '6px 16px',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
