import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from "@x402/fetch";
import type { Address, PrivateKeyAccount } from "viem";
export declare class Eip7702Scheme implements SchemeNetworkClient {
    private account;
    private chainId;
    private delegateAddress;
    readonly scheme = "eip7702";
    constructor(account: PrivateKeyAccount, chainId: number, delegateAddress: Address);
    createPaymentPayload(_version: number, requirements: PaymentRequirements): Promise<Pick<PaymentPayload, "x402Version" | "payload">>;
}
