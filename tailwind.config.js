/** @type {import('tailwindcss').Config} */

module.exports = {
  content: ["./src/**/*.{ts,jsx,tsx}"],
  theme: {
    extend: {},
  },

  plugins: [require("daisyui")],
}
