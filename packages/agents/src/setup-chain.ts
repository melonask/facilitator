import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// Import Artifacts
import delegateArtifact from "../test/Delegate.json";
import tokenArtifact from "../test/MockERC20.json";

const ANVIL_PORT = 8545;
const DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RELAYER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const BUYER_KEY =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

async function main() {
  const transport = http(`http://127.0.0.1:${ANVIL_PORT}`);
  const publicClient = createPublicClient({ chain: foundry, transport });
  const walletClient = createWalletClient({ chain: foundry, transport });

  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const relayer = privateKeyToAccount(RELAYER_KEY);
  const buyer = privateKeyToAccount(BUYER_KEY);

  console.log("🚀 Deploying Contracts...");

  // Deploy Delegate
  const deployDelegateHash = await walletClient.deployContract({
    account: deployer,
    abi: delegateArtifact.abi,
    bytecode: delegateArtifact.bytecode.object as Hex,
  });
  const delegateAddress = (
    await publicClient.waitForTransactionReceipt({ hash: deployDelegateHash })
  ).contractAddress!;
  console.log(`\nexport DELEGATE_ADDRESS=${delegateAddress}`);

  // Deploy Token
  const deployTokenHash = await walletClient.deployContract({
    account: deployer,
    abi: tokenArtifact.abi,
    bytecode: tokenArtifact.bytecode.object as Hex,
  });
  const tokenAddress = (
    await publicClient.waitForTransactionReceipt({ hash: deployTokenHash })
  ).contractAddress!;
  console.log(`export TOKEN_ADDRESS=${tokenAddress}`);

  // Mint to Buyer
  await walletClient.writeContract({
    account: deployer,
    address: tokenAddress,
    abi: tokenArtifact.abi,
    functionName: "mint",
    args: [buyer.address, parseEther("1000")],
  });
  console.log("\n✅ Minted 1000 Tokens to Buyer");

  // Fund Relayer
  await walletClient.sendTransaction({
    account: deployer,
    to: relayer.address,
    value: parseEther("10"),
  });
  console.log("✅ Funded Relayer with 10 ETH");
}

main();
