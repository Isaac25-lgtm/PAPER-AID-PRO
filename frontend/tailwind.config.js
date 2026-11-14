/** @type {import('tailwindcss').Config} */
// Every colour the app uses is a theme token (src/theme.css), so Night mode needs no per-component dark: classes.
const scale = (name) =>
  Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [step, `rgb(var(--c-${name}-${step}) / <alpha-value>)`]));

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        white: "rgb(var(--c-white) / <alpha-value>)",
      slate: scale("slate"),
      brand: scale("brand"),
      red: scale("red"),
      amber: scale("amber"),
      emerald: scale("emerald"),
      },
      fontFamily: {
        sans: ["Inter Tight Variable", "Inter Tight", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        serif: ["Source Serif 4 Variable", "Source Serif 4", "Georgia", "Cambria", "Times New Roman", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
