import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// Artifacts
import delegateArtifact from "./Delegate.json";
import tokenArtifact from "./MockERC20.json";

const ANVIL_PORT = 8545;
const SERVER_PORT = 3000;
const CHAIN_ID = 31337;

const transport = http(`http://127.0.0.1:${ANVIL_PORT}`);
const publicClient = createPublicClient({ chain: foundry, transport });
const walletClient = createWalletClient({ chain: foundry, transport });

const deployerKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const deployer = privateKeyToAccount(deployerKey);

const relayerKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const relayer = privateKeyToAccount(relayerKey);

const userKey = generatePrivateKey();
const user = privateKeyToAccount(userKey);

let anvilProcess: any;
let serverProcess: any;
let delegateAddress: Hex;
let tokenAddress: Hex;

describe("x402 EIP-7702 Integration", () => {
  beforeAll(async () => {
    console.log("Starting Anvil...");
    anvilProcess = Bun.spawn(["anvil", "--port", String(ANVIL_PORT)], {
      stdout: "ignore",
      stderr: "ignore",
    });

    await new Promise((r) => setTimeout(r, 2000));

    console.log("Deploying contracts...");

    const deployDelegateHash = await walletClient.deployContract({
      account: deployer,
      abi: delegateArtifact.abi,
      bytecode: delegateArtifact.bytecode.object as Hex,
    });
    const receipt1 = await publicClient.waitForTransactionReceipt({
      hash: deployDelegateHash,
    });
    delegateAddress = receipt1.contractAddress!;
    console.log("Delegate deployed at:", delegateAddress);

    const deployTokenHash = await walletClient.deployContract({
      account: deployer,
      abi: tokenArtifact.abi,
      bytecode: tokenArtifact.bytecode.object as Hex,
    });
    const receipt2 = await publicClient.waitForTransactionReceipt({
      hash: deployTokenHash,
    });
    tokenAddress = receipt2.contractAddress!;
    console.log("Token deployed at:", tokenAddress);

    await walletClient.writeContract({
      account: deployer,
      address: tokenAddress,
      abi: tokenArtifact.abi,
      functionName: "mint",
      args: [user.address, parseEther("1000")],
    });

    await walletClient.sendTransaction({
      account: deployer,
      to: relayer.address,
      value: parseEther("10"),
    });

    // Fund user with ETH for ETH transfer test
    await walletClient.sendTransaction({
      account: deployer,
      to: user.address,
      value: parseEther("10"),
    });

    console.log("Starting Server...");
    serverProcess = Bun.spawn(["bun", "run", "src/index.ts"], {
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        RELAYER_PRIVATE_KEY: relayerKey,
        DELEGATE_ADDRESS: delegateAddress,
        RPC_URL_31337: `http://127.0.0.1:${ANVIL_PORT}`,
      },
      stdout: "inherit",
      stderr: "inherit",
    });

    await new Promise((r) => setTimeout(r, 2000));
  });

  afterAll(() => {
    if (serverProcess) serverProcess.kill();
    if (anvilProcess) anvilProcess.kill();
  });

  test("ERC20 transfer with EIP-7702 + EIP-712", async () => {
    const facilitatorUrl = `http://localhost:${SERVER_PORT}`;

    const requirements = {
      scheme: "eip7702",
      network: `eip155:${CHAIN_ID}`,
      asset: tokenAddress,
      amount: parseEther("10").toString(),
      payTo: deployer.address,
      maxTimeoutSeconds: 300,
      extra: {},
    };

    const intent = {
      token: tokenAddress,
      amount: requirements.amount,
      to: requirements.payTo,
      nonce: "0",
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    const signature = await user.signTypedData({
      domain: {
        name: "Delegate",
        version: "1.0",
        chainId: CHAIN_ID,
        verifyingContract: user.address,
      },
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
        to: intent.to as `0x${string}`,
        nonce: BigInt(intent.nonce),
        deadline: BigInt(intent.deadline),
      },
    });

    const authorization = await user.signAuthorization({
      contractAddress: delegateAddress,
      chainId: CHAIN_ID,
      nonce: 0,
    });

    const paymentPayload = {
      x402Version: 2,
      resource: {
        url: "http://example.com/resource",
        description: "Test Resource",
        mimeType: "application/json",
      },
      accepted: requirements,
      payload: {
        authorization: {
          contractAddress: authorization.address || delegateAddress,
          chainId: authorization.chainId,
          nonce: authorization.nonce,
          r: authorization.r,
          s: authorization.s,
          yParity: authorization.yParity,
        },
        intent,
        signature,
      },
    };

    // Verify
    console.log("Calling /verify...");
    const verifyRes = await fetch(`${facilitatorUrl}/verify`, {
      method: "POST",
      body: JSON.stringify({
        paymentPayload,
        paymentRequirements: requirements,
      }),
    });

    const verifyJson = (await verifyRes.json()) as any;
    console.log("Verify Result:", verifyJson);
    expect(verifyJson.isValid).toBe(true);
    expect(verifyJson.payer?.toLowerCase()).toBe(user.address.toLowerCase());

    // Settle (New Nonce)
    const intentSettle = { ...intent, nonce: "1" };

    const signatureSettle = await user.signTypedData({
      domain: {
        name: "Delegate",
        version: "1.0",
        chainId: CHAIN_ID,
        verifyingContract: user.address,
      },
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
        token: intentSettle.token,
        amount: BigInt(intentSettle.amount),
        to: intentSettle.to as `0x${string}`,
        nonce: BigInt(intentSettle.nonce),
        deadline: BigInt(intentSettle.deadline),
      },
    });

    const paymentPayloadSettle = {
      ...paymentPayload,
      accepted: requirements,
      payload: {
        authorization: {
          contractAddress: authorization.address || delegateAddress,
          chainId: authorization.chainId,
          nonce: authorization.nonce,
          r: authorization.r,
          s: authorization.s,
          yParity: authorization.yParity,
        },
        intent: intentSettle,
        signature: signatureSettle,
      },
    };

    console.log("Calling /settle...");
    const settleRes = await fetch(`${facilitatorUrl}/settle`, {
      method: "POST",
      body: JSON.stringify({
        paymentPayload: paymentPayloadSettle,
        paymentRequirements: requirements,
      }),
    });

    const settleJson = (await settleRes.json()) as any;
    console.log("Settle Result:", settleJson);
    expect(settleJson.success).toBe(true);

    // Verify On-Chain State
    const balanceUser = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenArtifact.abi,
      functionName: "balanceOf",
      args: [user.address],
    });
    const balancePayTo = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenArtifact.abi,
      functionName: "balanceOf",
      args: [deployer.address],
    });

    console.log("User Balance:", balanceUser);
    console.log("PayTo Balance:", balancePayTo);

    expect(balanceUser).toBe(parseEther("990"));
    expect(balancePayTo).toBe(parseEther("10"));
  }, 30000);

  test("ETH transfer with EIP-7702 + EIP-712", async () => {
    const facilitatorUrl = `http://localhost:${SERVER_PORT}`;
    const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

    const requirements = {
      scheme: "eip7702",
      network: `eip155:${CHAIN_ID}`,
      asset: ADDRESS_ZERO,
      amount: parseEther("1").toString(),
      payTo: deployer.address,
      maxTimeoutSeconds: 300,
      extra: {},
    };

    const intent = {
      amount: requirements.amount,
      to: requirements.payTo,
      nonce: "100",
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    const signature = await user.signTypedData({
      domain: {
        name: "Delegate",
        version: "1.0",
        chainId: CHAIN_ID,
        verifyingContract: user.address,
      },
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
        to: intent.to as `0x${string}`,
        nonce: BigInt(intent.nonce),
        deadline: BigInt(intent.deadline),
      },
    });

    const authorization = await user.signAuthorization({
      contractAddress: delegateAddress,
      chainId: CHAIN_ID,
      nonce: await publicClient.getTransactionCount({ address: user.address }),
    });

    const paymentPayload = {
      x402Version: 2,
      resource: {
        url: "http://example.com/resource",
        description: "Test Resource",
        mimeType: "application/json",
      },
      accepted: requirements,
      payload: {
        authorization: {
          contractAddress: authorization.address || delegateAddress,
          chainId: authorization.chainId,
          nonce: authorization.nonce,
          r: authorization.r,
          s: authorization.s,
          yParity: authorization.yParity,
        },
        intent,
        signature,
      },
    };

    // Verify
    console.log("Calling /verify for ETH...");
    const verifyRes = await fetch(`${facilitatorUrl}/verify`, {
      method: "POST",
      body: JSON.stringify({
        paymentPayload,
        paymentRequirements: requirements,
      }),
    });

    const verifyJson = (await verifyRes.json()) as any;
    console.log("ETH Verify Result:", verifyJson);
    expect(verifyJson.isValid).toBe(true);

    // Settle (New Nonce)
    const intentSettle = { ...intent, nonce: "101" };

    const signatureSettle = await user.signTypedData({
      domain: {
        name: "Delegate",
        version: "1.0",
        chainId: CHAIN_ID,
        verifyingContract: user.address,
      },
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
        amount: BigInt(intentSettle.amount),
        to: intentSettle.to as `0x${string}`,
        nonce: BigInt(intentSettle.nonce),
        deadline: BigInt(intentSettle.deadline),
      },
    });

    const paymentPayloadSettle = {
      ...paymentPayload,
      accepted: requirements,
      payload: {
        authorization: {
          contractAddress: authorization.address || delegateAddress,
          chainId: authorization.chainId,
          nonce: authorization.nonce,
          r: authorization.r,
          s: authorization.s,
          yParity: authorization.yParity,
        },
        intent: intentSettle,
        signature: signatureSettle,
      },
    };

    console.log("Calling /settle for ETH...");
    const settleRes = await fetch(`${facilitatorUrl}/settle`, {
      method: "POST",
      body: JSON.stringify({
        paymentPayload: paymentPayloadSettle,
        paymentRequirements: requirements,
      }),
    });

    const settleJson = (await settleRes.json()) as any;
    console.log("ETH Settle Result:", settleJson);
    expect(settleJson.success).toBe(true);
  }, 30000);
});
