/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#171A3B',
        ink: '#172033',
        slate: {
          DEFAULT: '#667085'
        },
        harvest: {
          DEFAULT: '#D97706',
          dark: '#B45309',
          light: '#FEF3C7'
        },
        alabaster: '#F8FAFC',
        line: '#E2E7F0',
        lavender: {
          bg: '#F4F6FA',
          sidebar: '#EDE9F7'
        },
        violet: {
          primary: '#5B35D5',
          light: '#7C5CE0',
          dark: '#4527A8',
          pale: '#ECE7FA'
        },
        pass: { text: '#15803D', bg: '#DCFCE7' },
        advisory: { text: '#B45309', bg: '#FEF3C7' },
        critical: { text: '#B91C1C', bg: '#FEE2E2' }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      keyframes: {
        'pulse-border': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(185, 28, 28, 0.55)' },
          '50%': { boxShadow: '0 0 0 4px rgba(185, 28, 28, 0.15)' }
        }
      },
      animation: {
        'pulse-border': 'pulse-border 1.6s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
