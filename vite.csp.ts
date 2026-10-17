/**
 * П.5 — Content-Security-Policy для режима разработки (vite dev отдаёт HTML сам,
 * заголовки netlify.toml/_headers при локальной разработке не применяются).
 *
 * Dev-версия мягкая: разрешены inline-скрипты HMR и ws:// соединение Vite.
 * Продакшен-CSP задаётся заголовками хостинга (netlify.toml / vercel.json / _headers),
 * они строже: без unsafe-inline скриптов.
 */
export const DEV_CSP = [
  "default-src 'self'",
  // Vite HMR использует inline/bootstrap-модули в dev
  "script-src 'self' 'unsafe-inline'",
  // Tailwind v4 + инлайновые стили темы в index.html
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  // Запросы к публичным API бирж
  "connect-src 'self' https://api.bybit.com wss://stream.binance.com:9443 ws: http://localhost:*",
  "object-src 'none'",
  "frame-ancestors *", // приложение может работать внутри iframe песочницы
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");
