import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "src-tauri", "src/vendor", ".claude", "tools", "node_modules"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.worker },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Só as duas regras clássicas: as regras do React Compiler ficam de fora.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // O tsc (noUnusedLocals/noUnusedParameters) já cobre isto.
      "@typescript-eslint/no-unused-vars": "off",
      // Erros de domínio (ex.: "totp.error.*") são relançados sem `cause` de propósito.
      "preserve-caught-error": "off",
    },
  },
);
