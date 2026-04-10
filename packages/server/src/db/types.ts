export type DbType = "sqlite" | "pg";

export interface DbConfig {
  type: DbType;
  /** SQLite file path or Postgres connection string */
  url: string;
}

export interface PgEnvConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
}

export type SettlementStatus = "submitted" | "confirmed" | "reverted";

export interface SettlementRecord {
  txHash: string;
  chainId: number;
  payer: string;
  payee: string;
  token: string;
  amount: string;
  nonce: string;
  status: SettlementStatus;
  blockNumber: number | null;
  createdAt: Date | number;
}

export type NewSettlementRecord = Omit<SettlementRecord, "createdAt">;