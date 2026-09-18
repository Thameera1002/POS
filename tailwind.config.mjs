/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark, low-glare palette: a POS screen sits under restaurant lighting
        // for twelve hours and gets stared at from a metre away.
        ink: {
          900: '#070c16',
          800: '#0b1220',
          700: '#111a2b',
          600: '#18243a',
          500: '#22314c',
          400: '#33436180'
        },
        brand: {
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -8px rgba(0,0,0,0.6)'
      }
    }
  },
  plugins: []
}
