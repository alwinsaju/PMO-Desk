import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import eslintConfigPrettier from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Must come last — turns off any core/TypeScript ESLint rules that fight
  // with Prettier's formatting instead of trying to keep both in sync.
  eslintConfigPrettier,
  {
    // Electron shell: CommonJS on Node, with the globals Node 22+ provides.
    files: ["desktop/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: Object.fromEntries(
        [
          "require",
          "module",
          "exports",
          "__dirname",
          "__filename",
          "process",
          "console",
          "Buffer",
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "setImmediate",
          "URL",
          "URLSearchParams",
          "AbortController",
          "AbortSignal",
          "fetch",
          "TextDecoder",
          "TextEncoder",
        ].map((name) => [name, "readonly"]),
      ),
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // `const { drop: _drop, ...rest } = obj` is the idiom for omitting a key.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    ignores: [
      ".claude/**",
      "agent-apps/**",
      "node_modules/**",
      ".next/**",
      ".next-*/**",
      "out/**",
      "build/**",
      "release/**",
      "tasks/**",
      "tasks-engine/.venv/**",
      "docs/qa/evidence/**",
      "docs/qa/harness/**",
      "public/sw.js",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
