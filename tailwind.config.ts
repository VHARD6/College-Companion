import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#2563eb',   // blue-600
        success: '#16a34a',   // green-600
        danger: '#dc2626',    // red-600
        warning: '#d97706',   // amber-600
      }
    },
  },
  plugins: [],
}
export default config
