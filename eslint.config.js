import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", ".lineage-scratch/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.es2022
      }
    }
  },
  {
    files: ["src/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }]
    }
  },
  {
    files: [
      "src/server.ts",
      "src/server/**/*.ts",
      "src/cli/**/*.ts",
      "scripts/**/*.{js,mjs,cjs,ts}",
      "packages/node-editor-protocol/**/*.{js,mjs,cjs,ts}",
      "packages/node-editor-reference-plugin/**/*.{js,mjs,cjs,ts}",
      "*.config.{js,mjs,cjs,ts}"
    ],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  }
);
