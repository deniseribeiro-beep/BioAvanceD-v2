/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#371667',
          hover: '#2A104F',
          soft: '#F4F1F8',
          foreground: '#FFFFFF',
        },
        brand: {
          indigo: '#371667',
          soft: '#F4F1F8',
          cyan: '#0E7A94',
          violet: '#5B3FA0',
        },
        background: '#F8FAFC',
        foreground: '#0F172A',
        muted: {
          DEFAULT: '#F1F5F9',
          foreground: '#64748B',
        },
        border: '#E2E8F0',
        card: '#FFFFFF',
        success: '#15803D',
        warning: '#B45309',
        danger: '#B91C1C',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
