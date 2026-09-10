import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { databaseUrl } from "@/lib/env";

export type Db = PostgresJsDatabase<typeof schema>;

type Conn = { sql: postgres.Sql; db: Db; url: string };

const globalRef = globalThis as unknown as { __evidenceopsDb?: Conn };

function connect(url: string): Conn {
  const sql = postgres(url, { max: 10, prepare: false, onnotice: () => {} });
  return { sql, db: drizzle(sql, { schema }), url };
}

export function getConn(): Conn {
  const url = databaseUrl();
  if (!globalRef.__evidenceopsDb || globalRef.__evidenceopsDb.url !== url) {
    globalRef.__evidenceopsDb = connect(url);
  }
  return globalRef.__evidenceopsDb;
}

export function getDb(): Db {
  return getConn().db;
}

export function getSql(): postgres.Sql {
  return getConn().sql;
}

export async function closeDb() {
  if (globalRef.__evidenceopsDb) {
    await globalRef.__evidenceopsDb.sql.end({ timeout: 5 });
    globalRef.__evidenceopsDb = undefined;
  }
}

export { schema };
