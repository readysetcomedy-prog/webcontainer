/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALPACA_FUNCTION_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
