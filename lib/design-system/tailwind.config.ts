import type { Config } from 'tailwindcss';

/**
 * DGsoft Design System — Tailwind Configuration
 * =========================================================
 * Single source of truth for all DG applications.
 * 
 * Colors: DG Red (#E31E2A) + Sisyphus Blue (#0078D4)
 * Typography: Segoe UI Variable → Inter (web fallback)
 * Motion: Fluent 2 standard easing
 * Components: Fluent 2 + DG customizations
 */

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
  ],

  theme: {
    extend: {
      /**
       * COLORS — Two-primary palette
       * DG Red = brand (logos, CTAs, destructive)
       * Sisyphus Blue = product interior (links, nav, focus)
       */
      colors: {
        // DG BRAND RED — primary brand color
        'dg-red': {
          50: '#FFF1F2',
          100: '#FFDADD',
          200: '#FFB3B8',
          300: '#FF8089',
          400: '#F24955',
          500: '#E31E2A', // ← DG primary
          600: '#C8121D',
          700: '#A10A13',
          800: '#7A060D',
          900: '#4D0308',
        },

        // SISYPHUS BLUE — product interior
        'sisyphus': {
          50: '#EFF6FC',
          100: '#DEECF9',
          200: '#C7E0F4',
          300: '#A3CEEE',
          400: '#71AFE5',
          500: '#0078D4', // ← MS 365 / Fluent primary
          600: '#106EBE',
          700: '#005A9E',
          800: '#004578',
          900: '#002050',
        },

        // WARM NEUTRALS (Fluent-calibrated, not cool greys)
        'neutral': {
          0: '#FFFFFF',
          4: '#FAFAFA',
          6: '#F5F4F3',
          8: '#F3F2F1',   // canvas
          10: '#EDEBE9',  // hover
          20: '#D1D1D1',
          30: '#B3B3B3',
          40: '#8A8A8A',
          50: '#707070',
          60: '#5C5C5C',
          70: '#424242',
          80: '#292929',
          90: '#1F1F1F',
          95: '#141414',
        },

        // SEMANTIC / STATUS COLORS
        'success': {
          50: '#DFF6DD',
          500: '#107C10', // DGsmart green
        },
        'warning': {
          50: '#FFF4CE',
          500: '#CA5D00',
        },
        'danger': {
          50: '#FED9CC',
          500: '#A4262C',
        },
        'info': {
          50: '#DEECF9',
          500: '#0078D4',
        },

        // SURFACE TOKENS (semantic, override as needed)
        'surface': {
          canvas: '#F3F2F1',
          card: '#FFFFFF',
          raised: '#FAFAFA',
          subtle: '#F5F4F3',
          inverse: '#1F1F1F',
        },

        // ACCENT COLORS (for tags, badges, diversity)
        'accent': {
          purple: '#8764B8',
          green: '#107C10',
          orange: '#D83B01',
          red: '#C50F1F',
          yellow: '#FFB900',
          teal: '#00B7C3',
          pink: '#C239B3',
        },
      },

      /**
       * TYPOGRAPHY — Fluent type ramp
       * Default: Segoe UI Variable + Inter fallback
       * Display: Segoe UI Variable Display
       * Mono: Cascadia Code / JetBrains Mono
       */
      fontFamily: {
        sans: [
          'var(--font-segoe-ui)',
          'Segoe UI Variable',
          'Segoe UI',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        display: [
          'var(--font-segoe-display)',
          'Segoe UI Variable',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'Cascadia Code',
          'JetBrains Mono',
          'ui-monospace',
          'monospace',
        ],
      },

      fontSize: {
        'caption': ['11px', { lineHeight: '1.15', fontWeight: '400' }],
        'body-sm': ['12px', { lineHeight: '1.3', fontWeight: '400' }],
        'body': ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        'body-lg': ['16px', { lineHeight: '1.5', fontWeight: '400' }],
        'subtitle': ['18px', { lineHeight: '1.3', fontWeight: '500' }],
        'title-3': ['20px', { lineHeight: '1.3', fontWeight: '600' }],
        'title-2': ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        'title-1': ['32px', { lineHeight: '1.15', fontWeight: '600' }],
        'hero': ['40px', { lineHeight: '1.15', fontWeight: '600' }],
        'display': ['56px', { lineHeight: '1.15', fontWeight: '600' }],
      },

      /**
       * SPACING — 4px baseline grid
       * 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80
       */
      spacing: {
        0: '0',
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '20px',
        6: '24px',
        8: '32px',
        10: '40px',
        12: '48px',
        16: '64px',
        20: '80px',
      },

      /**
       * BORDER RADIUS — tight, Fluent-style
       * xs: 2px, sm: 4px (default), md: 6px, lg: 8px, xl: 12px
       */
      borderRadius: {
        xs: '2px',
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },

      /**
       * BOX SHADOWS — Fluent 2 elevation system
       * Two-layer shadows (near + far)
       */
      boxShadow: {
        // Fluent elevation levels
        'fluent-2': '0 1px 2px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.06)',
        'fluent-4': '0 2px 4px rgba(0,0,0,0.06), 0 4px 8px rgba(0,0,0,0.08)',
        'fluent-8': '0 4px 8px rgba(0,0,0,0.08), 0 8px 16px rgba(0,0,0,0.10)',
        'fluent-16': '0 8px 16px rgba(0,0,0,0.10), 0 16px 32px rgba(0,0,0,0.12)',
        'fluent-28': '0 14px 28px rgba(0,0,0,0.12), 0 28px 48px rgba(0,0,0,0.14)',
        'fluent-64': '0 32px 64px rgba(0,0,0,0.14)',
        'fluent-inset': 'inset 0 1px 0 rgba(255,255,255,0.6)',

        // DG brand glow (hero CTAs, brand moments)
        'brand-glow': '0 8px 24px -8px rgba(227, 30, 42, 0.35)',
      },

      /**
       * BACKGROUND IMAGES — Acrylic, Mica, Mesh
       */
      backgroundImage: {
        'acrylic': 'linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.55) 100%)',
        'acrylic-blur': 'linear-gradient(180deg, rgba(243,242,241,0.9) 0%, rgba(243,242,241,0.95) 100%)',
        'mica': 'linear-gradient(180deg, rgba(243,242,241,0.92) 0%, rgba(243,242,241,0.98) 100%)',
        'mesh': `
          radial-gradient(at 20% 10%, rgba(227,30,42,0.08) 0%, transparent 50%),
          radial-gradient(at 80% 20%, rgba(0,120,212,0.08) 0%, transparent 50%),
          radial-gradient(at 50% 90%, rgba(227,30,42,0.05) 0%, transparent 50%)
        `,
        'gradient-brand': 'linear-gradient(135deg, #E31E2A 0%, #A10A13 100%)',
      },

      /**
       * ANIMATIONS & KEYFRAMES — Fluent 2 motion
       * Standard easing: cubic-bezier(0.33, 0, 0.67, 1)
       * Durations: 80ms (micro), 150ms (hover), 240ms (flyouts), 400ms (page)
       */
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },

      animation: {
        'fade-in': 'fade-in 0.24s cubic-bezier(0.33, 0, 0.67, 1)',
        'slide-in': 'slide-in 0.24s cubic-bezier(0.33, 0, 0.67, 1)',
        'slide-in-right': 'slide-in-right 0.24s cubic-bezier(0.33, 0, 0.67, 1)',
        'scale-in': 'scale-in 0.15s cubic-bezier(0.33, 0, 0.67, 1)',
        'shimmer': 'shimmer 2s linear infinite',
        'pulse-subtle': 'pulse-subtle 2s ease-in-out infinite',
      },

      /**
       * TRANSITION TIMING — Fluent standard
       */
      transitionTimingFunction: {
        'fluent': 'cubic-bezier(0.33, 0, 0.67, 1)',
        'fluent-decel': 'cubic-bezier(0.1, 0.9, 0.2, 1)',
        'fluent-accel': 'cubic-bezier(0.7, 0, 1, 0.5)',
        'fluent-spring': 'cubic-bezier(0.5, -0.1, 0.1, 1.4)',
      },

      transitionDuration: {
        'micro': '80ms',
        'short': '150ms',
        'normal': '240ms',
        'long': '400ms',
      },

      /**
       * Z-INDEX SCALE — Predictable stacking
       */
      zIndex: {
        'dropdown': '50',
        'sticky': '20',
        'fixed': '40',
        'modal-backdrop': '100',
        'modal': '110',
        'popover': '120',
        'tooltip': '130',
        'notification': '140',
      },
    },
  },

  plugins: [],
};

export default config;
