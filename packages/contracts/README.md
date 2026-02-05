# @facilitator/contracts

EIP-7702 Delegate contract for [x402](https://github.com/coinbase/x402) gasless payment intents. Enables any ERC-20 and native ETH transfers without the payer holding gas tokens.

### Deployed Addresses

| Network          | Address                                      |
| ---------------- | -------------------------------------------- |
| Ethereum Mainnet | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Polygon          | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Base             | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Optimism         | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Arbitrum         | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| BNB Chain        | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Avalanche        | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |

## Install

```bash
forge install melonask/facilitator
```

Add to `remappings.txt`:

```
@facilitator/=lib/facilitator/packages/
```

## Usage

```solidity
import {Delegate} from "@facilitator/contracts/src/Delegate.sol";
```

## Overview

`Delegate` is an [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) delegate contract. A relayer submits a Type 4 transaction that sets the Delegate as the EOA's code, then calls `transfer()` or `transferEth()` with the user's EIP-712 signed intent.

```
User signs:                  Relayer submits:
  EIP-712 PaymentIntent        Type 4 tx (EIP-7702)
  EIP-7702 Authorization       authorizationList: [user's auth]
                                to: user's EOA
                                data: Delegate.transfer(intent, sig)
                                        |
                                        v
                                SafeERC20.safeTransfer(token, to, amount)
```

## API Reference

### Structs

| Struct             | Fields                                       | Description                |
| ------------------ | -------------------------------------------- | -------------------------- |
| `PaymentIntent`    | `token`, `amount`, `to`, `nonce`, `deadline` | ERC-20 transfer intent     |
| `EthPaymentIntent` | `amount`, `to`, `nonce`, `deadline`          | Native ETH transfer intent |

### Functions

| Function                         | Access   | Description                                |
| -------------------------------- | -------- | ------------------------------------------ |
| `transfer(intent, signature)`    | External | Execute a signed ERC-20 payment intent     |
| `transferEth(intent, signature)` | External | Execute a signed native ETH payment intent |
| `invalidateNonce(nonce)`         | Owner    | Cancel a pending intent (owner only)       |
| `isValidSignature(hash, sig)`    | View     | ERC-1271 signature validation (ERC-7739)   |

### Events

| Event                | Parameters                       | Description                                |
| -------------------- | -------------------------------- | ------------------------------------------ |
| `PaymentExecuted`    | `token`, `to`, `amount`, `nonce` | Emitted on successful ERC20 transfer       |
| `EthPaymentExecuted` | `to`, `amount`, `nonce`          | Emitted on successful ETH transfer         |
| `NonceInvalidated`   | `nonce`                          | Emitted when nonce is manually invalidated |

### Custom Errors

| Error               | Condition                                |
| ------------------- | ---------------------------------------- |
| `Expired`           | `block.timestamp > intent.deadline`      |
| `NonceAlreadyUsed`  | Nonce was previously used or invalidated |
| `InvalidSignature`  | Signature invalid or signer != EOA owner |
| `EthTransferFailed` | ETH transfer to recipient reverted       |
| `OnlyOwner`         | `msg.sender != address(this)`            |
| `ZeroAddress`       | `intent.to == address(0)`                |

## EIP-712 Integration

For frontend/backend integrations, use the following EIP-712 domain and type definitions:

### Domain

```typescript
const domain = {
  name: "Delegate",
  version: "1.0",
  chainId: chainId,
  verifyingContract: userEOAAddress, // The EOA with delegated code
};
```

### Types

```typescript
// For ERC-20 transfers
const PaymentIntent = {
  PaymentIntent: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "to", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

// For native ETH transfers
const EthPaymentIntent = {
  EthPaymentIntent: [
    { name: "amount", type: "uint256" },
    { name: "to", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};
```

### Signing Example (ethers.js v6)

```typescript
const intent = {
  token: "0x...", // ERC-20 token address
  amount: parseUnits("100", 18),
  to: "0x...", // Recipient
  nonce: 1n, // Any unique uint256
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour
};

const signature = await signer.signTypedData(domain, PaymentIntent, intent);
```

## Security

| Feature                 | Implementation                                                         |
| ----------------------- | ---------------------------------------------------------------------- |
| Replay Protection       | Single-use nonces per intent                                           |
| Intent Expiration       | Unix timestamp deadline validation                                     |
| Signature Validation    | EIP-712 typed data + ECDSA recovery via SignerEIP7702                  |
| ERC-1271 Support        | [ERC-7739](https://eips.ethereum.org/EIPS/eip-7739) compliant          |
| Storage Isolation       | [ERC-7201](https://eips.ethereum.org/EIPS/eip-7201) namespaced storage |
| Zero-Address Protection | Explicit validation prevents accidental fund loss                      |
| Safe Token Transfers    | OpenZeppelin SafeERC20 for ERC-20 compatibility                        |
| CEI Pattern             | State changes before external calls                                    |

### Dependencies

- OpenZeppelin Contracts: `ECDSA`, `EIP712`, `ERC7739`, `SignerEIP7702`, `SafeERC20`, `ERC721Holder`, `ERC1155Holder`

## Gas Optimization

The contract is optimized for minimal gas consumption:

- **Custom errors** instead of string reverts (~200-500 gas saved per revert)
- **Inline assembly** for EIP-712 struct hashing (avoids `abi.encode` overhead)
- **Calldata caching** to stack variables before assembly access
- **Optimizer enabled** with `via_ir = true` and `optimizer_runs = 1` for deployment size

## Development

```bash
# Build
forge build

# Run tests
forge test -vvv

# Run tests with gas report
forge test --gas-report

# Check coverage
forge coverage
```

### Test Coverage

```
| File             | Lines      | Statements | Branches  | Functions |
|------------------|------------|------------|-----------|-----------|
| src/Delegate.sol | 100.00%    | 100.00%    | 100.00%   | 100.00%   |
```

## Deploy

Deterministic deployment via CREATE2 (same address on every chain):

```bash
export DEPLOYER_PRIVATE_KEY=0x...
forge script script/Deploy.s.sol --rpc-url <RPC_URL> --broadcast
```

## Audits

> **Note**: This contract has not been audited. Use at your own risk.

## License

MIT
