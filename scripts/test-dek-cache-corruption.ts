// Regression test for the DEK cache corruption bug:
//   1. Create a User (extension generates DEK, encrypts fields)
//   2. Read the user back — must decrypt cleanly
//   3. Update the user with a non-encrypted field (triggers the unwrap+wipe path)
//   4. Read the user again — MUST still decrypt cleanly
//
// Before the fix, step 4 fails because step 3's `dek.fill(0)` zeros the cached DEK.
//
// It writes and deletes a real User row, so it refuses to run against a non-local database
// unless ALLOW_PROD=1 is set explicitly. Note that .env in this repo points at PRODUCTION.
//
// Usage:
//   DATABASE_URL=postgresql://localhost:5432/record_local \
//   npx ts-node -r dotenv/config -r tsconfig-paths/register \
//     --compiler-options '{"module":"CommonJS"}' scripts/test-dek-cache-corruption.ts

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

import { randomUUID } from "crypto";

// --- safety gate: local databases only, unless ALLOW_PROD=1 ---------------------------------
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function databaseHost(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const host = databaseHost(process.env.DATABASE_URL);
if (!LOCAL_HOSTS.has(host) && process.env.ALLOW_PROD !== "1") {
  console.error(
    `Refusing to run: DATABASE_URL host is "${host || "unparseable"}", not localhost.\n` +
      "This script creates and deletes a real User row. Point DATABASE_URL at a local database, " +
      "or set ALLOW_PROD=1 if you really mean to touch that server.",
  );
  process.exit(1);
}

// Imported after the gate so a refused run never opens a connection to the wrong database.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require("../lib/prisma") as typeof import("../lib/prisma");

const TEST_EMAIL = `test-${randomUUID()}@horacemann.org`;

async function main() {
  console.log(`Target host: ${host || "unknown"} (db url masked)`);
  console.log(`Test email: ${TEST_EMAIL}\n`);

  console.log("Step 1: create user");
  const created = await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      name: "DEK Cache Test User",
      image: "https://example.com/avatar.png",
    } as never,
  });
  console.log(`  ✓ id=${created.id} name="${created.name}" image="${created.image}"`);

  console.log("\nStep 2: read after create");
  const read1 = await prisma.user.findUnique({ where: { id: created.id } });
  console.log(`  name="${read1?.name}" email="${read1?.email}" image="${read1?.image}"`);
  if (!read1?.name || !read1?.email) throw new Error("read after create failed");

  console.log("\nStep 3: update (non-encrypted field — googleImage)");
  await prisma.user.update({
    where: { id: created.id },
    data: { googleImage: "https://lh3.googleusercontent.com/test" },
  });
  console.log("  ✓ updated");

  console.log("\nStep 4: read after update — THIS is where the bug surfaces");
  const read2 = await prisma.user.findUnique({ where: { id: created.id } });
  console.log(`  name="${read2?.name}" email="${read2?.email}" image="${read2?.image}"`);
  if (!read2?.name || !read2?.email) {
    console.log("\n✗ BUG: post-update decrypt returned null/empty for encrypted fields");
    process.exitCode = 1;
  } else {
    console.log("\n✓ Post-update decrypt works. Bug fixed.");
  }

  console.log("\nCleanup: deleting test user");
  await prisma.user.delete({ where: { id: created.id } });
  console.log("  ✓ deleted");
}

main()
  .catch((e) => { console.error("FATAL:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
