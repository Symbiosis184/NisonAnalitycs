/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Версия приложения (подставляется из package.json / VITE_APP_VERSION при сборке) */
  readonly VITE_APP_VERSION?: string;
  /** Уникальный id сборки (версия + время build, инжектируется vite.config.ts) */
  readonly VITE_BUILD_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
