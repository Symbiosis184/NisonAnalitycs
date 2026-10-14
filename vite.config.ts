import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { DEV_CSP } from "./vite.csp";

/**
 * П.5 — CSP в режиме разработки: vite dev-сервер сам отдаёт HTML, поэтому
 * заголовки хостинга (netlify.toml / vercel.json / public/_headers) к нему
 * не применяются. Этот плагин добавляет Content-Security-Policy (и базовые
 * защитные заголовки) на dev-ответы. В production — статика, CSP идёт с хостинга.
 */
function devSecurityHeaders(): Plugin {
  return {
    name: "dev-security-headers",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        res.setHeader("Content-Security-Policy", DEV_CSP);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devSecurityHeaders()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    hmr: {
      port: 3000,
    },
  },
});
