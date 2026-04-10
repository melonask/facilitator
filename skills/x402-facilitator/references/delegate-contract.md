# Delegate Contract — Deployment & Addresses

## Deployed Addresses

The `Delegate.sol` contract is deployed via CREATE2 at the **same address on all supported networks**:

| Network          | Chain ID | Address                                      |
| ---------------- | -------- | -------------------------------------------- |
| Ethereum Mainnet | 1        | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Optimism         | 10       | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| BNB Chain        | 56       | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Polygon          | 137      | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Base             | 8453     | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Arbitrum         | 42161    | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Avalanche        | 43114    | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |

## Local Testing (Anvil / Foundry)

If you are writing tests on a local network, you **must run Anvil with the Prague hardfork**. EIP-7702 Type-4 transactions are only supported from Prague onwards. Without it, transactions might succeed but the EOA delegation will not persist.

```bash
# Start Anvil with Prague support
anvil --hardfork prague
```

Once running, you can manually deploy the Delegate to `127.0.0.1:8545` to test the full lifecycle.

## Deploying to a New Network

The contract uses the Arachnid Deterministic Deployment Proxy (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) which is pre-deployed on virtually every EVM chain. Because the salt and initcode are fixed, the address will be the same everywhere.

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, cast)
- A funded deployer wallet (even 0 ETH works on most chains — the CREATE2 factory pays gas)
- RPC URL for the target network

### Steps

1. Install the facilitator contracts:

```bash
forge install melonask/facilitator
```

2. Deploy:

```bash
forge script lib/facilitator/packages/contracts/script/Deploy.s.sol \
  --rpc-url <YOUR_RPC_URL> \
  --broadcast
```

The script will:

- Predict the address (verify it matches `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd`)
- Skip if the contract is already deployed at that address
- Otherwise deploy via the CREATE2 factory

### Override the Salt

If you need a different address (e.g., on a chain where the default address is already taken), set the `DEPLOY_SALT` environment variable:

```bash
DEPLOY_SALT=0x... forge script lib/facilitator/packages/contracts/script/Deploy.s.sol \
  --rpc-url <YOUR_RPC_URL> \
  --broadcast
```

Then pass `--delegate-address <your-address>` to the facilitator server.

### Verify the Deployment

```bash
cast code 0xD064939e706dC03699dB7Fe58bB0553afDF39fDd --rpc-url <YOUR_RPC_URL>
```

If the output is `0x` (empty), the contract is not deployed yet on that chain.

## Contract Details

- **Solidity Version:** `^0.8.24`
- **EVM Target:** Prague (Cancun + EIP-7702)
- **Compiler Settings:** `via_ir = true`, `optimizer_runs = 1`, `bytecode_hash = "none"`
- **OpenZeppelin:** v5.5.0
- **EIP-712 Domain:** `{ name: "Delegate", version: "1.0" }`
- **Key Functions:**
  - `transfer(PaymentIntent, bytes)` — Execute a signed ERC-20 payment
  - `transferEth(EthPaymentIntent, bytes)` — Execute a signed native ETH payment
  - `invalidateNonce(uint256)` — Cancel a pending intent (owner only)
- **Key Events:**
  - `PaymentExecuted(address indexed token, address indexed to, uint256 amount, uint256 indexed nonce)`
  - `EthPaymentExecuted(address indexed to, uint256 amount, uint256 indexed nonce)`
  - `NonceInvalidated(uint256 indexed nonce)`

**Warning:** This contract has not been audited.
