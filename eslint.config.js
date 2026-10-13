import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import tseslint from "typescript-eslint";
import { bloques as bloquesDeDinero } from "./arquitectura/lint-dinero.cjs";
import { bloques as bloquesDeSql } from "./arquitectura/lint-sql.cjs";
import { bloques as bloquesDeWeb } from "./arquitectura/lint-web.cjs";

export default defineConfig(
  { ignores: ["node_modules", "coverage", ".claude", ".stryker-tmp", "reports"] },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  ...bloquesDeDinero,
  ...bloquesDeSql,
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        __dirname: "readonly",
        process: "readonly",
      },
    },
  },
  // React, Next, hooks y accesibilidad: solo para apps/** (se agrega al final, no se reordena).
  {
    // Los .tsx solo existen en apps/**: el bloque general de TypeScript cubre únicamente los .ts.
    files: ["apps/**/*.tsx"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  // Sin @next/eslint-plugin-next: arrastra fast-glob → micromatch → braces (aviso de severidad alta
  // sin versión corregida) y `npm audit --audit-level=high` del CI lo rechaza. Se reevalúa cuando
  // el plugin actualice esa cadena.
  { ...reactHooks.configs.flat.recommended, files: ["apps/**/*.{ts,tsx}"] },
  { ...jsxA11y.configs.recommended, files: ["apps/**/*.{ts,tsx}"] },
  ...bloquesDeWeb,
  { ignores: ["**/.next"] },
);
