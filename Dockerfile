# syntax=docker/dockerfile:1
# Nison Analytics — статический SPA (Vite + React).
# Многослойная сборка: node:20-alpine (соответствует CI, см. .github/workflows/ci.yml)
# для сборки, nginx:alpine для раздачи статики.

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_APP_VERSION
ARG VITE_STOCK_MIN_INTERVAL_MS
ENV VITE_APP_VERSION=$VITE_APP_VERSION \
    VITE_STOCK_MIN_INTERVAL_MS=$VITE_STOCK_MIN_INTERVAL_MS

RUN npm run typecheck && npm run build

# --- Прокси котировок (опционально) -------------------------------------
# По умолчанию приложение ходит в публичные API Bybit/Binance напрямую.
# Если нужен свой прокси (например, kairi-api), подключите его конфиг nginx
# и включите строку COPY ниже.
# COPY deploy/nginx-docker.conf /etc/nginx/conf.d/default.conf

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
