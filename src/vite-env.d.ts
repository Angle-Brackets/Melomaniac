/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLATFORM?: 'ios' | 'android' | 'desktop';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
