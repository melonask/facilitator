import type { DbType, DbConfig, PgEnvConfig } from "./types.js";

export type { DbType, DbConfig, PgEnvConfig };

export interface FacilitatorDb {
  type: DbType;
  run<T>(query: string, params?: unknown[]): Promise<T[]>;
  execute(query: string, params?: unknown[]): Promise<number>;
  close(): Promise<void>;
}

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

function buildPgConnectionString(env: PgEnvConfig): string {
  const host = env.host ?? "localhost";
  const port = env.port ?? 5432;
  const database = env.database ?? "facilitator";
  const user = env.user ?? "postgres";
  const password = env.password ?? "";
  const ssl = env.ssl ? "?ssl=true" : "";
  return `postgresql://${user}:${password}@${host}:${port}/${database}${ssl}`;
}

function resolveConfig(dbArg?: string): DbConfig | null {
  if (dbArg) {
    if (isPostgresUrl(dbArg)) {
      return { type: "pg", url: dbArg };
    }
    return { type: "sqlite", url: dbArg };
  }

  const pgHost = process.env.PGHOST;
  const pgDatabase = process.env.PGDATABASE;
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && isPostgresUrl(databaseUrl)) {
    return { type: "pg", url: databaseUrl };
  }

  if (pgHost || pgDatabase) {
    const env: PgEnvConfig = {
      host: pgHost,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
      database: pgDatabase,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: process.env.PGSSLMODE === "require",
    };
    return { type: "pg", url: buildPgConnectionString(env) };
  }

  return null;
}

const CREATE_USED_NONCES_SQLITE = `
CREATE TABLE IF NOT EXISTS used_nonces (
  nonce TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  payer TEXT NOT NULL,
  intent_nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS used_nonces_pk ON used_nonces (nonce, chain_id, payer);
CREATE INDEX IF NOT EXISTS used_nonces_created_at ON used_nonces (created_at);
`;

const CREATE_SETTLEMENTS_SQLITE = `
CREATE TABLE IF NOT EXISTS settlements (
  tx_hash TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  payer TEXT NOT NULL,
  payee TEXT NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  nonce TEXT NOT NULL,
  status TEXT NOT NULL,
  block_number INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS settlements_chain_payer ON settlements (chain_id, payer);
CREATE INDEX IF NOT EXISTS settlements_status ON settlements (status);
CREATE INDEX IF NOT EXISTS settlements_nonce_chain ON settlements (nonce, chain_id);
`;

const CREATE_USED_NONCES_PG = `
CREATE TABLE IF NOT EXISTS used_nonces (
  id SERIAL PRIMARY KEY,
  nonce TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  payer TEXT NOT NULL,
  intent_nonce TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS used_nonces_pk ON used_nonces (nonce, chain_id, payer);
CREATE INDEX IF NOT EXISTS used_nonces_created_at ON used_nonces (created_at);
`;

const CREATE_SETTLEMENTS_PG = `
CREATE TABLE IF NOT EXISTS settlements (
  tx_hash TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  payer TEXT NOT NULL,
  payee TEXT NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  nonce TEXT NOT NULL,
  status TEXT NOT NULL,
  block_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS settlements_chain_payer ON settlements (chain_id, payer);
CREATE INDEX IF NOT EXISTS settlements_status ON settlements (status);
CREATE INDEX IF NOT EXISTS settlements_nonce_chain ON settlements (nonce, chain_id);
`;

async function createSqliteDb(path: string): Promise<FacilitatorDb> {
  const Database = (await import("better-sqlite3")).default;
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  const stmts = [
    ...CREATE_USED_NONCES_SQLITE.split(";").map(s => s.trim()).filter(Boolean),
    ...CREATE_SETTLEMENTS_SQLITE.split(";").map(s => s.trim()).filter(Boolean),
  ];
  for (const stmt of stmts) {
    raw.exec(stmt);
  }

  return {
    type: "sqlite",
    async run<T>(query: string, params?: unknown[]): Promise<T[]> {
      if (params && params.length > 0) {
        const stmt = raw.prepare(query);
        const rows = stmt.all(...params);
        return rows as T[];
      }
      const rows = raw.prepare(query).all();
      return rows as T[];
    },
    async execute(query: string, params?: unknown[]): Promise<number> {
      if (params && params.length > 0) {
        const result = raw.prepare(query).run(...params);
        return result.changes;
      }
      raw.exec(query);
      return 0;
    },
    async close(): Promise<void> {
      raw.close();
    },
  };
}

async function createPgDb(connectionString: string): Promise<FacilitatorDb> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString });

  const client = await pool.connect();
  try {
    await client.query(CREATE_USED_NONCES_PG);
    await client.query(CREATE_SETTLEMENTS_PG);
  } finally {
    client.release();
  }

  return {
    type: "pg",
    async run<T>(query: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query(query, params);
      return result.rows as T[];
    },
    async execute(query: string, params?: unknown[]): Promise<number> {
      const result = await pool.query(query, params);
      return result.rowCount ?? 0;
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export async function createDb(dbArg?: string): Promise<{ db: FacilitatorDb; config: DbConfig } | null> {
  const config = resolveConfig(dbArg);
  if (!config) return null;

  if (config.type === "sqlite") {
    const db = await createSqliteDb(config.url);
    return { db, config };
  }

  const db = await createPgDb(config.url);
  return { db, config };
}
