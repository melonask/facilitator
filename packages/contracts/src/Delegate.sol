// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignerEIP7702} from "@openzeppelin/contracts/utils/cryptography/signers/SignerEIP7702.sol";
import {ERC7739} from "@openzeppelin/contracts/utils/cryptography/signers/draft-ERC7739.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/**
 * @title EIP-7702 Delegate Account
 * @author Melon Ask
 * @notice A "Smart EOA" delegate implementation.
 * @dev This contract is designed to be set as the code for an EOA via EIP-7702.
 *      It inherits SignerEIP7702 to automatically provide ERC-1271 compatibility,
 *      allowing the EOA to sign messages for other DApps (e.g., OpenSea, Uniswap Permits).
 *
 *      Storage Layout: Uses ERC-7201 namespaced storage to prevent storage collisions
 *      if the user switches delegates or upgrades implementations.
 */
contract Delegate is EIP712, SignerEIP7702, ERC7739, ERC721Holder, ERC1155Holder {
    using SafeERC20 for IERC20;

    // =============================================================
    //                           CONSTANTS
    // =============================================================

    /// @dev Keccak256 hash of the PaymentIntent struct structure.
    bytes32 private constant PAYMENT_TYPEHASH =
        keccak256("PaymentIntent(address token,uint256 amount,address to,uint256 nonce,uint256 deadline)");

    /// @dev Keccak256 hash of the EthPaymentIntent struct structure.
    bytes32 private constant ETH_PAYMENT_TYPEHASH =
        keccak256("EthPaymentIntent(uint256 amount,address to,uint256 nonce,uint256 deadline)");

    /// @dev ERC-7201: keccak256(abi.encode(uint256(keccak256("com.facilitator.delegate.storage")) - 1)) & ~0xff
    bytes32 private constant DELEGATE_STORAGE_LOCATION =
        0xd0f2263d152f9b30dd64b4d5776066eeab75bd391d74f37c4437a35b6b29ce00;

    // =============================================================
    //                           STRUCTS
    // =============================================================

    /// @custom:storage-location erc7201:com.facilitator.delegate.storage
    struct DelegateStorage {
        mapping(uint256 nonce => bool) isUsed;
    }

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

    // =============================================================
    //                          CONSTRUCTOR
    // =============================================================

    constructor() EIP712("Delegate", "1.0") {}

    /// @notice Allows the EOA to receive native ETH (e.g., from CEXs or other users).
    receive() external payable {}

    // =============================================================
    //                       EXTERNAL FUNCTIONS
    // =============================================================

    /**
     * @notice Executes an ERC20 transfer based on a signed intent.
     * @param intent The transfer details (token, amount, destination, etc).
     * @param signature The EIP-712 signature from the EOA.
     */
    function transfer(PaymentIntent calldata intent, bytes calldata signature) external {
        _useNonce(intent.nonce);

        bytes32 structHash;
        bytes32 typeHash = PAYMENT_TYPEHASH;

        // Cache calldata values to stack to save gas during assembly access
        address token = intent.token;
        uint256 amount = intent.amount;
        address to = intent.to;
        uint256 nonce = intent.nonce;
        uint256 deadline = intent.deadline;

        // Efficient hashing using inline assembly (Matches "forge build" recommendations)
        // This avoids memory allocation overhead from abi.encode
        assembly {
            // Load free memory pointer
            let ptr := mload(0x40)

            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), and(token, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(ptr, 0x40), amount)
            mstore(add(ptr, 0x60), and(to, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(ptr, 0x80), nonce)
            mstore(add(ptr, 0xa0), deadline)

            // keccak256(ptr, 192 bytes) -> 6 words * 32 bytes = 192 (0xc0)
            structHash := keccak256(ptr, 0xc0)
        }

        _validateIntent(structHash, signature, deadline);

        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Executes a native ETH transfer based on a signed intent.
     * @param intent The transfer details (amount, destination, etc).
     * @param signature The EIP-712 signature from the EOA.
     */
    function transferEth(EthPaymentIntent calldata intent, bytes calldata signature) external {
        _useNonce(intent.nonce);

        bytes32 structHash;
        bytes32 typeHash = ETH_PAYMENT_TYPEHASH;

        // Cache values
        uint256 amount = intent.amount;
        address to = intent.to;
        uint256 nonce = intent.nonce;
        uint256 deadline = intent.deadline;

        // Efficient hashing using inline assembly
        assembly {
            let ptr := mload(0x40)

            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), amount)
            mstore(add(ptr, 0x40), and(to, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(ptr, 0x60), nonce)
            mstore(add(ptr, 0x80), deadline)

            // keccak256(ptr, 160 bytes) -> 5 words * 32 bytes = 160 (0xa0)
            structHash := keccak256(ptr, 0xa0)
        }

        _validateIntent(structHash, signature, deadline);

        (bool success,) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    /**
     * @notice Invalidates a nonce manually.
     * @dev Can only be called by the EOA itself (sender must be address(this)).
     * @param nonce The nonce to invalidate.
     */
    function invalidateNonce(uint256 nonce) external {
        require(msg.sender == address(this), "Only owner");
        _useNonce(nonce);
    }

    // =============================================================
    //                       INTERNAL HELPERS
    // =============================================================

    /**
     * @dev Validates the signature and deadline.
     * @param structHash The EIP-712 struct hash.
     * @param signature The raw signature bytes.
     * @param deadline The timestamp after which the intent is invalid.
     */
    function _validateIntent(bytes32 structHash, bytes calldata signature, uint256 deadline) internal view {
        require(block.timestamp <= deadline, "Expired");

        bytes32 digest = _hashTypedDataV4(structHash);

        // Uses SignerEIP7702 logic: verifies if 'digest' was signed by 'address(this)'.
        // In EIP-7702, address(this) IS the EOA.
        // This function handles ECDSA recovery securely.
        require(_rawSignatureValidation(digest, signature), "Invalid Intent Signature");
    }

    /**
     * @dev Retrieves the storage pointer using ERC-7201 namespacing.
     */
    function _getDelegateStorage() private pure returns (DelegateStorage storage $) {
        assembly {
            $.slot := DELEGATE_STORAGE_LOCATION
        }
    }

    /**
     * @dev Marks a nonce as used. Reverts if already used.
     *      Uses the Checks-Effects-Interactions pattern state check.
     */
    function _useNonce(uint256 nonce) internal {
        DelegateStorage storage $ = _getDelegateStorage();
        require(!$.isUsed[nonce], "Nonce already used");
        $.isUsed[nonce] = true;
    }
}
