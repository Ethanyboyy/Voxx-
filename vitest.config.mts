import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: "file:./prisma/test.db",
      VOX_AI_PROVIDER: "mock",
      VOX_RESEARCH_PROVIDER: "mock",
      VOX_ENCRYPTION_KEY: "dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzISE=",
      VOX_SESSION_SECRET: "dGVzdC1zZXNzaW9uLXNlY3JldC0zMmJ5dGVzISE=",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
