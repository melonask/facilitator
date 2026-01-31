// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Delegate is EIP712 {
    using SafeERC20 for IERC20;

    struct PaymentIntent {
        address token;
        uint256 amount;
        address to;
        uint256 nonce;
        uint256 deadline;
    }

    struct EthPaymentIntent {
        uint256 amount;
        address to;
        uint256 nonce;
        uint256 deadline;
    }

    // keccak256("PaymentIntent(address token,uint256 amount,address to,uint256 nonce,uint256 deadline)");
    bytes32 constant PAYMENT_TYPEHASH =
        keccak256("PaymentIntent(address token,uint256 amount,address to,uint256 nonce,uint256 deadline)");

    // keccak256("EthPaymentIntent(uint256 amount,address to,uint256 nonce,uint256 deadline)");
    bytes32 constant ETH_PAYMENT_TYPEHASH =
        keccak256("EthPaymentIntent(uint256 amount,address to,uint256 nonce,uint256 deadline)");

    // keccak256("com.facilitator.delegate.nonces") - 1
    bytes32 private constant NONCE_STORAGE_SLOT = 0x27f372a79847a7b78b0d20e519aa47d449ec715dc685ecfb25a9fe69e28ff953;

    constructor() EIP712("Delegate", "1.0") {}

    receive() external payable {}

    function transfer(PaymentIntent calldata intent, bytes calldata signature) external {
        _useNonce(intent.nonce);

        bytes32 structHash;
        bytes32 typeHash = PAYMENT_TYPEHASH;
        address token = intent.token;
        uint256 amount = intent.amount;
        address to = intent.to;
        uint256 nonce = intent.nonce;
        uint256 deadline = intent.deadline;

        assembly {
            let ptr := mload(0x40)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), token)
            mstore(add(ptr, 0x40), amount)
            mstore(add(ptr, 0x60), to)
            mstore(add(ptr, 0x80), nonce)
            mstore(add(ptr, 0xa0), deadline)
            structHash := keccak256(ptr, 0xc0)
        }

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);

        require(signer == address(this), "Invalid Intent Signature");
        require(block.timestamp <= intent.deadline, "Expired");

        IERC20(intent.token).safeTransfer(intent.to, intent.amount);
    }

    function transferEth(EthPaymentIntent calldata intent, bytes calldata signature) external {
        _useNonce(intent.nonce);

        bytes32 structHash;
        bytes32 typeHash = ETH_PAYMENT_TYPEHASH;
        uint256 amount = intent.amount;
        address to = intent.to;
        uint256 nonce = intent.nonce;
        uint256 deadline = intent.deadline;

        assembly {
            let ptr := mload(0x40)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), amount)
            mstore(add(ptr, 0x40), to)
            mstore(add(ptr, 0x60), nonce)
            mstore(add(ptr, 0x80), deadline)
            structHash := keccak256(ptr, 0xa0)
        }

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);

        require(signer == address(this), "Invalid Intent Signature");
        require(block.timestamp <= intent.deadline, "Expired");

        (bool success,) = intent.to.call{value: intent.amount}("");
        require(success, "ETH transfer failed");
    }

    function invalidateNonce(uint256 nonce) external {
        require(msg.sender == address(this), "Only owner");
        _useNonce(nonce);
    }

    function _useNonce(uint256 nonce) internal {
        bytes32 slot = NONCE_STORAGE_SLOT;
        bool isUsed;

        assembly {
            mstore(0, nonce)
            mstore(32, slot)
            let finalSlot := keccak256(0, 64)
            isUsed := sload(finalSlot)
            if iszero(isUsed) {
                sstore(finalSlot, 1)
            }
        }

        require(!isUsed, "Nonce already used");
    }
}
