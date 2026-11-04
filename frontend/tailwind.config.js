/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: '#E2E8F0',
        input: '#E2E8F0',
        ring: '#371667',
        background: '#F8FAFC',
        foreground: '#0F172A',
        primary: {
          DEFAULT: '#371667',
          foreground: '#FFFFFF',
          hover: '#2A104F',
          soft: '#F4F1F8',
        },
        secondary: {
          DEFAULT: '#F1F5F9',
          foreground: '#0F172A',
        },
        destructive: {
          DEFAULT: '#B91C1C',
          foreground: '#FFFFFF',
        },
        muted: {
          DEFAULT: '#F1F5F9',
          foreground: '#64748B',
        },
        accent: {
          DEFAULT: '#F4F1F8',
          foreground: '#371667',
        },
        popover: {
          DEFAULT: '#FFFFFF',
          foreground: '#0F172A',
        },
        card: {
          DEFAULT: '#FFFFFF',
          foreground: '#0F172A',
        },
        success: {
          DEFAULT: '#15803D',
          foreground: '#FFFFFF',
        },
        warning: {
          DEFAULT: '#B45309',
          foreground: '#FFFFFF',
        },
        info: {
          DEFAULT: '#0E7A94',
          foreground: '#FFFFFF',
        },
        brand: {
          indigo: '#371667',
          indigoHover: '#2A104F',
          soft: '#F4F1F8',
          violet: '#5B3FA0',
          cyan: '#0E7A94',
        },
      },
      borderRadius: {
        lg: '0.625rem',
        md: '0.5rem',
        sm: '0.375rem',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.04)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
