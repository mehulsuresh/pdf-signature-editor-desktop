import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          bg: "#F6F0E6",
          panel: "#FBF7F1",
          "panel-2": "#F5ECDF",
          paper: "#FFFDFC",
          stroke: "#E3D6C3",
          "stroke-strong": "#CDBCA5",
          text: "#2A211C",
          "text-soft": "#4A3D33",
          muted: "#6F6257",
          "muted-2": "#8A7D72",
          accent: "#C96B2C",
          "accent-dark": "#A95521",
          "accent-soft": "#FCEFE1",
          black: "#111111",
          navy: "#1E3A5F",
          oxblood: "#9B4743",
          success: "#3F7D5E",
        },
      },
      fontFamily: {
        display: ["Cormorant Garamond", "serif"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        script: ["Great Vibes", "cursive"],
        scriptAlt: ["Allura", "cursive"],
        scriptStrong: ["Alex Brush", "cursive"],
      },
      borderRadius: {
        "4xl": "2rem",
      },
      boxShadow: {
        float: "0 12px 30px rgba(76, 53, 31, 0.08)",
        panel: "0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 10px 24px -14px rgba(76, 53, 31, 0.18)",
        "panel-lg": "0 1px 0 rgba(255, 255, 255, 0.7) inset, 0 22px 45px -18px rgba(60, 40, 20, 0.22)",
        "inner-hairline": "inset 0 0 0 1px rgba(216, 203, 187, 0.6)",
        "ring-accent": "0 0 0 3px rgba(201, 107, 44, 0.18)",
      },
      letterSpacing: {
        label: "0.14em",
      },
    },
  },
  plugins: [],
} satisfies Config;
