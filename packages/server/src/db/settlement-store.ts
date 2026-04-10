import type { FacilitatorDb } from "./index.js";
import type { SettlementRecord, SettlementStatus } from "./types.js";

export class SettlementStore {
  constructor(private db: FacilitatorDb) {}

  async record(record: {
    txHash: string;
    chainId: number;
    payer: string;
    payee: string;
    token: string;
    amount: string;
    nonce: string;
    status: SettlementStatus;
    blockNumber?: number | null;
  }): Promise<void> {
    const blockNum = record.blockNumber ?? null;

    if (this.db.type === "sqlite") {
      await this.db.execute(
        "INSERT INTO settlements (tx_hash, chain_id, payer, payee, token, amount, nonce, status, block_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (CAST(strftime('%s','now') AS INTEGER)))",
        [record.txHash, record.chainId, record.payer, record.payee, record.token, record.amount, record.nonce, record.status, blockNum],
      );
      return;
    }

    await this.db.execute(
      "INSERT INTO settlements (tx_hash, chain_id, payer, payee, token, amount, nonce, status, block_number) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [record.txHash, record.chainId, record.payer, record.payee, record.token, record.amount, record.nonce, record.status, blockNum],
    );
  }

  async updateStatus(txHash: string, status: SettlementStatus, blockNumber?: number | null): Promise<void> {
    const blockNum = blockNumber ?? null;

    if (this.db.type === "sqlite") {
      await this.db.execute(
        "UPDATE settlements SET status = ?, block_number = ? WHERE tx_hash = ?",
        [status, blockNum, txHash],
      );
      return;
    }

    await this.db.execute(
      "UPDATE settlements SET status = $1, block_number = $2 WHERE tx_hash = $3",
      [status, blockNum, txHash],
    );
  }

  async getByTxHash(txHash: string): Promise<SettlementRecord | null> {
    if (this.db.type === "sqlite") {
      const rows = await this.db.run<SettlementRecord>(
        "SELECT * FROM settlements WHERE tx_hash = ?",
        [txHash],
      );
      return rows[0] ?? null;
    }

    const rows = await this.db.run<SettlementRecord>(
      "SELECT * FROM settlements WHERE tx_hash = $1",
      [txHash],
    );
    return rows[0] ?? null;
  }

  async listByPayer(payer: string, chainId?: number, limit = 50): Promise<SettlementRecord[]> {
    if (this.db.type === "sqlite") {
      if (chainId !== undefined) {
        return this.db.run<SettlementRecord>(
          "SELECT * FROM settlements WHERE payer = ? AND chain_id = ? ORDER BY created_at DESC LIMIT ?",
          [payer, chainId, limit],
        );
      }
      return this.db.run<SettlementRecord>(
        "SELECT * FROM settlements WHERE payer = ? ORDER BY created_at DESC LIMIT ?",
        [payer, limit],
      );
    }

    if (chainId !== undefined) {
      return this.db.run<SettlementRecord>(
        "SELECT * FROM settlements WHERE payer = $1 AND chain_id = $2 ORDER BY created_at DESC LIMIT $3",
        [payer, chainId, limit],
      );
    }
    return this.db.run<SettlementRecord>(
      "SELECT * FROM settlements WHERE payer = $1 ORDER BY created_at DESC LIMIT $2",
      [payer, limit],
    );
  }

  async findByNonceAndChain(nonce: string, chainId: number): Promise<SettlementRecord | null> {
    if (this.db.type === "sqlite") {
      const rows = await this.db.run<SettlementRecord>(
        "SELECT * FROM settlements WHERE nonce = ? AND chain_id = ? LIMIT 1",
        [nonce, chainId],
      );
      return rows[0] ?? null;
    }

    const rows = await this.db.run<SettlementRecord>(
      "SELECT * FROM settlements WHERE nonce = $1 AND chain_id = $2 LIMIT 1",
      [nonce, chainId],
    );
    return rows[0] ?? null;
  }
}