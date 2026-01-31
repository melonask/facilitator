import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// Artifacts
import delegateArtifact from "./Delegate.json";
import tokenArtifact from "./MockERC20.json";

const ANVIL_PORT = 8546; // Use different port than previous test to avoid conflicts
const FACILITATOR_PORT = 3001;
const WEATHER_PORT = 4001;

// Clients
const transport = http(`http://127.0.0.1:${ANVIL_PORT}`);
const publicClient = createPublicClient({ chain: foundry, transport });
const walletClient = createWalletClient({ chain: foundry, transport });

// Accounts
const deployerKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const deployer = privateKeyToAccount(deployerKey);

// Same keys as in agent files
const relayerKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const relayer = privateKeyToAccount(relayerKey);

const sellerKey =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const seller = privateKeyToAccount(sellerKey);

const buyerKey =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const buyer = privateKeyToAccount(buyerKey);

let anvilProcess: any;
let facilitatorProcess: any;
let weatherServerProcess: any;

let delegateAddress: Hex;
let tokenAddress: Hex;

describe("x402 Agent Economy", () => {
  beforeAll(async () => {
    console.log("🚀 Starting Infrastructure...");

    // 1. Anvil
    anvilProcess = Bun.spawn(["anvil", "--port", String(ANVIL_PORT)], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await new Promise((r) => setTimeout(r, 2000));

    // 2. Deploy Contracts
    const deployDelegateHash = await walletClient.deployContract({
      account: deployer,
      abi: delegateArtifact.abi,
      bytecode: delegateArtifact.bytecode.object as Hex,
    });
    delegateAddress = (
      await publicClient.waitForTransactionReceipt({ hash: deployDelegateHash })
    ).contractAddress!;
    console.log("Delegate:", delegateAddress);

    const deployTokenHash = await walletClient.deployContract({
      account: deployer,
      abi: tokenArtifact.abi,
      bytecode: tokenArtifact.bytecode.object as Hex,
    });
    tokenAddress = (
      await publicClient.waitForTransactionReceipt({ hash: deployTokenHash })
    ).contractAddress!;
    console.log("Token:", tokenAddress);

    // 3. Setup Balances
    // Mint 1000 tokens to Buyer
    await walletClient.writeContract({
      account: deployer,
      address: tokenAddress,
      abi: tokenArtifact.abi,
      functionName: "mint",
      args: [buyer.address, parseEther("1000")],
    });

    // Fund Relayer (Gas)
    await walletClient.sendTransaction({
      account: deployer,
      to: relayer.address,
      value: parseEther("10"),
    });

    // 4. Start Facilitator
    facilitatorProcess = Bun.spawn(
      ["bun", "run", "../../packages/server/src/index.ts"],
      {
        env: {
          ...process.env,
          PORT: String(FACILITATOR_PORT),
          RELAYER_PRIVATE_KEY: relayerKey,
          DELEGATE_ADDRESS: delegateAddress,
          [`RPC_URL_${foundry.id}`]: `http://127.0.0.1:${ANVIL_PORT}`,
        },
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    await new Promise((r) => setTimeout(r, 2000));

    // 5. Start Weather Agent (Server)
    weatherServerProcess = Bun.spawn(["bun", "run", "src/weather-server.ts"], {
      env: {
        ...process.env,
        PORT: String(WEATHER_PORT),
        FACILITATOR_URL: `http://localhost:${FACILITATOR_PORT}`,
        SELLER_KEY: sellerKey,
        TOKEN_ADDRESS: tokenAddress,
      },
      stdout: "inherit",
      stderr: "inherit",
    });

    // Wait for Server
    await new Promise((r) => setTimeout(r, 2000));
  }, 30000);

  afterAll(() => {
    weatherServerProcess?.kill();
    facilitatorProcess?.kill();
    anvilProcess?.kill();
  });

  test("Consumer Agent successfully pays Weather Agent", async () => {
    // Run the consumer client script
    console.log("🏃 Running Consumer Client...");

    const proc = Bun.spawn(["bun", "run", "src/consumer-client.ts"], {
      env: {
        ...process.env,
        WEATHER_AGENT_URL: `http://localhost:${WEATHER_PORT}/weather`,
        BUYER_KEY: buyerKey,
        DELEGATE_ADDRESS: delegateAddress,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();
    console.log(output);
    if (error) console.error(error);

    expect(await proc.exited).toBe(0);
    expect(output).toContain("🎉 Success! Received Weather Data");
    expect(output).toContain("Sunny");

    // Verify On-Chain
    const sellerBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenArtifact.abi,
      functionName: "balanceOf",
      args: [seller.address],
    });

    // Should have received 1 Token
    expect(sellerBalance).toBe(parseEther("1"));
  }, 30000);
});
