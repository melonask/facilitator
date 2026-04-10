import { pgTable, text, integer, timestamp, uniqueIndex, index, serial } from "drizzle-orm/pg-core";

export const usedNonces = pgTable("used_nonces", {
  id: serial("id"),
  nonce: text("nonce").notNull(),
  chainId: integer("chain_id").notNull(),
  payer: text("payer").notNull(),
  intentNonce: text("intent_nonce").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("used_nonces_pk").on(t.nonce, t.chainId, t.payer),
  index("used_nonces_created_at").on(t.createdAt),
]);

export const settlements = pgTable("settlements", {
  txHash: text("tx_hash").primaryKey(),
  chainId: integer("chain_id").notNull(),
  payer: text("payer").notNull(),
  payee: text("payee").notNull(),
  token: text("token").notNull(),
  amount: text("amount").notNull(),
  nonce: text("nonce").notNull(),
  status: text("status").notNull(),
  blockNumber: integer("block_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("settlements_chain_payer").on(t.chainId, t.payer),
  index("settlements_status").on(t.status),
  index("settlements_nonce_chain").on(t.nonce, t.chainId),
]);