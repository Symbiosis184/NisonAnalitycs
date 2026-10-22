#!/usr/bin/env bash
# Kairi Analytics — скрипт сборки и деплоя (П.4)
# Использование:
#   ./deploy.sh                 # только проверка качества + сборка в dist/
#   ./deploy.sh netlify         # то же + публикация через Netlify CLI (нужен NETLIFY_AUTH_TOKEN)
#   ./deploy.sh vercel          # то же + публикация через Vercel CLI (нужен VERCEL_TOKEN)
#   ./deploy.sh rsync user@host:/var/www/nison-analytics   # rsync dist/ на свой сервер
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Установка зависимостей (npm ci)"
npm ci

echo "==> Проверки качества: typecheck, тесты, аудит"
npm run typecheck
npm test
npm audit --audit-level=high || { echo "FAIL: найдены уязвимости high/critical"; exit 1; }

echo "==> Сборка"
rm -rf dist
npm run build
echo "Готово: dist/ ($(du -sh dist | cut -f1))"

TARGET="${1:-}"
case "$TARGET" in
  "")
    echo "Сборка завершена. Для публикации передайте цель: netlify | vercel | rsync <host:path>"
    ;;
  netlify)
    npx --yes netlify-cli deploy --prod --dir=dist
    ;;
  vercel)
    npx --yes vercel deploy --prod --yes ${VERCEL_TOKEN:+--token "$VERCEL_TOKEN"}
    ;;
  rsync)
    DEST="${2:?укажите назначение, напр. user@host:/var/www/nison-analytics}"
    rsync -avz --delete dist/ "$DEST"
    echo "Загружено в $DEST (заголовки CSP для nginx см. в README)"
    ;;
  *)
    echo "Неизвестная цель: $TARGET"; exit 1;;
esac
