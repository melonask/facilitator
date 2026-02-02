import type { SchemeNetworkFacilitator } from "@x402/core/types";
import {
  encodeFunctionData,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import {
  EIP3009_ABI,
  ERC20_ABI,
  PERMIT2_ADDRESS,
  PERMIT2_PROXY_ABI,
  PERMIT2_PROXY_ADDRESS,
} from "../abi";
import { getClients, relayerAccount } from "../config";
import { log } from "../logger";
import {
  ErrorReason,
  type ExactEIP3009Payload,
  type ExactPermit2Payload,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
} from "../types";

// --- Constants ---

const EXPIRY_GRACE_SECONDS = 6;
const RECEIPT_TIMEOUT_MS = 30_000;

// --- Helpers ---

function parseChainId(network: string): number {
  const chainId = Number(network.split(":")[1]);
  if (isNaN(chainId)) throw new Error(`Invalid network format: ${network}`);
  return chainId;
}

function addrEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isPermit2Payload(
  payload: Record<string, unknown>,
): payload is ExactPermit2Payload & Record<string, unknown> {
  return "permit2Authorization" in payload;
}

function isEIP3009Payload(
  payload: Record<string, unknown>,
): payload is ExactEIP3009Payload & Record<string, unknown> {
  return "authorization" in payload && !("permit2Authorization" in payload);
}

// --- EIP-712 Type Definitions for EIP-3009 ---

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// --- EIP-712 Type Definitions for Permit2 ---

const PERMIT2_WITNESS_TYPES = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "x402Witness" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  x402Witness: [
    { name: "to", type: "address" },
    { name: "validAfter", type: "uint256" },
    { name: "extra", type: "bytes32" },
  ],
} as const;

// --- Mechanism ---

export class ExactEvmMechanism implements SchemeNetworkFacilitator {
  readonly scheme = "exact" as const;
  readonly caipFamily = "eip155:*" as const;

  getExtra(_network: string): undefined {
    return undefined;
  }

  getSigners(_network: string): string[] {
    return [relayerAccount.address];
  }

  async verify(
    payload: PaymentPayload,
    reqs: PaymentRequirements,
  ): Promise<VerifyResponse> {
    try {
      const raw = payload.payload;

      if (isPermit2Payload(raw)) {
        return this.verifyPermit2(raw, reqs);
      }
      if (isEIP3009Payload(raw)) {
        return this.verifyEIP3009(raw, reqs);
      }

      return { isValid: false, invalidReason: ErrorReason.InvalidPayload };
    } catch (e) {
      log.error("Exact verify failed", { error: (e as Error).message });
      return { isValid: false, invalidReason: (e as Error).message };
    }
  }

  async settle(
    payload: PaymentPayload,
    reqs: PaymentRequirements,
  ): Promise<SettleResponse> {
    try {
      const raw = payload.payload;

      if (isPermit2Payload(raw)) {
        return this.settlePermit2(raw, reqs);
      }
      if (isEIP3009Payload(raw)) {
        return this.settleEIP3009(raw, reqs);
      }

      return {
        success: false,
        errorReason: ErrorReason.InvalidPayload,
        transaction: "",
        network: reqs.network,
      };
    } catch (e) {
      log.error("Exact settle failed", { error: (e as Error).message });
      return {
        success: false,
        errorReason: (e as Error).message,
        transaction: "",
        network: reqs.network,
      };
    }
  }

  // ========== EIP-3009 ==========

