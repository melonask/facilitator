import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  encodeFunctionData,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { DELEGATE_ABI, ERC20_ABI } from "./abi.js";
import {
  ADDRESS_ZERO,
  ErrorReason,
  type Eip7702Authorization,
  type Eip7702Config,
  type Eip7702EthPayloadData,
  type Eip7702PayloadData,
} from "./types.js";

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

  constructor(private readonly config: Eip7702Config) {}

  getExtra(_network: string): undefined {
    return undefined;
  }

  getSigners(_network: string): string[] {
    return [this.config.relayerAccount.address];
  }

  private async recoverSigner(authorization: Eip7702Authorization) {
    const signer = await recoverAuthorizationAddress({
      authorization: {
        contractAddress: authorization.contractAddress,
        chainId: authorization.chainId,
        nonce: authorization.nonce,
      },
      signature: {
        r: authorization.r,
        s: authorization.s,
        yParity: authorization.yParity,
      },
    });

    if (!addrEq(authorization.contractAddress, this.config.delegateAddress)) {
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

  private assertAcceptedRequirements(
    payload: PaymentPayload,
    reqs: PaymentRequirements,
  ): ErrorReason | null {
    const accepted = (payload as Record<string, unknown>).accepted as
      | Record<string, unknown>
      | undefined;
    if (!accepted) return null;

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

  private assertIntentMatchesRequirements(
    intent: { amount: string; to: Address; token?: Address },
    reqs: PaymentRequirements,
    ethPayment: boolean,
  ): ErrorReason | null {
    if (!addrEq(intent.to, reqs.payTo)) {
      return ErrorReason.RecipientMismatch;
    }

    if (BigInt(intent.amount) < BigInt(reqs.amount)) {
      return ErrorReason.InsufficientPaymentAmount;
    }

    if (!ethPayment) {
      if (!intent.token || !addrEq(intent.token, reqs.asset)) {
        return ErrorReason.AssetMismatch;
      }
    }

    return null;
  }

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
      const publicClient = this.config.clientProvider.getPublicClient(chainId);

      const acceptedErr = this.assertAcceptedRequirements(payload, reqs);
      if (acceptedErr) {
        return { isValid: false, invalidReason: acceptedErr };
      }

      if (authorization.chainId !== chainId) {
        return { isValid: false, invalidReason: ErrorReason.ChainIdMismatch };
      }

      const signer = await this.recoverSigner(authorization);

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

      const nowWithGrace = BigInt(
        Math.floor(Date.now() / 1000) + EXPIRY_GRACE_SECONDS,
      );
      if (BigInt(intent.deadline) < nowWithGrace) {
        return { isValid: false, invalidReason: ErrorReason.Expired };
      }

      if (consumeNonce) {
        if (!this.config.nonceManager.checkAndMark(intent.nonce.toString())) {
          return { isValid: false, invalidReason: ErrorReason.NonceUsed };
        }
      } else {
        if (this.config.nonceManager.has(intent.nonce.toString())) {
          return { isValid: false, invalidReason: ErrorReason.NonceUsed };
        }
      }

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
      return { isValid: false, invalidReason: (e as Error).message };
    }
  }

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
      const walletClient = this.config.clientProvider.getWalletClient(chainId);
      const publicClient = this.config.clientProvider.getPublicClient(chainId);
      const ethPayment = isEthPayment(reqs);
      const { authorization, signature } = extractPayload<Eip7702PayloadData>(
        payload.payload,
      );
      const payer = verification.payer! as Address;

      let data: Hex;
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

      const code = await publicClient.getCode({ address: payer });
      const hasCode = code && code !== "0x";

      const txBase = {
        account: this.config.relayerAccount,
        chain: walletClient.chain,
        to: payer,
        data,
      } as const;

      try {
        if (hasCode) {
          await publicClient.call(txBase);
        }
      } catch (simError) {
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
        return {
          success: false,
          errorReason: ErrorReason.TransactionReverted,
          transaction: hash,
          network: reqs.network,
        };
      }

      return {
        success: true,
        transaction: hash,
        network: reqs.network,
        payer,
      };
    } catch (e) {
      return {
        success: false,
        errorReason: (e as Error).message,
        transaction: "",
        network: reqs.network,
      };
    }
  }
}
