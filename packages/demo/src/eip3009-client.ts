import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/fetch";
import { type Address, type Hex, type PrivateKeyAccount, getAddress } from "viem";

// EIP-3009 TransferWithAuthorization EIP-712 types
const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function createNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export class Eip3009Scheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  constructor(
    private account: PrivateKeyAccount,
    private chainId: number,
  ) {}

  async createPaymentPayload(
    _version: number,
    requirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    if (requirements.scheme !== "exact") {
      throw new Error(`Unsupported scheme: ${requirements.scheme}`);
    }

    console.log("   [Agent 2] Signing ERC-3009 TransferWithAuthorization...");

    const now = Math.floor(Date.now() / 1000);
    const nonce = createNonce();

    const authorization = {
      from: this.account.address,
      to: getAddress(requirements.payTo as Address),
      value: requirements.amount,
      validAfter: (now - 600).toString(),
      validBefore: (now + requirements.maxTimeoutSeconds).toString(),
      nonce,
    };

    const name = requirements.extra?.name as string;
    const version = requirements.extra?.version as string;

    if (!name || !version) {
      throw new Error("EIP-712 domain (name, version) required in requirements.extra");
    }

    const domain = {
      name,
      version,
      chainId: this.chainId,
      verifyingContract: getAddress(requirements.asset as Address),
    };

    const message = {
      from: getAddress(authorization.from),
      to: getAddress(authorization.to),
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    };

    const signature = await this.account.signTypedData({
      domain,
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization",
      message,
    });

    console.log("   [Agent 2] Sending Signed Request");

    return {
      x402Version: 2,
      payload: {
        authorization,
        signature,
      },
    };
  }
}
