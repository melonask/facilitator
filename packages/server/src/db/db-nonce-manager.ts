import type { NonceManager } from "@facilitator/eip7702";
import type { FacilitatorDb } from "./index.js";

export class DbNonceManager implements NonceManager {
  constructor(private db: FacilitatorDb) {}

  async has(nonce: string): Promise<boolean> {
    if (this.db.type === "sqlite") {
      const rows = await this.db.run<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM used_nonces WHERE nonce = ?",
        [nonce],
      );
      return (rows[0]?.cnt ?? 0) > 0;
    }
    const rows = await this.db.run<{ cnt: string }>(
      "SELECT COUNT(*) as cnt FROM used_nonces WHERE nonce = $1",
      [nonce],
    );
    return Number(rows[0]?.cnt ?? 0) > 0;
  }

  async checkAndMark(nonce: string): Promise<boolean> {
    const parts = nonce.split(":");
    const chainId = Number(parts[0] ?? "0");
    const payer = parts[1] ?? "0x";
    const intentNonce = parts[2] ?? "0";

    try {
      if (this.db.type === "sqlite") {
        const changes = await this.db.execute(
          "INSERT INTO used_nonces (nonce, chain_id, payer, intent_nonce, created_at) VALUES (?, ?, ?, ?, (CAST(strftime('%s','now') AS INTEGER)))",
          [nonce, chainId, payer, intentNonce],
        );
        return changes > 0;
      }

      const changes = await this.db.execute(
        "INSERT INTO used_nonces (nonce, chain_id, payer, intent_nonce) VALUES ($1, $2, $3, $4) ON CONFLICT (nonce, chain_id, payer) DO NOTHING",
        [nonce, chainId, payer, intentNonce],
      );
      return changes > 0;
    } catch {
      return false;
    }
  }
}