import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import opsmantikVoid from "./tools/eslint-plugin-opsmantik-void/index.js";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated / third-party scripts
    "public/assets/**",
    "public/*.js",
    "scripts/**",
    "coverage/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
    },
  },
  {
    files: [
      "app/api/oci/ack/route.ts",
      "app/api/oci/ack-failed/route.ts",
      "lib/oci/outbox/process-outbox.ts",
      "lib/oci/runner/process-conversion-batch.ts",
      "lib/cron/with-cron-lock.ts",
      "lib/oci/chronology-guard.ts",
      "lib/domain/pipeline-fsm.ts",
    ],
    plugins: {
      "opsmantik-void": opsmantikVoid,
    },
    rules: {
      "opsmantik-void/no-empty-catch-void": "error",
      "opsmantik-void/no-date-now-tier0": "error",
      "opsmantik-void/pipeline-stage-mutation-guard": "error",
    },
  },
  // Disallow console.log/warn/error in backend/cron/worker paths we hardened (YELLOW-3). Prevents regressions.
  {
    files: [
      "lib/auth/is-admin.ts",
      "app/api/cron/watchtower/route.ts",
      "app/api/workers/google-ads-oci/route.ts",
      "lib/oci/runner.ts",
      "lib/services/watchtower.ts",
      "app/api/cron/auto-junk/route.ts",
      "app/api/workers/calc-brain-score/route.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='console'][property.name=/^(log|warn|error)$/]",
          message: "Use logInfo / logWarn / logError from lib/logging/logger instead of console.",
        },
      ],
    },
  },
]);

export default eslintConfig;