  private async verifyEIP3009(
    raw: ExactEIP3009Payload,
    reqs: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const { authorization, signature } = raw;
    if (!authorization || !signature) {
      return { isValid: false, invalidReason: ErrorReason.InvalidPayload };
    }

    const chainId = parseChainId(reqs.network);

    // Require extra.name and extra.version for EIP-712 domain
    const tokenName = reqs.extra?.name as string | undefined;
    const tokenVersion = reqs.extra?.version as string | undefined;
    if (!tokenName || !tokenVersion) {
      return {
        isValid: false,
        invalidReason: ErrorReason.InvalidPayload,
      };
    }

    // Build EIP-712 domain for the token contract
    const domain = {
      name: tokenName,
      version: tokenVersion,
      chainId,
      verifyingContract: reqs.asset as Address,
    };

    // Verify signature
    const valid = await verifyTypedData({
      address: authorization.from,
      domain,
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
      signature,
    });

    if (!valid) {
      return { isValid: false, invalidReason: ErrorReason.InvalidSignature };
    }

    // Validate recipient
    if (!addrEq(authorization.to, reqs.payTo)) {
      return { isValid: false, invalidReason: ErrorReason.RecipientMismatch };
    }

    // Validate timing
    const now = Math.floor(Date.now() / 1000);
    if (
      BigInt(authorization.validBefore) < BigInt(now + EXPIRY_GRACE_SECONDS)
    ) {
      return { isValid: false, invalidReason: ErrorReason.Expired };
    }
    if (BigInt(authorization.validAfter) > BigInt(now)) {
      return { isValid: false, invalidReason: ErrorReason.Expired };
    }

    // Validate amount
    if (BigInt(authorization.value) < BigInt(reqs.amount)) {
      return {
        isValid: false,
        invalidReason: ErrorReason.InsufficientPaymentAmount,
      };
    }

    // Check on-chain balance
    const { publicClient } = getClients(chainId);
    const balance = await publicClient.readContract({
      address: reqs.asset as Address,
      abi: EIP3009_ABI,
      functionName: "balanceOf",
      args: [authorization.from],
    });
    if (balance < BigInt(authorization.value)) {
      return {
        isValid: false,
        invalidReason: ErrorReason.InsufficientBalance,
      };
    }

    return { isValid: true, payer: authorization.from };
  }

  private async settleEIP3009(
    raw: ExactEIP3009Payload,
    reqs: PaymentRequirements,
  ): Promise<SettleResponse> {
    // Re-verify first
    const verification = await this.verifyEIP3009(raw, reqs);
    if (!verification.isValid) {
      return {
        success: false,
        errorReason: verification.invalidReason,
        transaction: "",
        network: reqs.network,
      };
    }

    const { authorization, signature } = raw;
    const chainId = parseChainId(reqs.network);
    const { walletClient, publicClient } = getClients(chainId);
    const payer = authorization.from;

    // Determine which overload to call based on signature length
    const sigBytes = Buffer.from(signature!.slice(2), "hex");
    let data: Hex;

    if (sigBytes.length === 65) {
      // Split into v, r, s
      const r = `0x${sigBytes.subarray(0, 32).toString("hex")}` as Hex;
      const s = `0x${sigBytes.subarray(32, 64).toString("hex")}` as Hex;
      const v = sigBytes[64]!;

      data = encodeFunctionData({
        abi: EIP3009_ABI,
        functionName: "transferWithAuthorization",
        args: [
          authorization.from,
          authorization.to,
          BigInt(authorization.value),
          BigInt(authorization.validAfter),
          BigInt(authorization.validBefore),
          authorization.nonce,
          v,
          r,
          s,
        ],
      });
    } else {
      // Use bytes overload
      data = encodeFunctionData({
        abi: EIP3009_ABI,
        functionName: "transferWithAuthorization",
        args: [
          authorization.from,
          authorization.to,
          BigInt(authorization.value),
          BigInt(authorization.validAfter),
          BigInt(authorization.validBefore),
          authorization.nonce,
          signature!,
        ],
      });
    }

    const hash = await walletClient.sendTransaction({
      account: relayerAccount,
      chain: walletClient.chain,
      to: reqs.asset as Address,
      data,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });

    if (receipt.status === "reverted") {
      log.error("EIP-3009 transaction reverted", {
        hash,
        network: reqs.network,
      });
      return {
        success: false,
        errorReason: "TransactionReverted",
        transaction: hash,
        network: reqs.network,
      };
    }

    log.info("EIP-3009 settlement successful", {
      hash,
      network: reqs.network,
      payer,
    });

    return {
      success: true,
      transaction: hash,
      network: reqs.network,
      payer,
    };
  }

  // ========== Permit2 ==========

