import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  type Account,
  type Address,
  type LocalAccount,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { Eip7702Mechanism } from "../src/eip7702.js";
import {
  ADDRESS_ZERO,
  type ClientProvider,
  ErrorReason,
  type NonceManager,
} from "../src/types.js";

// --- Mocks & Setup ---

const MOCK_CHAIN_ID = 1;
const RELAYER_PK = generatePrivateKey();
const RELAYER_ACCOUNT = privateKeyToAccount(RELAYER_PK);
const DELEGATE_ADDRESS =
  "0xDe1e6a7eD0000000000000000000000000000001" as Address;
const TOKEN_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;

function createMockPublicClient() {
  return {
    getBalance: mock.fn(async () => 1000000000000000000n),
    readContract: mock.fn(async () => 1000000n),
    getCode: mock.fn(async () => undefined),
    call: mock.fn(async () => "0x"),
    waitForTransactionReceipt: mock.fn(async () => ({ status: "success" })),
  } as unknown as PublicClient;
}

function createMockWalletClient() {
  return {
    chain: mainnet,
    sendTransaction: mock.fn(async () => "0xTxHash"),
  } as unknown as WalletClient;
}

// --- Helper to create valid payloads ---

async function createPayload(
  signer: Account,
  intent: any,
  isEth: boolean = false,
) {
  const localSigner = signer as LocalAccount;
  if (!localSigner.signAuthorization) {
    throw new Error("Signer does not support signAuthorization");
  }

  const authorization = await localSigner.signAuthorization({
    contractAddress: DELEGATE_ADDRESS,
    chainId: MOCK_CHAIN_ID,
    nonce: 0,
  });

  const domain = {
    name: "Delegate",
    version: "1.0",
    chainId: MOCK_CHAIN_ID,
    verifyingContract: signer.address,
  };

  let signature;
  if (isEth) {
    signature = await localSigner.signTypedData({
      domain,
      types: {
        EthPaymentIntent: [
          { name: "amount", type: "uint256" },
          { name: "to", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "EthPaymentIntent",
      message: {
        amount: BigInt(intent.amount),
        to: intent.to,
        nonce: BigInt(intent.nonce),
        deadline: BigInt(intent.deadline),
      },
    });
  } else {
    signature = await localSigner.signTypedData({
      domain,
      types: {
        PaymentIntent: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "to", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "PaymentIntent",
      message: {
        token: intent.token,
        amount: BigInt(intent.amount),
        to: intent.to,
        nonce: BigInt(intent.nonce),
        deadline: BigInt(intent.deadline),
      },
    });
  }

  return {
    x402Version: 2,
    resource: {
      url: "http://test.com",
      description: "test",
      mimeType: "text/plain",
    },
    accepted: {
      scheme: "eip7702",
      network: `eip155:${MOCK_CHAIN_ID}` as `${string}:${string}`,
      asset: isEth ? ADDRESS_ZERO : intent.token,
      amount: intent.amount,
      payTo: intent.to,
      maxTimeoutSeconds: 3600,
      extra: {},
    },
    payload: {
      authorization: {
        contractAddress: (authorization as any).contractAddress || (authorization as any).address,
        chainId: authorization.chainId,
        nonce: authorization.nonce,
        r: authorization.r,
        s: authorization.s,
        yParity: authorization.yParity ?? (authorization.v === 27n ? 0 : 1),
      },
      intent,
      signature,
    },
  };
}

describe("Eip7702Mechanism", () => {
  let mechanism: Eip7702Mechanism;
  let user: Account;
  let mockPublicClient: PublicClient;
  let mockWalletClient: WalletClient;
  let mockNonceManager: NonceManager;

  beforeEach(() => {
    mockPublicClient = createMockPublicClient();
    mockWalletClient = createMockWalletClient();
    mockNonceManager = {
      checkAndMark: mock.fn(() => true),
      has: mock.fn(() => false),
    };

    const mockClientProvider: ClientProvider = {
      getPublicClient: (_chainId: number) => mockPublicClient,
      getWalletClient: (_chainId: number) => mockWalletClient,
    };

    mechanism = new Eip7702Mechanism({
      delegateAddress: DELEGATE_ADDRESS,
      relayerAccount: RELAYER_ACCOUNT,
      clientProvider: mockClientProvider,
      nonceManager: mockNonceManager,
    });
    user = privateKeyToAccount(generatePrivateKey());
  });

  describe("Verify (ERC20)", () => {
    it("should verify a valid ERC20 payment payload", async () => {
      const intent = {
        token: TOKEN_ADDRESS,
        amount: "100",
        to: RELAYER_ACCOUNT.address,
        nonce: "12345",
        deadline: (Math.floor(Date.now() / 1000) + 3600).toString(),
      };

      const payload = await createPayload(user, intent, false);

      const reqs = {
        scheme: "eip7702",
        network: `eip155:${MOCK_CHAIN_ID}` as `${string}:${string}`,
        asset: TOKEN_ADDRESS,
        amount: "100",
        payTo: RELAYER_ACCOUNT.address,
        maxTimeoutSeconds: 3600,
        extra: {},
      };

      const result = await mechanism.verify(payload, reqs);
      assert.equal(result.isValid, true);
      assert.equal(result.payer?.toLowerCase(), user.address.toLowerCase());
    });

    it("should fail if deadline is expired", async () => {
      const intent = {
        token: TOKEN_ADDRESS,
        amount: "100",
        to: RELAYER_ACCOUNT.address,
        nonce: "12345",
        deadline: (Math.floor(Date.now() / 1000) - 100).toString(),
      };

      const payload = await createPayload(user, intent, false);

      const reqs = {
        scheme: "eip7702",
        network: `eip155:${MOCK_CHAIN_ID}` as `${string}:${string}`,
        asset: TOKEN_ADDRESS,
        amount: "100",
        payTo: RELAYER_ACCOUNT.address,
        maxTimeoutSeconds: 3600,
        extra: {},
      };

      const result = await mechanism.verify(payload, reqs);
      assert.equal(result.isValid, false);
      assert.equal(result.invalidReason, ErrorReason.Expired);
    });

    it("should fail if balance is insufficient", async () => {
      // Override readContract to return 0
      (mockPublicClient as any).readContract = mock.fn(async () => 0n);

      const intent = {
        token: TOKEN_ADDRESS,
        amount: "100",
        to: RELAYER_ACCOUNT.address,
        nonce: "12345",
        deadline: (Math.floor(Date.now() / 1000) + 3600).toString(),
      };

      const payload = await createPayload(user, intent, false);

      const reqs = {
        scheme: "eip7702",
        network: `eip155:${MOCK_CHAIN_ID}` as `${string}:${string}`,
        asset: TOKEN_ADDRESS,
        amount: "100",
        payTo: RELAYER_ACCOUNT.address,
        maxTimeoutSeconds: 3600,
        extra: {},
      };

      const result = await mechanism.verify(payload, reqs);
      assert.equal(result.isValid, false);
      assert.equal(result.invalidReason, ErrorReason.InsufficientBalance);
    });
  });

  describe("Settle", () => {
    it("should settle a valid payload and return tx hash", async () => {
      const intent = {
        token: TOKEN_ADDRESS,
        amount: "100",
        to: RELAYER_ACCOUNT.address,
        nonce: "12345",
        deadline: (Math.floor(Date.now() / 1000) + 3600).toString(),
      };

      const payload = await createPayload(user, intent, false);

      const reqs = {
        scheme: "eip7702",
        network: `eip155:${MOCK_CHAIN_ID}` as `${string}:${string}`,
        asset: TOKEN_ADDRESS,
        amount: "100",
        payTo: RELAYER_ACCOUNT.address,
        maxTimeoutSeconds: 3600,
        extra: {},
      };

      const result = await mechanism.settle(payload, reqs);
      assert.equal(result.success, true);
      assert.equal(result.transaction, "0xTxHash");
      assert.equal((mockNonceManager.checkAndMark as any).mock.callCount(), 1);
      assert.equal((mockWalletClient as any).sendTransaction.mock.callCount(), 1);
    });
  });
});
