import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1.25rem', screens: { '2xl': '1280px' } },
    extend: {
      colors: {
        border: 'rgb(from var(--border) r g b / <alpha-value>)',
        input: 'rgb(from var(--input) r g b / <alpha-value>)',
        ring: 'rgb(from var(--ring) r g b / <alpha-value>)',
        background: 'rgb(from var(--background) r g b / <alpha-value>)',
        foreground: 'rgb(from var(--foreground) r g b / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(from var(--primary) r g b / <alpha-value>)',
          foreground: 'rgb(from var(--primary-foreground) r g b / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'rgb(from var(--secondary) r g b / <alpha-value>)',
          foreground: 'rgb(from var(--secondary-foreground) r g b / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'rgb(from var(--destructive) r g b / <alpha-value>)',
          foreground: 'rgb(from var(--destructive-foreground) r g b / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(from var(--success) r g b / <alpha-value>)',
          foreground: 'rgb(from var(--success-foreground) r g b / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(from var(--warning) r g b / <alpha-value>)',
          foreground: 'rgb(from var(--warning-foreground) r g b / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(from var(--info) r g b / <alpha-value>)',
          foreground: 'rgb(from var(--info-foreground) r g b / <alpha-value>)',
        },
        overlay: {
          DEFAULT: 'rgb(from var(--overlay) r g b / <alpha-value>)',
          foreground: 'rgb(from var(--overlay-foreground) r g b / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(from var(--muted) r g b / <alpha-value>)',
          foreground: 'rgb(from var(--muted-foreground) r g b / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(from var(--accent) r g b / <alpha-value>)',
          foreground: 'rgb(from var(--accent-foreground) r g b / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'rgb(from var(--popover) r g b / <alpha-value>)',
          foreground: 'rgb(from var(--popover-foreground) r g b / <alpha-value>)',
        },
        card: {
          DEFAULT: 'rgb(from var(--card) r g b / <alpha-value>)',
          foreground: 'rgb(from var(--card-foreground) r g b / <alpha-value>)',
        },
        brand: {
          forest: 'rgb(from var(--brand-forest) r g b / <alpha-value>)',
          court: 'rgb(from var(--brand-court) r g b / <alpha-value>)',
          lime: 'rgb(from var(--brand-lime) r g b / <alpha-value>)',
          cream: 'rgb(from var(--brand-cream) r g b / <alpha-value>)',
          sand: 'rgb(from var(--brand-sand) r g b / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'serif'],
      },
      boxShadow: {
        soft: '0 12px 35px rgb(from var(--foreground) r g b / 0.06)',
        toast: 'var(--toast-shadow)',
      },
    },
  },
  plugins: [],
};
export default config;
