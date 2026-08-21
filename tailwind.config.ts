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
          'rose-text': '#96534A',    // accessible rose for text/links — 5.8:1 on white, 4.7:1 on linen
          'rose-light': '#EDD5D0',
          'rose-bg': '#FAF0EE',
          gold: '#C9A96E',
          'gold-light': '#EAD8B5',
          'gold-dark': '#A07840',
          'gold-text': '#725417',   // accessible gold for small text — 7:1 on white/cream, 5:1 on gold-light
          linen: '#EDE8DF',
          'linen-dark': '#DDD6CB',
          dark: '#2C1810',
          medium: '#6B4545',
          muted: '#6B5252',          // was #9B7A7A (3.8:1) — now 7:1 on white
          // ⚠️ ירוק הוואטסאפ הרשמי (#25D366) נותן 1.98:1 מול לבן — נכשל גם
          // בטקסט גדול וגם בדרישת 3:1 לאייקונים (WCAG 1.4.11). הוא נשאר
          // לשימושי מילוי/רקע-שקוף בלבד; כל משטח שנושא טקסט או אייקון לבן,
          // וכל טקסט ירוק על רקע בהיר, משתמשים ב-whatsapp-dark (5.1:1 מול לבן).
          whatsapp: '#25D366',
          'whatsapp-dark': '#0C7F3F',
        },
      },
      fontFamily: {
        serif: ['var(--font-frank)', 'Georgia', 'serif'],
        script: ['var(--font-dancing)', 'cursive'],
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
        rise: 'rise 0.6s ease-out both',
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
        // ⚠️ transform-only, no opacity — content stays fully painted/visible
        // from first frame (LCP-eligible immediately). Used for above-the-fold
        // hero text that previously waited on framer-motion hydration.
        rise: {
          '0%': { transform: 'translateY(16px)' },
          '100%': { transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
