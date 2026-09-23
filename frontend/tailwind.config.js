/** RefundShield design tokens.
 *
 * One palette, used everywhere. Risk colour is semantic and always paired with
 * a text label — never colour alone.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0E1420', soft: '#1A2333', muted: '#39435A' },
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        raised: 'rgb(var(--c-raised) / <alpha-value>)',
        hairline: 'rgb(var(--c-hairline) / <alpha-value>)',
        ring2: 'rgb(var(--c-ring) / <alpha-value>)',
        fg: 'rgb(var(--c-fg) / <alpha-value>)',
        fg2: 'rgb(var(--c-fg2) / <alpha-value>)',
        fg3: 'rgb(var(--c-fg3) / <alpha-value>)',
        brand: { DEFAULT: '#2E4059', deep: '#1B2740', tint: '#E6EBF3' },
        low: { DEFAULT: '#12705F', fg: '#0C5648', bg: '#E2F0EC' },
        moderate: { DEFAULT: '#9A6B12', fg: '#7A5410', bg: '#F7EFDE' },
        high: { DEFAULT: '#C1462F', fg: '#A33A26', bg: '#FAE9E4' },
        critical: { DEFAULT: '#98231A', fg: '#7E1D15', bg: '#F7DEDA' },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Mono', 'Consolas', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }],
      },
      borderRadius: { xl: '0.625rem', '2xl': '0.875rem' },
      boxShadow: {
        card: '0 1px 2px rgb(14 20 32 / 0.04), 0 1px 3px rgb(14 20 32 / 0.06)',
        lift: '0 2px 4px rgb(14 20 32 / 0.04), 0 12px 28px -8px rgb(14 20 32 / 0.16)',
        pop: '0 8px 24px -6px rgb(14 20 32 / 0.22), 0 2px 6px rgb(14 20 32 / 0.08)',
      },
      transitionTimingFunction: { swift: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { 'fade-up': 'fade-up .32s cubic-bezier(0.22,1,0.36,1) both' },
    },
  },
  plugins: [],
}
