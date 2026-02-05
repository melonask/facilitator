import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from "@x402/fetch";
import { type PrivateKeyAccount } from "viem";
export declare class Eip3009Scheme implements SchemeNetworkClient {
    private account;
    private chainId;
    readonly scheme = "exact";
    constructor(account: PrivateKeyAccount, chainId: number);
    createPaymentPayload(_version: number, requirements: PaymentRequirements): Promise<Pick<PaymentPayload, "x402Version" | "payload">>;
}
