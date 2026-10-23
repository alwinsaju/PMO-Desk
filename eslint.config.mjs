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
    ignores: [
      "desktop/**",
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "release/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
