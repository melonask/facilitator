import type { PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";
import { type Eip7702Config } from "./types.js";
export declare class Eip7702Mechanism implements SchemeNetworkFacilitator {
    private readonly config;
    readonly scheme: "eip7702";
    readonly caipFamily: "eip155:*";
    constructor(config: Eip7702Config);
    getExtra(_network: string): undefined;
    getSigners(_network: string): string[];
    private recoverSigner;
    private verifyIntentSignature;
    private assertAcceptedRequirements;
    private assertIntentMatchesRequirements;
    private _verify;
    verify(payload: PaymentPayload, reqs: PaymentRequirements): Promise<VerifyResponse>;
    settle(payload: PaymentPayload, reqs: PaymentRequirements): Promise<SettleResponse>;
}
