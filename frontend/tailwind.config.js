/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Unbounded", "sans-serif"],
        mono: ["Space Mono", "monospace"],
      },
      colors: {
        hazard: "#FF1E1E",
        blocked: "#DC2626",
        review: "#EAB308",
        safe: "#16A34A",
        void: "#0A0A0A",
        ink: "#f2f2ee",
      },
      backdropBlur: {
        glass: "20px",
      },
    },
  },
  plugins: [],
};
