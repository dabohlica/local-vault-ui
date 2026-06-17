import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'bg-base': '#0A0E1A',
        'bg-surface': '#111827',
        'bg-elevated': '#1A2235',
        'border-default': '#1F2937',
        'border-subtle': '#141C2E',
        primary: '#6366F1',
        'primary-hover': '#4F46E5',
        accent: '#8B5CF6',
        teal: '#14B8A6',
        'text-base': '#F9FAFB',
        'text-muted': '#9CA3AF',
        'text-subtle': '#6B7280',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        card: '16px',
        'card-lg': '24px',
      },
      transitionDuration: {
        micro: '150ms',
        normal: '200ms',
        slow: '300ms',
      },
      animation: {
        'slide-in-right': 'slideInRight 250ms ease-out',
        'fade-in': 'fadeIn 150ms ease-out',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config
