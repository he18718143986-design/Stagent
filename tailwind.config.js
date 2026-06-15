/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        stagent: {
          cream: '#FFF8F0',
          orange: '#F97316',
          success: '#16A34A',
        },
      },
      animation: {
        'pulse-dot': 'pulseDot 1.4s infinite ease-in-out',
        'fade-in': 'fadeIn 0.15s ease-in-out',
      },
      keyframes: {
        pulseDot: {
          '0%, 80%, 100%': { transform: 'scale(0)', opacity: '0' },
          '40%': { transform: 'scale(1)', opacity: '1' },
        },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
      },
    },
  },
  plugins: [],
}
