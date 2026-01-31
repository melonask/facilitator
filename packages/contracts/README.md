# @facilitator/contracts

Solidity smart contracts for the x402 EIP-7702 payment facilitator.

## Contracts

### Delegate.sol

The logic contract that EOAs delegate to via EIP-7702. It handles:

- **ERC-20 transfers** (`transfer`) with EIP-712 signed `PaymentIntent`
- **Native ETH transfers** (`transferEth`) with EIP-712 signed `EthPaymentIntent`
- **Nonce invalidation** (`invalidateNonce`) for cancelling pending intents
- **Replay protection** via per-nonce storage slots

Uses OpenZeppelin's `SafeERC20` for non-standard token compatibility (USDT, etc.) and `ECDSA`/`EIP712` for signature verification.

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

The Foundry project targets the `prague` EVM version (required for EIP-7702 opcodes). See `foundry.toml` for full config.

## License

MIT
