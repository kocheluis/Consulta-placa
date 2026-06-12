import type { Config } from 'tailwindcss';

/** Tokens del design system (specs/.../design-system.md). */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#1E3A8A', 600: '#1E40AF' },
        accent: '#0369A1',
        background: '#F8FAFC',
        surface: '#FFFFFF',
        foreground: '#0F172A',
        muted: '#475569',
        border: '#E2E8F0',
        success: { DEFAULT: '#16A34A', bg: '#F0FDF4', fg: '#166534' },
        warning: { DEFAULT: '#D97706', bg: '#FFFBEB', fg: '#92400E' },
        danger: { DEFAULT: '#DC2626', bg: '#FEF2F2', fg: '#991B1B' },
        neutral: '#64748B',
      },
      fontFamily: {
        heading: ['Lexend', 'sans-serif'],
        body: ['"Source Sans 3"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: { xl: '0.75rem' },
    },
  },
  plugins: [],
};

export default config;
