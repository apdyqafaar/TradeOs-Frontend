import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * `.mts`, not `.ts`: Vite's next-generation `configLoader: 'native'` reads this
 * file as CommonJS when the extension is `.ts` and the nearest package.json has
 * no `"type": "module"`, which makes the ESM `import`s above a warning today
 * and an error once native loading becomes the default.
 */
export default defineConfig({
  // `react` compiles the JSX in hook and component specs. Vitest does not read
  // next.config.ts, so nothing here is inherited from the app's build.
  plugins: [react()],
  resolve: {
    // The `@/*` alias, so tests import modules by the same specifier the app
    // does. Native since Vite 8 — this replaces the vite-tsconfig-paths plugin.
    tsconfigPaths: true,
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    // `.claude/worktrees/**` holds agent scratch checkouts of this same repo.
    // A leftover one is a second, *older* copy of every spec in the project,
    // so `bunx vitest run` reported 254 files / 2384 tests — the suite twice —
    // and failed on an assertion that was fixed on this branch weeks ago. The
    // real suite is 131 files / 1229 tests; this keeps that command meaning it.
    exclude: ["**/node_modules/**", "**/.next/**", "**/.claude/**"],
    // One happy-dom instance per worker instead of one per file. Per-file
    // isolation is preserved; the environment setup was 42% of the run.
    pool: "vmThreads",
  },
});