  private async verifyPermit2(
    raw: ExactPermit2Payload,
    reqs: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const { signature, permit2Authorization } = raw;
    if (!permit2Authorization || !signature) {
      return { isValid: false, invalidReason: ErrorReason.InvalidPayload };
    }

    const chainId = parseChainId(reqs.network);

    // Validate spender is canonical Permit2 proxy
    if (!addrEq(permit2Authorization.spender, PERMIT2_PROXY_ADDRESS)) {
      return { isValid: false, invalidReason: ErrorReason.InvalidPayload };
    }

    // Validate witness.to matches payTo
    if (!addrEq(permit2Authorization.witness.to, reqs.payTo)) {
      return { isValid: false, invalidReason: ErrorReason.RecipientMismatch };
    }

    // Validate timing
    const now = Math.floor(Date.now() / 1000);
    if (
      BigInt(permit2Authorization.deadline) < BigInt(now + EXPIRY_GRACE_SECONDS)
    ) {
      return { isValid: false, invalidReason: ErrorReason.Expired };
    }
    if (BigInt(permit2Authorization.witness.validAfter) > BigInt(now)) {
      return { isValid: false, invalidReason: ErrorReason.Expired };
    }

    // Validate amount and token
    if (BigInt(permit2Authorization.permitted.amount) < BigInt(reqs.amount)) {
      return {
        isValid: false,
        invalidReason: ErrorReason.InsufficientPaymentAmount,
      };
    }
    if (!addrEq(permit2Authorization.permitted.token, reqs.asset)) {
      return { isValid: false, invalidReason: ErrorReason.AssetMismatch };
    }

    // Build EIP-712 domain for Permit2
    const domain = {
      name: "Permit2",
      chainId,
      verifyingContract: PERMIT2_ADDRESS as Address,
    };

    const valid = await verifyTypedData({
      address: permit2Authorization.from,
      domain,
      types: PERMIT2_WITNESS_TYPES,
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: {
          token: permit2Authorization.permitted.token,
          amount: BigInt(permit2Authorization.permitted.amount),
        },
        spender: permit2Authorization.spender,
        nonce: BigInt(permit2Authorization.nonce),
        deadline: BigInt(permit2Authorization.deadline),
        witness: {
          to: permit2Authorization.witness.to,
          validAfter: BigInt(permit2Authorization.witness.validAfter),
          extra: permit2Authorization.witness.extra,
        },
      },
      signature,
    });

    if (!valid) {
      return { isValid: false, invalidReason: ErrorReason.InvalidSignature };
    }

    // Check Permit2 allowance and token balance
    const { publicClient } = getClients(chainId);
    const tokenAddress = permit2Authorization.permitted.token;

    const allowance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [permit2Authorization.from, PERMIT2_ADDRESS as Address],
    });
    if (allowance < BigInt(permit2Authorization.permitted.amount)) {
      return {
        isValid: false,
        invalidReason: ErrorReason.InsufficientBalance,
      };
    }

    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [permit2Authorization.from],
    });
    if (balance < BigInt(permit2Authorization.permitted.amount)) {
      return {
        isValid: false,
        invalidReason: ErrorReason.InsufficientBalance,
      };
    }

    return { isValid: true, payer: permit2Authorization.from };
  }

  private async settlePermit2(
    raw: ExactPermit2Payload,
    reqs: PaymentRequirements,
  ): Promise<SettleResponse> {
    const verification = await this.verifyPermit2(raw, reqs);
    if (!verification.isValid) {
      return {
        success: false,
        errorReason: verification.invalidReason,
        transaction: "",
        network: reqs.network,
      };
    }

    const { signature, permit2Authorization } = raw;
    const chainId = parseChainId(reqs.network);
    const { walletClient, publicClient } = getClients(chainId);

    const data = encodeFunctionData({
      abi: PERMIT2_PROXY_ABI,
      functionName: "settle",
      args: [
        {
          permitted: {
            token: permit2Authorization.permitted.token,
            amount: BigInt(permit2Authorization.permitted.amount),
          },
          nonce: BigInt(permit2Authorization.nonce),
          deadline: BigInt(permit2Authorization.deadline),
        },
        permit2Authorization.from,
        {
          to: permit2Authorization.witness.to,
          validAfter: BigInt(permit2Authorization.witness.validAfter),
          extra: permit2Authorization.witness.extra,
        },
        signature,
      ],
    });

    const hash = await walletClient.sendTransaction({
      account: relayerAccount,
      chain: walletClient.chain,
      to: PERMIT2_PROXY_ADDRESS as Address,
      data,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });

    if (receipt.status === "reverted") {
      log.error("Permit2 transaction reverted", {
        hash,
        network: reqs.network,
      });
      return {
        success: false,
        errorReason: "TransactionReverted",
        transaction: hash,
        network: reqs.network,
      };
    }

    log.info("Permit2 settlement successful", {
      hash,
      network: reqs.network,
      payer: permit2Authorization.from,
    });

    return {
      success: true,
      transaction: hash,
      network: reqs.network,
      payer: permit2Authorization.from,
    };
  }
}
