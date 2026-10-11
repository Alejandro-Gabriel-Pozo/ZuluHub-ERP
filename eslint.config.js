import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import { bloques as bloquesDeDinero } from "./arquitectura/lint-dinero.cjs";
import { bloques as bloquesDeSql } from "./arquitectura/lint-sql.cjs";

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
);
