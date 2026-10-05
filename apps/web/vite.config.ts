import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5181,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8791",
        changeOrigin: true,
        headers: { Origin: "http://127.0.0.1:5181" },
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
