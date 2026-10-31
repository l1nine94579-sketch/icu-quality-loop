import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DB_PATH = process.env.ICU_DB_PATH ?? join(process.cwd(), "data", "icu.db");
const SCHEMA_PATH = join(process.cwd(), "db", "schema.sql");

type Global = typeof globalThis & { __icuDb?: DatabaseSync };
const g = globalThis as Global;

function open(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const conn = new DatabaseSync(DB_PATH);
  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA foreign_keys = ON");
  conn.exec("PRAGMA busy_timeout = 5000");
  conn.exec(readFileSync(SCHEMA_PATH, "utf8"));
  return conn;
}

export function db(): DatabaseSync {
  if (!g.__icuDb) g.__icuDb = open();
  return g.__icuDb;
}

/**
 * node:sqlite 返回的行是 null 原型对象，直接传给客户端组件会被 React 拒绝，
 * 这里统一转成普通对象。
 */
function plain<T>(row: unknown): T {
  return (row == null ? row : { ...(row as Record<string, unknown>) }) as T;
}

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  const rows = db().prepare(sql).all(...(params as never[]));
  return rows.map((row) => plain<T>(row));
}

export function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  const row = db().prepare(sql).get(...(params as never[]));
  return row == null ? undefined : plain<T>(row);
}

export function run(sql: string, ...params: unknown[]): { changes: number; lastId: number } {
  const res = db().prepare(sql).run(...(params as never[]));
  return { changes: Number(res.changes), lastId: Number(res.lastInsertRowid) };
}

export function tx<T>(fn: () => T): T {
  const conn = db();
  conn.exec("BEGIN");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

export const DB_FILE = DB_PATH;
