import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import { zeroAddress } from "viem";

export const ADDRESS_ZERO = zeroAddress;

export interface ClientProvider {
  getPublicClient(chainId: number): PublicClient;
  getWalletClient(chainId: number): WalletClient;
}

export interface Eip7702Config {
  delegateAddress?: Address;
  relayerAccount: Account;
  clientProvider: ClientProvider;
  nonceManager: NonceManager;
}

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

export enum ErrorReason {
  InvalidSignature = "InvalidSignature",
  Expired = "Expired",
  NonceUsed = "NonceUsed",
  InsufficientBalance = "InsufficientBalance",
  InsufficientPaymentAmount = "InsufficientPaymentAmount",
  UntrustedDelegate = "UntrustedDelegate",
  InvalidPayload = "InvalidPayload",
  ChainIdMismatch = "ChainIdMismatch",
  RecipientMismatch = "RecipientMismatch",
  AssetMismatch = "AssetMismatch",
  AcceptedRequirementsMismatch = "AcceptedRequirementsMismatch",
  TransactionSimulationFailed = "TransactionSimulationFailed",
  TransactionReverted = "TransactionReverted",
}

export interface NonceManager {
  checkAndMark(nonce: string): boolean;
  has(nonce: string): boolean;
}
