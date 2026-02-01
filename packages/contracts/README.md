# @facilitator/contracts

Solidity smart contracts for the x402 EIP-7702 payment facilitator. The core contract is `Delegate.sol` — the delegation target that EOAs adopt via EIP-7702 to execute token transfers. Once set, the delegation persists across transactions.

```
  How EIP-7702 Delegation Works

  ┌─────────────────────────────────────────────────────────────┐
  │                     Type 4 Transaction                      │
  │                                                             │
  │  authorization_list:                                        │
  │    [{address: Delegate, chainId: 1, nonce: N, sig: ...}]   │
  │                                                             │
  │  to: buyer_eoa        (call target = buyer's own address)  │
  │  data: transfer(intent, signature)                          │
  │  from: relayer         (relayer pays gas)                   │
  └─────────────────────────────────────────────────────────────┘
                              │
                              v
  ┌─────────────────────────────────────────────────────────────┐
  │  Buyer's EOA (during tx execution)                          │
  │                                                             │
  │  code = Delegate.sol  (persists, via EIP-7702)             │
  │                                                             │
  │  1. Verify EIP-712 signature (ECDSA.recover)               │
  │  2. Check deadline not expired                              │
  │  3. Consume nonce (replay protection)                       │
  │  4. SafeERC20.safeTransfer(token, to, amount)              │
  │     ─── works with ALL ERC-20 tokens ───                   │
  │     ─── including USDT (no bool return) ───                │
  └─────────────────────────────────────────────────────────────┘
```

## Contracts

### Delegate.sol

| Function                                   | Description                                   |
| ------------------------------------------ | --------------------------------------------- |
| `transfer(PaymentIntent, signature)`       | ERC-20 transfer via EIP-712 signed intent     |
| `transferEth(EthPaymentIntent, signature)` | Native ETH transfer via EIP-712 signed intent |
| `invalidateNonce(nonce)`                   | Cancel a nonce to prevent future use          |

**Structs:**

```solidity
struct PaymentIntent {
    address token;      // ERC-20 token address
    uint256 amount;     // Transfer amount in wei
    address to;         // Recipient address
    uint256 nonce;      // Replay protection nonce
    uint256 deadline;   // Unix timestamp expiry
}

struct EthPaymentIntent {
    uint256 amount;     // ETH amount in wei
    address to;         // Recipient address
    uint256 nonce;      // Replay protection nonce
    uint256 deadline;   // Unix timestamp expiry
}
```

**Security features:**

| Feature                | Implementation                                             |
| ---------------------- | ---------------------------------------------------------- |
| Signature verification | OpenZeppelin `ECDSA.recover` + EIP-712 domain separation   |
| Replay protection      | Per-nonce storage slot (custom slot `0x27f372...`)         |
| Deadline enforcement   | `block.timestamp <= deadline` check                        |
| Non-standard tokens    | OpenZeppelin `SafeERC20.safeTransfer` (handles USDT, etc.) |
| Domain binding         | `verifyingContract = msg.sender` (the delegating EOA)      |

## Prerequisites

- [Foundry](https://getfoundry.sh/)

## Build

```sh
forge build
```

## Test

```sh
forge test -vv
```

## Test Coverage

| Test                                | Description                            |
| ----------------------------------- | -------------------------------------- |
| `test_Eip7702_DelegatedTransfer`    | ERC-20 transfer via delegated code     |
| `test_Eip7702_DelegatedETHTransfer` | Native ETH transfer via delegated code |
| `test_InvalidateNonce`              | Nonce cancellation prevents future use |
| `test_ReplayProtection`             | Same nonce cannot be used twice        |

## Configuration

The project targets the **Prague EVM** version (required for EIP-7702 opcodes). See [`foundry.toml`](foundry.toml):

```toml
[profile.default]
evm_version = "prague"
```

## Dependencies

- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) — `ECDSA`, `EIP712`, `SafeERC20`
- [forge-std](https://github.com/foundry-rs/forge-std) — Foundry test framework

## License

MIT
