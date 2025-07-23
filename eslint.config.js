import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import github from "eslint-plugin-github";

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": typescript,
      github: github,
    },
    rules: {
      // TypeScript rules
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
      //"@typescript-eslint/prefer-const": "error",
      "@typescript-eslint/no-var-requires": "error",

      // GitHub plugin rules
      "github/array-foreach": "error",
      "github/async-currenttarget": "error",
      "github/async-preventdefault": "error",
      "github/get-attribute": "error",
      "github/no-blur": "error",
      "github/no-dataset": "error",
      "github/no-dynamic-script-tag": "error",
      "github/no-implicit-buggy-globals": "error",
      "github/no-inner-html": "error",
      "github/no-useless-passive": "error",
      "github/prefer-observers": "error",
      "github/require-passive-events": "error",
      "github/unescaped-html-literal": "error",

      // General ESLint rules
      "no-console": "off", // Allow console.log for CLI tool
      "no-unused-vars": "off", // Use TypeScript version instead
      "prefer-const": "error",
      "no-var": "error",
      "no-duplicate-imports": "error",
      "no-undef": "off", // TypeScript handles this
      eqeqeq: ["error", "always"],
      curly: ["error", "all"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "github/no-inner-html": "off",
    },
  },
  {
    ignores: [
      // Build outputs
      "dist/",
      "build/",
      "*.js.map",
      "*.d.ts",

      // Dependencies
      "node_modules/",

      // State files
      ".state",

      // Logs
      "npm-debug.log*",
      "yarn-debug.log*",
      "yarn-error.log*",

      // Coverage
      "coverage/",

      // Temporary files
      "*.tmp",
      "*.temp",

      // OS files
      ".DS_Store",
      "Thumbs.db",
    ],
  },
];
