import { createDb } from "../src/db/client";

export function testDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set for tests");
  return createDb(url);
}
