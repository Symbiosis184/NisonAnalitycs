/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Версия приложения (подставляется из package.json / VITE_APP_VERSION при сборке) */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
