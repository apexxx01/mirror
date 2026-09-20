/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Unbounded", "sans-serif"],
        mono: ["Space Mono", "monospace"],
        serif: ["Fraunces", "serif"],
      },
      colors: {
        hazard: "#FF1E1E",
        blocked: "#DC2626",
        review: "#EAB308",
        safe: "#16A34A",
        void: "#050509",
        carbon: "#050505",
        ink: "#f2f2ee",
        smoke: "#9c9c9c",
        graphite: "#212121",
        iron: "#3a3a3a",
        gold: "#C9A876",
      },
      backdropBlur: {
        glass: "20px",
      },
      letterSpacing: {
        crush: "-0.06em",
        supercrush: "-0.08em",
      },
    },
  },
  plugins: [],
};
