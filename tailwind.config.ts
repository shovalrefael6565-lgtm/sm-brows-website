import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          cream: '#FAF7F5',
          'cream-dark': '#F2E8E4',
          rose: '#C4847A',
          'rose-light': '#EDD5D0',
          'rose-bg': '#FAF0EE',
          gold: '#C9A96E',
          'gold-light': '#EAD8B5',
          'gold-dark': '#A07840',
          dark: '#2C1810',
          medium: '#6B4545',
          muted: '#9B7A7A',
        },
      },
      fontFamily: {
        serif: ['var(--font-dancing)', 'var(--font-frank)', 'Georgia', 'serif'],
        sans: ['var(--font-rubik)', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'hero-gradient':
          'linear-gradient(135deg, #FAF7F5 0%, #F7EBE8 40%, #F0D8D5 70%, #EAD8B5 100%)',
        'rose-gradient': 'linear-gradient(135deg, #FAF0EE 0%, #F0D8D5 100%)',
        'gold-gradient': 'linear-gradient(135deg, #C9A96E 0%, #EAD8B5 100%)',
      },
      boxShadow: {
        soft: '0 4px 24px -4px rgba(44, 24, 16, 0.08)',
        'soft-lg': '0 8px 48px -8px rgba(44, 24, 16, 0.12)',
        rose: '0 4px 24px -4px rgba(196, 132, 122, 0.25)',
        gold: '0 4px 24px -4px rgba(201, 169, 110, 0.3)',
      },
      scale: {
        '102': '1.02',
        '103': '1.03',
        '107': '1.07',
      },
      animation: {
        'fade-up': 'fadeUp 0.6s ease-out forwards',
        'fade-in': 'fadeIn 0.4s ease-out forwards',
        float: 'float 3s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}

export default config
