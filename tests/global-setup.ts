import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://autoquote:autoquote@localhost:5432/autoquote_test?schema=public";

export default function setup() {
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: "pipe" });
  rmSync(path.resolve(__dirname, "../storage-test"), { recursive: true, force: true });
}
