import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Linear-inspired dark palette
        canvas: '#08090a',
        panel: '#0f1011',
        surface: '#191a1b',
        elevated: '#28282c',
        border: 'rgba(255,255,255,0.08)',
        'border-subtle': 'rgba(255,255,255,0.05)',
        // Text
        'text-primary': '#f7f8f8',
        'text-secondary': '#d0d6e0',
        'text-tertiary': '#8a8f98',
        'text-muted': '#62666d',
        // Accent (Linear indigo)
        accent: '#7170ff',
        'accent-bg': '#5e6ad2',
        'accent-hover': '#828fff',
        // Sentry design tokens
        'sentry-bg': '#1a1025',
        'sentry-surface': '#2a1f3d',
        'sentry-lime': '#c2ef4e',
        'sentry-lime-bg': 'rgba(194,239,78,0.1)',
        // Semantic
        success: '#27a644',
        warning: '#f59e0b',
        error: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['Berkeley Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
    },
  },
  plugins: [],
};

export default config;
