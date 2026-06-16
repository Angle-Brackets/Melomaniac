/// <reference types="vite/client" />

declare const __BUILD_DATE__: string;
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_PLATFORM?: 'ios' | 'android' | 'desktop';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
