import path from "node:path";
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
  // `host: true` binds every interface, so the dashboard opens from any
  // machine on the rover network — a second laptop or a phone beside the
  // pilot — not only from localhost.
  server: {
    port: 5173,
    host: true,
  },
  // `npm run preview` serves the production build the same way. That is the
  // one to run during an actual mission: same code as a deploy, over plain
  // HTTP so it can still read the rover's HTTP nodes.
  preview: {
    port: 4173,
    host: true,
  },
});
