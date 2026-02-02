#!/usr/bin/env node
import { x402Facilitator } from "@x402/core/facilitator";
import { type NonceManager } from "../types.js";
export declare class InMemoryNonceManager implements NonceManager {
    private used;
    checkAndMark(nonce: string): boolean;
    has(nonce: string): boolean;
}
export declare function createHandler(facilitator: x402Facilitator, extra?: {
    publicClient: any;
    relayerAddress: string;
}): (req: Request) => Promise<Response>;
