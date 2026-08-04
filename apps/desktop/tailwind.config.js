/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        "destructive-text": "hsl(var(--destructive-text))",
        "primary-hover": "hsl(var(--primary-hover))",
        surface: {
          0: "hsl(var(--surface-0))",
          1: "hsl(var(--surface-1))",
          2: "hsl(var(--surface-2))",
          3: "hsl(var(--surface-3))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          border: "hsl(var(--sidebar-border))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        /* Deep Navy + Ice brand aliases (hex vars from globals) */
        midnight: "var(--color-midnight)",
        navy: "var(--color-navy)",
        ink: "var(--color-ink)",
        panel: "var(--color-panel)",
        ice: "var(--color-ice)",
        electric: "var(--color-electric)",
        frost: "var(--color-frost)",
        approval: "var(--color-approval)",
        danger: "var(--color-danger)",
        hairline: {
          quiet: "hsl(var(--hairline-quiet))",
          DEFAULT: "hsl(var(--hairline))",
          strong: "hsl(var(--hairline-strong))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // xl defaulted to 12px same as lg — restore the step (DS-7)
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
      // DS-3 / DS-12: single type scale; floor 11px (2xs). Body ~13.5.
      // Display steps 3xl/4xl for onboarding + rare heroes only.
      fontSize: {
        "2xs": ["11px", { lineHeight: "1.35" }],
        xs: ["12px", { lineHeight: "1.4" }],
        sm: ["13px", { lineHeight: "1.45" }],
        base: ["13.5px", { lineHeight: "1.45" }],
        md: ["15px", { lineHeight: "1.4" }],
        lg: ["17px", { lineHeight: "1.35" }],
        xl: ["20px", { lineHeight: "1.3" }],
        "2xl": ["24px", { lineHeight: "1.25" }],
        "3xl": ["28px", { lineHeight: "1.2", letterSpacing: "-0.028em" }],
        "4xl": ["32px", { lineHeight: "1.15", letterSpacing: "-0.03em" }],
      },
      fontFamily: {
        sans: [
          "SF Pro Text",
          "SF Pro Display",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "SF Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(14px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "toast-out": {
          from: { opacity: "1", transform: "translateY(0) scale(1)" },
          to: { opacity: "0", transform: "translateX(16px) scale(0.98)" },
        },
        "palette-in": {
          from: {
            opacity: "0",
            transform: "translate(-50%, 14px) scale(0.98)",
          },
          to: { opacity: "1", transform: "translate(-50%, 0) scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        "toast-in": "toast-in 0.32s cubic-bezier(0.34, 1.3, 0.64, 1)",
        "toast-out": "toast-out 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "palette-in":
          "palette-in 0.3s cubic-bezier(0.34, 1.3, 0.64, 1) forwards",
      },
      transitionTimingFunction: {
        // DS-10: bare transition-* inherits the premium curve
        DEFAULT: "cubic-bezier(0.16, 1, 0.3, 1)",
        premium: "cubic-bezier(0.16, 1, 0.3, 1)",
        spring: "cubic-bezier(0.34, 1.3, 0.64, 1)",
      },
      transitionDuration: {
        0: "0ms",
        120: "120ms",
        150: "150ms",
        180: "180ms",
        200: "200ms",
        240: "240ms",
        280: "280ms",
        300: "300ms",
        400: "400ms",
        500: "500ms",
      },
      // DS-13: shared elevation / hairline recipes
      boxShadow: {
        "hairline-top": "inset 0 1px 0 0 rgba(255,255,255,0.05)",
        "hairline-top-strong": "inset 0 1px 0 0 rgba(255,255,255,0.14)",
        "ambient-sm": "0 8px 22px -12px rgba(0,0,0,0.45)",
        "ambient-md": "0 18px 50px -14px rgba(0,0,0,0.72)",
        "ambient-lg": "0 28px 70px -18px rgba(0,0,0,0.8)",
        "primary-glow": "0 8px 22px -10px rgba(159,221,255,0.45)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
