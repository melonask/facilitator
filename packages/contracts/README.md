# @facilitator/contracts

EIP-7702 Delegate contract for [x402](https://github.com/coinbase/x402) gasless payment intents.

## Install

### Foundry

```
forge install melonask/facilitator
```

<table>
<tr><td>

Or add to your `remappings.txt`:

</td><td>

Or add to your `foundry.toml`:

</td></tr>
<tr><td>

```
@facilitator/=lib/facilitator/packages/
```

</td><td>

```
remappings=[
    "@facilitator/=lib/facilitator/packages/"
]
```

</td></tr>
</table>

## Usage

```solidity
import {Delegate} from "@facilitator/contracts/src/Delegate.sol";
```

## Overview

`Delegate` is an [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) delegate contract that enables gasless ERC-20 and ETH transfers via signed payment intents. A relayer submits the EIP-712 signed intent on behalf of the user.

### Structs

- **`PaymentIntent`** — ERC-20 transfer: `token`, `amount`, `to`, `nonce`, `deadline`
- **`EthPaymentIntent`** — Native ETH transfer: `amount`, `to`, `nonce`, `deadline`

### Functions

| Function                         | Description                                |
| -------------------------------- | ------------------------------------------ |
| `transfer(intent, signature)`    | Execute a signed ERC-20 payment intent     |
| `transferEth(intent, signature)` | Execute a signed native ETH payment intent |
| `invalidateNonce(nonce)`         | Cancel a pending intent (owner only)       |
| `isValidSignature(hash, sig)`    | ERC-1271 signature validation (ERC-7739)   |

### Security

- Each nonce can only be used once (replay protection)
- Intents expire after `deadline` (timestamp)
- Only the delegated account (`address(this)`) can sign valid intents
- ERC-1271 signatures validated via [ERC-7739](https://eips.ethereum.org/EIPS/eip-7739) nested typed data
- Uses OpenZeppelin's `ECDSA`, `EIP712`, `ERC7739`, `SignerEIP7702`, and `SafeERC20`

## Development

```bash
forge build
forge test -vv
```

## Deploy

The contract is deployed deterministically via CREATE2, guaranteeing the same address on every chain.

```bash
export DEPLOYER_PRIVATE_KEY=0x...
export DEPLOY_SALT=0x0000...  # optional, defaults to zero

forge script script/Deploy.s.sol --rpc-url <RPC_URL> --broadcast
```

## License

MIT
