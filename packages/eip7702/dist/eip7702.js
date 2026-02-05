import { encodeFunctionData, verifyTypedData, } from "viem";
import { recoverAuthorizationAddress } from "viem/utils";
import { DELEGATE_ABI, ERC20_ABI } from "./abi.js";
import { ADDRESS_ZERO, ErrorReason, } from "./types.js";
// --- Constants ---
/** Known delegate contract addresses by chain ID. */
export const KNOWN_DELEGATE_ADDRESSES = {
    1: "0xD064939e706dC03699dB7Fe58bB0553afDF39fDd", // Ethereum Mainnet
    10: "0xD064939e706dC03699dB7Fe58bB0553afDF39fDd", // Optimism
    56: "0xD064939e706dC03699dB7Fe58bB0553afDF39fDd", // BNB Chain
    137: "0xD064939e706dC03699dB7Fe58bB0553afDF39fDd", // Polygon
    8453: "0xD064939e706dC03699dB7Fe58bB0553afDF39fDd", // Base
    42161: "0xD064939e706dC03699dB7Fe58bB0553afDF39fDd", // Arbitrum
    43114: "0xD064939e706dC03699dB7Fe58bB0553afDF39fDd", // Avalanche
};
/** Grace buffer (seconds) to account for latency between verify and on-chain execution. */
const EXPIRY_GRACE_SECONDS = 6;
/** Timeout for waiting on transaction receipts (ms). */
const RECEIPT_TIMEOUT_MS = 30_000;
// --- EIP-712 Type Definitions ---
const EIP712_DOMAIN = {
    name: "Delegate",
    version: "1.0",
};
const ERC20_INTENT_TYPES = {
    PaymentIntent: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "to", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
    ],
};
const ETH_INTENT_TYPES = {
    EthPaymentIntent: [
        { name: "amount", type: "uint256" },
        { name: "to", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
    ],
};
// --- Helpers ---
function isEthPayment(reqs) {
    return reqs.asset.toLowerCase() === ADDRESS_ZERO.toLowerCase();
}
function parseChainId(network) {
    const chainId = Number(network.split(":")[1]);
    if (isNaN(chainId))
        throw new Error(`Invalid network format: ${network}`);
    return chainId;
}
function extractPayload(payload) {
    if (!payload.authorization || !payload.intent || !payload.signature) {
        throw new Error(ErrorReason.InvalidPayload);
    }
    return payload;
}
function buildDomain(chainId, verifyingContract) {
    return { ...EIP712_DOMAIN, chainId, verifyingContract };
}
function addrEq(a, b) {
    return a.toLowerCase() === b.toLowerCase();
}
// --- Mechanism ---
export class Eip7702Mechanism {
    config;
    scheme = "eip7702";
    caipFamily = "eip155:*";
    constructor(config) {
        this.config = config;
    }
    getExtra(_network) {
        return undefined;
    }
    getSigners(_network) {
        return [this.config.relayerAccount.address];
    }
    getDelegateAddress(chainId) {
        const addr = this.config.delegateAddress ?? KNOWN_DELEGATE_ADDRESSES[chainId];
        if (!addr) {
            throw new Error(`No delegate address configured and no known preset for chain ${chainId}`);
        }
        return addr;
    }
    async recoverSigner(authorization, chainId) {
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
        if (!addrEq(authorization.contractAddress, this.getDelegateAddress(chainId))) {
            throw new Error(ErrorReason.UntrustedDelegate);
        }
        return signer;
    }
    async verifyIntentSignature(payload, ethPayment, chainId, signer, signature) {
        const domain = buildDomain(chainId, signer);
        if (ethPayment) {
            const { intent } = extractPayload(payload.payload);
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
        const { intent } = extractPayload(payload.payload);
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
    assertAcceptedRequirements(payload, reqs) {
        const accepted = payload.accepted;
        if (!accepted)
            return null;
        if (accepted.scheme !== undefined && accepted.scheme !== reqs.scheme) {
            return ErrorReason.AcceptedRequirementsMismatch;
        }
        if (accepted.network !== undefined && accepted.network !== reqs.network) {
            return ErrorReason.AcceptedRequirementsMismatch;
        }
        if (accepted.asset !== undefined &&
            !addrEq(accepted.asset, reqs.asset)) {
            return ErrorReason.AcceptedRequirementsMismatch;
        }
        if (accepted.payTo !== undefined &&
            !addrEq(accepted.payTo, reqs.payTo)) {
            return ErrorReason.AcceptedRequirementsMismatch;
        }
        if (accepted.amount !== undefined &&
            BigInt(accepted.amount) < BigInt(reqs.amount)) {
            return ErrorReason.AcceptedRequirementsMismatch;
        }
        return null;
    }
    assertIntentMatchesRequirements(intent, reqs, ethPayment) {
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
    async _verify(payload, reqs, consumeNonce) {
        try {
            const chainId = parseChainId(reqs.network);
            const ethPayment = isEthPayment(reqs);
            const { authorization, signature } = extractPayload(payload.payload);
            const publicClient = this.config.clientProvider.getPublicClient(chainId);
            const acceptedErr = this.assertAcceptedRequirements(payload, reqs);
            if (acceptedErr) {
                return { isValid: false, invalidReason: acceptedErr };
            }
            if (authorization.chainId !== chainId) {
                return { isValid: false, invalidReason: ErrorReason.ChainIdMismatch };
            }
            const signer = await this.recoverSigner(authorization, chainId);
            const valid = await this.verifyIntentSignature(payload, ethPayment, chainId, signer, signature);
            if (!valid) {
                return { isValid: false, invalidReason: ErrorReason.InvalidSignature };
            }
            const intent = extractPayload(payload.payload).intent;
            const intentForValidation = ethPayment
                ? { amount: intent.amount, to: intent.to }
                : { amount: intent.amount, to: intent.to, token: intent.token };
            const intentErr = this.assertIntentMatchesRequirements(intentForValidation, reqs, ethPayment);
            if (intentErr) {
                return { isValid: false, invalidReason: intentErr };
            }
            const nowWithGrace = BigInt(Math.floor(Date.now() / 1000) + EXPIRY_GRACE_SECONDS);
            if (BigInt(intent.deadline) < nowWithGrace) {
                return { isValid: false, invalidReason: ErrorReason.Expired };
            }
            if (consumeNonce) {
                if (!this.config.nonceManager.checkAndMark(intent.nonce.toString())) {
                    return { isValid: false, invalidReason: ErrorReason.NonceUsed };
                }
            }
            else {
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
            }
            else {
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
        }
        catch (e) {
            return { isValid: false, invalidReason: e.message };
        }
    }
    async verify(payload, reqs) {
        return this._verify(payload, reqs, false);
    }
    async settle(payload, reqs) {
        try {
            const verification = await this._verify(payload, reqs, true);
            if (!verification.isValid)
                throw new Error(verification.invalidReason);
            const chainId = parseChainId(reqs.network);
            const walletClient = this.config.clientProvider.getWalletClient(chainId);
            const publicClient = this.config.clientProvider.getPublicClient(chainId);
            const ethPayment = isEthPayment(reqs);
            const { authorization, signature } = extractPayload(payload.payload);
            const payer = verification.payer;
            let data;
            if (ethPayment) {
                const { intent } = extractPayload(payload.payload);
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
            }
            else {
                const { intent } = extractPayload(payload.payload);
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
            };
            try {
                if (hasCode) {
                    await publicClient.call(txBase);
                }
            }
            catch (simError) {
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
        }
        catch (e) {
            return {
                success: false,
                errorReason: e.message,
                transaction: "",
                network: reqs.network,
            };
        }
    }
}
