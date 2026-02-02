import type { SchemeNetworkClient, PaymentRequirements, PaymentPayload } from "@x402/fetch";
import type { Address, PrivateKeyAccount, TypedDataDomain } from "viem";

export class Eip7702Scheme implements SchemeNetworkClient {
  readonly scheme = "eip7702";

  constructor(
    private account: PrivateKeyAccount,
    private chainId: number,
    private delegateAddress: Address
  ) {}

  async createPaymentPayload(
    _version: number,
    requirements: PaymentRequirements
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    if (requirements.scheme !== "eip7702") {
      throw new Error(`Unsupported scheme: ${requirements.scheme}`);
    }

    console.log("   [Agent 2] ✍️  Signing EIP-712 Intent & EIP-7702 Auth...");

    const intent = {
      token: requirements.asset as Address,
      amount: BigInt(requirements.amount),
      to: requirements.payTo as Address,
      nonce: BigInt(Date.now()), // In prod, use real nonce
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };

    const domain: TypedDataDomain = {
      name: "Delegate",
      version: "1.0",
      chainId: this.chainId,
      verifyingContract: this.account.address,
    };

    const types = {
      PaymentIntent: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "to", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    } as const;

    // Sign EIP-712 Intent
    const signature = await this.account.signTypedData({
      domain,
      types,
      primaryType: "PaymentIntent",
      message: intent,
    });

    // Sign EIP-7702 Authorization
    const authorization = await this.account.signAuthorization({
      contractAddress: this.delegateAddress,
      chainId: this.chainId,
      nonce: 0, // In prod, query nonce
    });

    return {
        x402Version: 2,
        payload: {
          authorization: {
            contractAddress: authorization.address,
            chainId: authorization.chainId,
            nonce: authorization.nonce,
            r: authorization.r,
            s: authorization.s,
            yParity: authorization.yParity,
          },
          intent: {
            ...intent,
            amount: intent.amount.toString(),
            nonce: intent.nonce.toString(),
            deadline: intent.deadline.toString(),
          },
          signature,
        },
      };
  }
}
