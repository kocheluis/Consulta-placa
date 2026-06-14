import type { Config } from 'tailwindcss';

/**
 * Tokens del PlacaPe Design System (handoff de Claude Design).
 * Azul (confianza) + Teal (acción) + slate + semáforo. Los nombres semánticos
 * (primary, accent, surface, foreground, muted, border, success/warning/danger)
 * los consumen los componentes existentes, así todo se re-skinea con esta capa.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Escalas de marca (para componentes nuevos)
        azul: {
          50: '#EFF6F9', 100: '#E1EFF4', 200: '#C4E0EA', 300: '#93C4D6', 400: '#5AA0BC',
          500: '#2D7FA0', 600: '#1A6584', 700: '#14506B', 800: '#103D52', 900: '#0A2E3D', 950: '#07222E',
        },
        teal: {
          50: '#ECFAF7', 100: '#D7F5F0', 200: '#A8E9E0', 300: '#71DACD', 400: '#3FC9B8',
          500: '#16B5A3', 600: '#13A091', 700: '#0F8A7E', 800: '#0C6F64', 900: '#0A5A52',
        },
        // Semánticos
        primary: { DEFAULT: '#14506B', 600: '#103D52' }, // azul-700 / hover azul-800
        accent: { DEFAULT: '#16B5A3', 600: '#13A091' }, // teal-500 / hover
        background: '#F5F8FA', // slate-50
        surface: '#FFFFFF',
        foreground: '#0E1B22', // slate-900
        muted: '#647884', // slate-500
        border: '#D7DFE4', // slate-200
        success: { DEFAULT: '#18994F', bg: '#EFFBF3', fg: '#137A45' },
        warning: { DEFAULT: '#DA9211', bg: '#FEF8E9', fg: '#B8770A' },
        danger: { DEFAULT: '#DD3B3B', bg: '#FEF0F0', fg: '#B82B2B' },
        neutral: '#647884',
      },
      fontFamily: {
        heading: ['Sora', 'system-ui', 'sans-serif'],
        body: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        md: '12px',
        lg: '16px',
        xl: '22px',
        '2xl': '28px',
      },
      boxShadow: {
        xs: '0 1px 2px rgba(14,27,34,0.06)',
        sm: '0 1px 3px rgba(14,27,34,0.08), 0 1px 2px rgba(14,27,34,0.04)',
        md: '0 4px 12px rgba(14,27,34,0.08), 0 2px 4px rgba(14,27,34,0.05)',
        lg: '0 12px 28px rgba(14,27,34,0.12), 0 4px 8px rgba(14,27,34,0.06)',
        xl: '0 24px 56px rgba(14,27,34,0.16), 0 8px 16px rgba(14,27,34,0.08)',
        '2xl': '0 24px 56px rgba(14,27,34,0.16), 0 8px 16px rgba(14,27,34,0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
