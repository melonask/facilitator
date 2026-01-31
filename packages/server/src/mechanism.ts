import { type Address, encodeFunctionData, verifyTypedData } from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { DELEGATE_ABI, ERC20_ABI } from "./abi";
import {
  DELEGATE_CONTRACT_ADDRESS,
  getClients,
  relayerAccount,
} from "./config";
import { nonceManager } from "./storage";
import {
  ADDRESS_ZERO,
  type Eip7702Authorization,
  type Eip7702EthPayloadData,
  type Eip7702PayloadData,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
} from "./types";

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
    throw new Error("Missing required EIP-7702 payload fields");
  }
  return payload as unknown as T;
}

function buildDomain(chainId: number, verifyingContract: Address) {
  return { ...EIP712_DOMAIN, chainId, verifyingContract };
}

// --- Mechanism ---

export class Eip7702Mechanism {
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

    if (
      authorization.contractAddress.toLowerCase() !==
      DELEGATE_CONTRACT_ADDRESS.toLowerCase()
    ) {
      throw new Error("Untrusted Delegate Contract");
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

  async verify(
    payload: PaymentPayload,
    reqs: PaymentRequirements,
  ): Promise<VerifyResponse> {
    try {
      const chainId = parseChainId(reqs.network);
      const ethPayment = isEthPayment(reqs);
      const { authorization, signature } = extractPayload<Eip7702PayloadData>(
        payload.payload,
      );
      const { publicClient } = getClients(chainId);

      // 1. Verify EIP-7702 authorization
      const signer = await this.recoverSigner(authorization);

      // 2. Verify EIP-712 intent signature
      const valid = await this.verifyIntentSignature(
        payload,
        ethPayment,
        chainId,
        signer,
        signature,
      );
      if (!valid) {
        return { isValid: false, invalidReason: "Invalid Intent Signature" };
      }

      // 3. Check deadline
      const intent = extractPayload<Eip7702PayloadData>(payload.payload).intent;
      if (BigInt(intent.deadline) < BigInt(Math.floor(Date.now() / 1000))) {
        return { isValid: false, invalidReason: "Deadline Expired" };
      }

      // 4. Check nonce
      if (!nonceManager.checkAndMark(intent.nonce.toString())) {
        return { isValid: false, invalidReason: "Nonce Used" };
      }

      // 5. Check balance
      if (ethPayment) {
        const balance = await publicClient.getBalance({ address: signer });
        if (balance < BigInt(intent.amount)) {
          return { isValid: false, invalidReason: "Insufficient Balance" };
        }
      } else {
        const balance = await publicClient.readContract({
          address: intent.token,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [signer],
        });
        if (balance < BigInt(intent.amount)) {
          return { isValid: false, invalidReason: "Insufficient Balance" };
        }
      }

      return { isValid: true, payer: signer };
    } catch (e) {
      console.error(e);
      return { isValid: false, invalidReason: (e as Error).message };
    }
  }

  async settle(
    payload: PaymentPayload,
    reqs: PaymentRequirements,
  ): Promise<SettleResponse> {
    try {
      const verification = await this.verify(payload, reqs);
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

      await publicClient.waitForTransactionReceipt({ hash });

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

export const mechanism = new Eip7702Mechanism();
