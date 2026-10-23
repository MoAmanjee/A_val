import path from "node:path";
import { defineConfig } from "vitest/config";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://autoquote:autoquote@localhost:5432/autoquote_test?schema=public";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: TEST_DB,
      AUTH_SECRET: "test-secret-test-secret-test-secret-test-1234",
      ENCRYPTION_KEY: "test-encryption-key-test-encryption-key-1234",
      WHATSAPP_DRIVER: "mock",
      WHATSAPP_VERIFY_TOKEN: "verify-me",
      WHATSAPP_APP_SECRET: "",
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: path.resolve(__dirname, "storage-test"),
      OPENAI_API_KEY: "",
      VIN_DECODER: "basic",
    },
  },
});
