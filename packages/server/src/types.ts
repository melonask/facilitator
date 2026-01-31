import type { Address, Hex } from "viem";
import { zeroAddress } from "viem";
import type { PaymentPayload } from "@x402/core/types";

// Re-export all x402 core types used by this package
export type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleRequest,
  SettleResponse,
  SupportedResponse,
  VerifyRequest,
  VerifyResponse,
} from "@x402/core/types";

// ResourceInfo is not directly exported from @x402/core/types,
// so we extract it from PaymentPayload where it's inlined.
export type ResourceInfo = PaymentPayload["resource"];

// --- EIP-7702 Implementation Types ---

export const ADDRESS_ZERO = zeroAddress;

export interface Eip7702Authorization {
  contractAddress: Address;
  chainId: number;
  nonce: number;
  r: Hex;
  s: Hex;
  yParity: number;
}

export interface Eip7702Erc20Intent {
  token: Address;
  amount: string;
  to: Address;
  nonce: string;
  deadline: string;
}

export interface Eip7702EthIntent {
  amount: string;
  to: Address;
  nonce: string;
  deadline: string;
}

export interface Eip7702PayloadData {
  authorization: Eip7702Authorization;
  intent: Eip7702Erc20Intent;
  signature: Hex;
}

export interface Eip7702EthPayloadData {
  authorization: Eip7702Authorization;
  intent: Eip7702EthIntent;
  signature: Hex;
}

// --- Discovery Types ---

export interface DiscoveryItem {
  resource: string;
  type: string;
  x402Version: number;
  accepts: import("@x402/core/types").PaymentRequirements[];
  lastUpdated: string;
  metadata?: Record<string, unknown>;
}

export interface DiscoveryResponse {
  x402Version: number;
  items: DiscoveryItem[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}
