/// <reference types="vite/client" />

declare const __BUILD_DATE__: string;

interface ImportMetaEnv {
  readonly VITE_PLATFORM?: 'ios' | 'android' | 'desktop';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
