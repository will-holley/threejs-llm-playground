import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    dedupe: ["three"]
  },
  build: {
    outDir: "dist"
  }
});
