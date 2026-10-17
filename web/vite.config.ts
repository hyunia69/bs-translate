import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: { "/api": "http://localhost:8790", "/health": "http://localhost:8790" },
  },
  build: { outDir: "dist", sourcemap: false },
});
