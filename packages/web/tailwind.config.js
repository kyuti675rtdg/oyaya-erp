/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#1E3A8A',
        ink: '#0F172A',
        harvest: {
          DEFAULT: '#D97706',
          dark: '#B45309',
          light: '#FEF3C7'
        },
        alabaster: '#F8FAFC',
        line: '#E2E8F0',
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
