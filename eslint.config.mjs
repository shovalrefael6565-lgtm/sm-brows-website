import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Not part of this app — third-party/tooling scaffolding outside the
      // Next.js project tree (.claude/ is already git-ignored; .agents/ is
      // untracked skill/tooling infra, not application source).
      ".agents/**",
      ".claude/**",
    ],
  },
];

export default eslintConfig;
