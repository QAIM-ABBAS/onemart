/**
 * OneMart design tokens — colour mapping.
 *
 * The raw values live as CSS custom properties on `:root` in `src/index.css`
 * (the single source of truth). This file only maps those variables onto
 * Tailwind colour names so utilities such as `bg-brand-700` or `text-ink-muted`
 * resolve to the token instead of a hardcoded colour.
 *
 * Loaded by `@config "./tailwind.config.ts";` at the top of `src/index.css`.
 *
 * Palette rules:
 *   · ~70% neutrals (canvas / surface / surface-2 / line / ink)
 *   · ~20% brand green (brand-*)
 *   · ~10% deal (deal-*) — sale prices, discount badges, flash-deal UI only.
 *     Never for generic buttons or errors (errors use `danger`).
 *
 * No dark mode: one light theme, one type scale, one spacing scale.
 */
const config = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: "var(--brand-50)",
          100: "var(--brand-100)",
          200: "var(--brand-200)",
          400: "var(--brand-400)",
          600: "var(--brand-600)",
          700: "var(--brand-700)",
          800: "var(--brand-800)",
          900: "var(--brand-900)",
        },
        deal: {
          DEFAULT: "var(--deal-600)",
          50: "var(--deal-50)",
          600: "var(--deal-600)",
          700: "var(--deal-700)",
        },
        highlight: "var(--highlight)",
        "highlight-ink": "var(--highlight-ink)",

        canvas: "var(--bg)",
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
        },
        line: "var(--border)",

        ink: {
          DEFAULT: "var(--text)",
          muted: "var(--text-muted)",
          faint: "var(--text-faint)",
        },

        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",

        overlay: "var(--overlay)",
      },
    },
  },
};

export default config;
