/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        shelf: {
          bg: '#150e16',
          surface: '#1f1520',
          elevated: '#2a1d2a',
          border: '#3a2438',
          accent: '#e84bd0',
        },
      },
    },
  },
  plugins: [],
};
