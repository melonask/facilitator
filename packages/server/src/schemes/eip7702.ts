import type { SchemeNetworkFacilitator } from "@x402/core/types";
import { encodeFunctionData, verifyTypedData, type Address } from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { DELEGATE_ABI, ERC20_ABI } from "../abi";
import {
  DELEGATE_CONTRACT_ADDRESS,
  getClients,
  relayerAccount,
} from "../config";
import { log } from "../logger";
import { nonceManager } from "../storage";
import {
  ADDRESS_ZERO,
  ErrorReason,
  type Eip7702Authorization,
  type Eip7702EthPayloadData,
  type Eip7702PayloadData,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
} from "../types";

// --- Constants ---

/** Grace buffer (seconds) to account for latency between verify and on-chain execution. */
const EXPIRY_GRACE_SECONDS = 6;

/** Timeout for waiting on transaction receipts (ms). */
const RECEIPT_TIMEOUT_MS = 30_000;

// --- EIP-712 Type Definitions ---

const EIP712_DOMAIN = {
  name: "Delegate",
  version: "1.0",
} as const;

const ERC20_INTENT_TYPES = {
  PaymentIntent: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "to", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const ETH_INTENT_TYPES = {
  EthPaymentIntent: [
    { name: "amount", type: "uint256" },
    { name: "to", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// --- Helpers ---

function isEthPayment(reqs: PaymentRequirements): boolean {
  return reqs.asset.toLowerCase() === ADDRESS_ZERO.toLowerCase();
}

function parseChainId(network: string): number {
  const chainId = Number(network.split(":")[1]);
  if (isNaN(chainId)) throw new Error(`Invalid network format: ${network}`);
  return chainId;
}

function extractPayload<T extends Eip7702PayloadData | Eip7702EthPayloadData>(
  payload: Record<string, unknown>,
): T {
  if (!payload.authorization || !payload.intent || !payload.signature) {
    throw new Error(ErrorReason.InvalidPayload);
  }
  return payload as unknown as T;
}

function buildDomain(chainId: number, verifyingContract: Address) {
  return { ...EIP712_DOMAIN, chainId, verifyingContract };
}

function addrEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// --- Mechanism ---

export class Eip7702Mechanism implements SchemeNetworkFacilitator {
  readonly scheme = "eip7702" as const;
  readonly caipFamily = "eip155:*" as const;

  getExtra(_network: string): undefined {
    return undefined;
  }

  getSigners(_network: string): string[] {
    return [relayerAccount.address];
  }

  private async recoverSigner(authorization: Eip7702Authorization) {
    const signer = await recoverAuthorizationAddress({
      authorization: {
        contractAddress: authorization.contractAddress,
        to: authorization.contractAddress,
        chainId: authorization.chainId,
        nonce: authorization.nonce,
      },
      signature: {
        r: authorization.r,
        s: authorization.s,
        yParity: authorization.yParity,
      },
    });

    if (!addrEq(authorization.contractAddress, DELEGATE_CONTRACT_ADDRESS)) {
      throw new Error(ErrorReason.UntrustedDelegate);
    }

    return signer;
  }

  private async verifyIntentSignature(
    payload: PaymentPayload,
    ethPayment: boolean,
    chainId: number,
    signer: Address,
    signature: `0x${string}`,
  ): Promise<boolean> {
    const domain = buildDomain(chainId, signer);

    if (ethPayment) {
      const { intent } = extractPayload<Eip7702EthPayloadData>(payload.payload);
      return verifyTypedData({
        address: signer,
        domain,
        types: ETH_INTENT_TYPES,
        primaryType: "EthPaymentIntent",
        message: {
          amount: BigInt(intent.amount),
          to: intent.to,
          nonce: BigInt(intent.nonce),
          deadline: BigInt(intent.deadline),
        },
        signature,
      });
    }

    const { intent } = extractPayload<Eip7702PayloadData>(payload.payload);
    return verifyTypedData({
      address: signer,
      domain,
      types: ERC20_INTENT_TYPES,
      primaryType: "PaymentIntent",
      message: {
        token: intent.token,
        amount: BigInt(intent.amount),
        to: intent.to,
        nonce: BigInt(intent.nonce),
        deadline: BigInt(intent.deadline),
      },
      signature,
    });
  }

  /**
   * Cross-check that the `accepted` requirements embedded in the V2 payload
   * match the requirements provided by the seller. Prevents a buyer from
   * agreeing to different terms than what the seller actually requires.
   */
  private assertAcceptedRequirements(
    payload: PaymentPayload,
    reqs: PaymentRequirements,
  ): ErrorReason | null {
    const accepted = (payload as Record<string, unknown>).accepted as
      | Record<string, unknown>
      | undefined;
    if (!accepted) return null; // V1 payloads don't have `accepted`

    if (accepted.scheme !== undefined && accepted.scheme !== reqs.scheme) {
      return ErrorReason.AcceptedRequirementsMismatch;
    }
    if (accepted.network !== undefined && accepted.network !== reqs.network) {
      return ErrorReason.AcceptedRequirementsMismatch;
    }
    if (
      accepted.asset !== undefined &&
      !addrEq(accepted.asset as string, reqs.asset)
    ) {
      return ErrorReason.AcceptedRequirementsMismatch;
    }
    if (
      accepted.payTo !== undefined &&
      !addrEq(accepted.payTo as string, reqs.payTo)
    ) {
      return ErrorReason.AcceptedRequirementsMismatch;
    }
    if (
      accepted.amount !== undefined &&
      BigInt(accepted.amount as string) < BigInt(reqs.amount)
    ) {
      return ErrorReason.AcceptedRequirementsMismatch;
    }
    return null;
  }

  /**
   * Validate that the intent fields match the seller's requirements.
   * This prevents the buyer from signing an intent that underpays,
   * pays the wrong recipient, or uses the wrong token.
   */
  private assertIntentMatchesRequirements(
    intent: { amount: string; to: Address; token?: Address },
    reqs: PaymentRequirements,
    ethPayment: boolean,
  ): ErrorReason | null {
    // Recipient check
    if (!addrEq(intent.to, reqs.payTo)) {
      return ErrorReason.RecipientMismatch;
    }

    // Amount check — intent must cover at least the required amount
    if (BigInt(intent.amount) < BigInt(reqs.amount)) {
      return ErrorReason.InsufficientPaymentAmount;
    }

    // Asset check — for ERC-20, token in intent must match requirements
    if (!ethPayment) {
      if (!intent.token || !addrEq(intent.token, reqs.asset)) {
        return ErrorReason.AssetMismatch;
      }
    }

    return null;
  }

  /**
   * Shared verification logic.
   * @param consumeNonce - if true, marks the nonce as used (for settlement).
   *                       if false, only checks whether it has been used (read-only verify).
   */
  private async _verify(
    payload: PaymentPayload,
    reqs: PaymentRequirements,
    consumeNonce: boolean,
  ): Promise<VerifyResponse> {
    try {
      const chainId = parseChainId(reqs.network);
      const ethPayment = isEthPayment(reqs);
      const { authorization, signature } = extractPayload<Eip7702PayloadData>(
        payload.payload,
      );
      const { publicClient } = getClients(chainId);

      // 1. Cross-check accepted requirements (V2)
      const acceptedErr = this.assertAcceptedRequirements(payload, reqs);
      if (acceptedErr) {
        return { isValid: false, invalidReason: acceptedErr };
      }

      // 2. Chain ID cross-validation
      if (authorization.chainId !== chainId) {
        return { isValid: false, invalidReason: ErrorReason.ChainIdMismatch };
      }

      // 3. Verify EIP-7702 authorization (recovers signer, checks delegate)
      const signer = await this.recoverSigner(authorization);

      // 4. Verify EIP-712 intent signature
      const valid = await this.verifyIntentSignature(
        payload,
        ethPayment,
        chainId,
        signer,
        signature,
      );
      if (!valid) {
        return { isValid: false, invalidReason: ErrorReason.InvalidSignature };
      }

      // 5. Validate intent fields against requirements (recipient, amount, asset)
      const intent = extractPayload<Eip7702PayloadData>(payload.payload).intent;
      const intentForValidation = ethPayment
        ? { amount: intent.amount, to: intent.to }
        : { amount: intent.amount, to: intent.to, token: intent.token };
      const intentErr = this.assertIntentMatchesRequirements(
        intentForValidation,
        reqs,
        ethPayment,
      );
      if (intentErr) {
        return { isValid: false, invalidReason: intentErr };
      }

      // 6. Check deadline with grace buffer
      const nowWithGrace = BigInt(
        Math.floor(Date.now() / 1000) + EXPIRY_GRACE_SECONDS,
      );
      if (BigInt(intent.deadline) < nowWithGrace) {
        return { isValid: false, invalidReason: ErrorReason.Expired };
      }

      // 7. Check nonce
      if (consumeNonce) {
        if (!nonceManager.checkAndMark(intent.nonce.toString())) {
          return { isValid: false, invalidReason: ErrorReason.NonceUsed };
        }
      } else {
        if (nonceManager.has(intent.nonce.toString())) {
          return { isValid: false, invalidReason: ErrorReason.NonceUsed };
        }
      }

      // 8. Check balance
      if (ethPayment) {
        const balance = await publicClient.getBalance({ address: signer });
        if (balance < BigInt(intent.amount)) {
          return {
            isValid: false,
            invalidReason: ErrorReason.InsufficientBalance,
          };
        }
      } else {
        const balance = await publicClient.readContract({
          address: intent.token,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [signer],
        });
        if (balance < BigInt(intent.amount)) {
          return {
            isValid: false,
            invalidReason: ErrorReason.InsufficientBalance,
          };
        }
      }

      return { isValid: true, payer: signer };
    } catch (e) {
      log.error("Verification failed", { error: (e as Error).message });
      return { isValid: false, invalidReason: (e as Error).message };
    }
  }

  /**
   * Read-only verification. Does not consume the nonce.
   */
  async verify(
    payload: PaymentPayload,
    reqs: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this._verify(payload, reqs, false);
  }

  async settle(
    payload: PaymentPayload,
    reqs: PaymentRequirements,
  ): Promise<SettleResponse> {
    try {
      const verification = await this._verify(payload, reqs, true);
      if (!verification.isValid) throw new Error(verification.invalidReason);

      const chainId = parseChainId(reqs.network);
      const { walletClient, publicClient } = getClients(chainId);
      const ethPayment = isEthPayment(reqs);
      const { authorization, signature } = extractPayload<Eip7702PayloadData>(
        payload.payload,
      );
      const payer = verification.payer! as Address;

      // Encode call data
      let data;
      if (ethPayment) {
        const { intent } = extractPayload<Eip7702EthPayloadData>(
          payload.payload,
        );
        data = encodeFunctionData({
          abi: DELEGATE_ABI,
          functionName: "transferEth",
          args: [
            {
              amount: BigInt(intent.amount),
              to: intent.to,
              nonce: BigInt(intent.nonce),
              deadline: BigInt(intent.deadline),
            },
            signature,
          ],
        });
      } else {
        const { intent } = extractPayload<Eip7702PayloadData>(payload.payload);
        data = encodeFunctionData({
          abi: DELEGATE_ABI,
          functionName: "transfer",
          args: [
            {
              token: intent.token,
              amount: BigInt(intent.amount),
              to: intent.to,
              nonce: BigInt(intent.nonce),
              deadline: BigInt(intent.deadline),
            },
            signature,
          ],
        });
      }

      // Skip authorization list if payer already has delegated code
      const code = await publicClient.getCode({ address: payer });
      const hasCode = code && code !== "0x";

      const txBase = {
        account: relayerAccount,
        chain: walletClient.chain,
        to: payer,
        data,
      } as const;

      // Simulate the transaction before spending gas
      try {
        if (hasCode) {
          await publicClient.call(txBase);
        } else {
          // For EIP-7702 txs we can't simulate with authorizationList via call(),
          // but the on-chain verification in the delegate contract will revert if
          // signatures are invalid, so the verify step above covers this case.
        }
      } catch (simError) {
        log.error("Transaction simulation failed", {
          error: (simError as Error).message,
          network: reqs.network,
        });
        return {
          success: false,
          errorReason: ErrorReason.TransactionSimulationFailed,
          transaction: "",
          network: reqs.network,
        };
      }

      const hash = hasCode
        ? await walletClient.sendTransaction(txBase)
        : await walletClient.sendTransaction({
            ...txBase,
            authorizationList: [
              {
                contractAddress: authorization.contractAddress,
                address: authorization.contractAddress,
                chainId: authorization.chainId,
                nonce: authorization.nonce,
                r: authorization.r,
                s: authorization.s,
                yParity: authorization.yParity,
              },
            ],
          });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: RECEIPT_TIMEOUT_MS,
      });

      if (receipt.status === "reverted") {
        log.error("Transaction reverted", { hash, network: reqs.network });
        return {
          success: false,
          errorReason: "TransactionReverted",
          transaction: hash,
          network: reqs.network,
        };
      }

      log.info("Settlement successful", {
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
    } catch (e) {
      log.error("Settlement failed", {
        error: (e as Error).message,
        network: reqs.network,
      });
      return {
        success: false,
        errorReason: (e as Error).message,
        transaction: "",
        network: reqs.network,
      };
    }
  }
}
