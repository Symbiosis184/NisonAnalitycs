import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { DEV_CSP } from "./vite.csp";

// Версия приложения берётся из package.json (единый источник правды).
// Бета-статус задаётся явно перед релизом 1.1beta, либо переменной окружения:
//   VITE_APP_VERSION=1.1beta npm run build
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const APP_VERSION = process.env.VITE_APP_VERSION ?? pkg.version;

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
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(APP_VERSION),
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    hmr: {
      port: 3000,
    },
  },
});
