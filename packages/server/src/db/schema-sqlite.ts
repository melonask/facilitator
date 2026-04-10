import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const usedNonces = sqliteTable("used_nonces", {
  nonce: text("nonce").notNull(),
  chainId: integer("chain_id").notNull(),
  payer: text("payer").notNull(),
  intentNonce: text("intent_nonce").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
}, (t) => [
  uniqueIndex("used_nonces_pk").on(t.nonce, t.chainId, t.payer),
  index("used_nonces_created_at").on(t.createdAt),
]);

export const settlements = sqliteTable("settlements", {
  txHash: text("tx_hash").primaryKey(),
  chainId: integer("chain_id").notNull(),
  payer: text("payer").notNull(),
  payee: text("payee").notNull(),
  token: text("token").notNull(),
  amount: text("amount").notNull(),
  nonce: text("nonce").notNull(),
  status: text("status").notNull(),
  blockNumber: integer("block_number"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
}, (t) => [
  index("settlements_chain_payer").on(t.chainId, t.payer),
  index("settlements_status").on(t.status),
  index("settlements_nonce_chain").on(t.nonce, t.chainId),
]);