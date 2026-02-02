# @facilitator/contracts

EIP-7702 Delegate contract for [x402](https://github.com/coinbase/x402) gasless payment intents. Enables any ERC-20 and native ETH transfers without the payer holding gas tokens.

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

### Structs

| Struct             | Fields                                       | Description                |
| ------------------ | -------------------------------------------- | -------------------------- |
| `PaymentIntent`    | `token`, `amount`, `to`, `nonce`, `deadline` | ERC-20 transfer intent     |
| `EthPaymentIntent` | `amount`, `to`, `nonce`, `deadline`          | Native ETH transfer intent |

### Functions

| Function                         | Description                                |
| -------------------------------- | ------------------------------------------ |
| `transfer(intent, signature)`    | Execute a signed ERC-20 payment intent     |
| `transferEth(intent, signature)` | Execute a signed native ETH payment intent |
| `invalidateNonce(nonce)`         | Cancel a pending intent (owner only)       |
| `isValidSignature(hash, sig)`    | ERC-1271 signature validation (ERC-7739)   |

### Security

- Each nonce can only be used once (replay protection)
- Intents expire after `deadline` (unix timestamp)
- Only the delegated account (`address(this)`) can sign valid intents
- ERC-1271 signatures validated via [ERC-7739](https://eips.ethereum.org/EIPS/eip-7739)
- [ERC-7201](https://eips.ethereum.org/EIPS/eip-7201) namespaced storage (no collisions)
- Uses OpenZeppelin's `ECDSA`, `EIP712`, `ERC7739`, `SignerEIP7702`, `SafeERC20`

## Development

```bash
forge build
forge test -vv
```

## Deploy

Deterministic deployment via CREATE2 (same address on every chain):

```bash
export DEPLOYER_PRIVATE_KEY=0x...
forge script script/Deploy.s.sol --rpc-url <RPC_URL> --broadcast
```

## License

MIT
