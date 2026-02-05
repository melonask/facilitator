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
 * @notice A "Smart EOA" delegate implementation that enables gasless ERC20 and ETH transfers
 *         via signed payment intents.
 * @dev This contract is designed to be set as the code for an EOA via EIP-7702.
 *
 *      Key Features:
 *      - ERC-1271 compatibility via SignerEIP7702 for DApp message signing (OpenSea, Uniswap Permits)
 *      - ERC-7739 support for secure typed data signing
 *      - ERC721/ERC1155 token receiving capabilities
 *      - Replay protection via unique nonces
 *      - Deadline-based intent expiration
 *
 *      Storage Layout:
 *      Uses ERC-7201 namespaced storage at slot `keccak256("com.facilitator.delegate.storage")`
 *      to prevent storage collisions when switching delegates or upgrading implementations.
 *
 *      Security Considerations:
 *      - All transfers require valid EIP-712 signatures from the EOA owner
 *      - Nonces are single-use and can be preemptively invalidated
 *      - Zero-address transfers are explicitly blocked
 */
contract Delegate is EIP712, SignerEIP7702, ERC7739, ERC721Holder, ERC1155Holder {
    using SafeERC20 for IERC20;

    // =============================================================
    //                        CUSTOM ERRORS
    // =============================================================

    /// @notice The payment intent has expired.
    /// @dev Thrown when `block.timestamp > intent.deadline`.
    error Expired();

    /// @notice The nonce has already been consumed.
    /// @dev Thrown when attempting to use a nonce that was previously used in a transfer
    ///      or manually invalidated via `invalidateNonce`.
    error NonceAlreadyUsed();

    /// @notice The provided signature is invalid.
    /// @dev Thrown when ECDSA recovery fails or the recovered signer does not match `address(this)`.
    error InvalidSignature();

    /// @notice The ETH transfer to the recipient failed.
    /// @dev Thrown when the low-level `call` to transfer ETH returns `false`.
    ///      This can occur if the recipient is a contract that reverts on receive.
    error EthTransferFailed();

    /// @notice The caller is not authorized to perform this action.
    /// @dev Thrown when `msg.sender != address(this)`. In EIP-7702 context,
    ///      only the EOA itself can call restricted functions.
    error OnlyOwner();

    /// @notice The recipient address cannot be the zero address.
    /// @dev Thrown when `intent.to == address(0)` to prevent accidental fund loss.
    error ZeroAddress();

    // =============================================================
    //                           EVENTS
    // =============================================================

    /// @notice Emitted when an ERC20 payment intent is successfully executed.
    /// @param token The ERC20 token contract address that was transferred.
    /// @param to The recipient address that received the tokens.
    /// @param amount The number of tokens transferred (in wei).
    /// @param nonce The unique nonce used for this payment intent.
    event PaymentExecuted(address indexed token, address indexed to, uint256 amount, uint256 indexed nonce);

    /// @notice Emitted when a native ETH payment intent is successfully executed.
    /// @param to The recipient address that received the ETH.
    /// @param amount The amount of ETH transferred (in wei).
    /// @param nonce The unique nonce used for this payment intent.
    event EthPaymentExecuted(address indexed to, uint256 amount, uint256 indexed nonce);

    /// @notice Emitted when a nonce is manually invalidated by the owner.
    /// @dev This allows the EOA owner to cancel pending signed intents.
    /// @param nonce The nonce that was invalidated.
    event NonceInvalidated(uint256 indexed nonce);

    // =============================================================
    //                           CONSTANTS
    // =============================================================

    /// @dev EIP-712 typehash for PaymentIntent struct.
    ///      Used to create the struct hash for ERC20 transfer signature verification.
    bytes32 private constant PAYMENT_TYPEHASH =
        keccak256("PaymentIntent(address token,uint256 amount,address to,uint256 nonce,uint256 deadline)");

    /// @dev EIP-712 typehash for EthPaymentIntent struct.
    ///      Used to create the struct hash for ETH transfer signature verification.
    bytes32 private constant ETH_PAYMENT_TYPEHASH =
        keccak256("EthPaymentIntent(uint256 amount,address to,uint256 nonce,uint256 deadline)");

    /// @dev ERC-7201 storage slot for DelegateStorage.
    ///      Computed as: keccak256(abi.encode(uint256(keccak256("com.facilitator.delegate.storage")) - 1)) & ~0xff
    ///      This ensures storage isolation from other potential delegate implementations.
    bytes32 private constant DELEGATE_STORAGE_LOCATION =
        0xd0f2263d152f9b30dd64b4d5776066eeab75bd391d74f37c4437a35b6b29ce00;

    // =============================================================
    //                           STRUCTS
    // =============================================================

    /// @notice Storage struct for delegate state using ERC-7201 namespacing.
    /// @custom:storage-location erc7201:com.facilitator.delegate.storage
    /// @dev Isolated storage prevents collisions when EOA switches delegate implementations.
    struct DelegateStorage {
        /// @dev Mapping of nonce => whether it has been used.
        mapping(uint256 nonce => bool) isUsed;
    }

    /// @notice Represents a signed intent to transfer ERC20 tokens.
    /// @dev Used as the EIP-712 typed data structure for `transfer` function.
    /// @param token The ERC20 token contract address to transfer.
    /// @param amount The number of tokens to transfer (in wei).
    /// @param to The recipient address.
    /// @param nonce A unique value to prevent replay attacks (can be any unused uint256).
    /// @param deadline Unix timestamp after which this intent is no longer valid.
    struct PaymentIntent {
        address token;
        uint256 amount;
        address to;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice Represents a signed intent to transfer native ETH.
    /// @dev Used as the EIP-712 typed data structure for `transferEth` function.
    /// @param amount The amount of ETH to transfer (in wei).
    /// @param to The recipient address.
    /// @param nonce A unique value to prevent replay attacks (can be any unused uint256).
    /// @param deadline Unix timestamp after which this intent is no longer valid.
    struct EthPaymentIntent {
        uint256 amount;
        address to;
        uint256 nonce;
        uint256 deadline;
    }

    // =============================================================
    //                          CONSTRUCTOR
    // =============================================================

    /// @notice Initializes the EIP-712 domain separator.
    /// @dev Domain name is "Delegate" and version is "1.0".
    ///      The domain separator includes chainId and verifyingContract (the EOA address).
    constructor() EIP712("Delegate", "1.0") {}

    /// @notice Allows the EOA to receive native ETH transfers.
    /// @dev Required for receiving ETH from exchanges, other users, or contract interactions.
    receive() external payable {}

    // =============================================================
    //                       EXTERNAL FUNCTIONS
    // =============================================================

    /// @notice Executes an ERC20 token transfer based on a signed payment intent.
    /// @dev Anyone can call this function (e.g., a relayer), but only valid signatures
    ///      from the EOA owner will be accepted. The nonce is consumed before validation
    ///      to follow the Checks-Effects-Interactions pattern.
    /// @param intent The payment intent containing token, amount, recipient, nonce, and deadline.
    /// @param signature The EIP-712 signature from the EOA owner authorizing this transfer.
    /// @custom:throws ZeroAddress If `intent.to` is the zero address.
    /// @custom:throws NonceAlreadyUsed If `intent.nonce` has been previously used.
    /// @custom:throws Expired If `block.timestamp > intent.deadline`.
    /// @custom:throws InvalidSignature If the signature is invalid or not from the EOA owner.
    function transfer(PaymentIntent calldata intent, bytes calldata signature) external {
        address to = intent.to;
        if (to == address(0)) revert ZeroAddress();

        uint256 nonce = intent.nonce;
        _useNonce(nonce);

        bytes32 structHash;
        bytes32 typeHash = PAYMENT_TYPEHASH;

        // Cache calldata values to stack to save gas during assembly access
        address token = intent.token;
        uint256 amount = intent.amount;
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

        emit PaymentExecuted(token, to, amount, nonce);
    }

    /// @notice Executes a native ETH transfer based on a signed payment intent.
    /// @dev Anyone can call this function (e.g., a relayer), but only valid signatures
    ///      from the EOA owner will be accepted. Uses low-level `call` for ETH transfer
    ///      to support contracts with custom receive logic.
    /// @param intent The payment intent containing amount, recipient, nonce, and deadline.
    /// @param signature The EIP-712 signature from the EOA owner authorizing this transfer.
    /// @custom:throws ZeroAddress If `intent.to` is the zero address.
    /// @custom:throws NonceAlreadyUsed If `intent.nonce` has been previously used.
    /// @custom:throws Expired If `block.timestamp > intent.deadline`.
    /// @custom:throws InvalidSignature If the signature is invalid or not from the EOA owner.
    /// @custom:throws EthTransferFailed If the ETH transfer to the recipient fails.
    function transferEth(EthPaymentIntent calldata intent, bytes calldata signature) external {
        address to = intent.to;
        if (to == address(0)) revert ZeroAddress();

        uint256 nonce = intent.nonce;
        _useNonce(nonce);

        bytes32 structHash;
        bytes32 typeHash = ETH_PAYMENT_TYPEHASH;

        // Cache values
        uint256 amount = intent.amount;
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
        if (!success) revert EthTransferFailed();

        emit EthPaymentExecuted(to, amount, nonce);
    }

    /// @notice Invalidates a nonce to prevent a signed intent from being executed.
    /// @dev Can only be called by the EOA itself (`msg.sender == address(this)`).
    ///      This is useful for canceling previously signed intents that haven't been
    ///      executed yet. In EIP-7702 context, the EOA calls this as a regular transaction.
    /// @param nonce The nonce to invalidate. Must not have been used previously.
    /// @custom:throws OnlyOwner If `msg.sender` is not the EOA (address(this)).
    /// @custom:throws NonceAlreadyUsed If the nonce has already been used or invalidated.
    function invalidateNonce(uint256 nonce) external {
        if (msg.sender != address(this)) revert OnlyOwner();
        _useNonce(nonce);
        emit NonceInvalidated(nonce);
    }

    // =============================================================
    //                       INTERNAL HELPERS
    // =============================================================

    /// @dev Validates the EIP-712 signature and checks the deadline.
    /// @param structHash The keccak256 hash of the encoded struct (PaymentIntent or EthPaymentIntent).
    /// @param signature The raw ECDSA signature bytes (r, s, v concatenated, 65 bytes).
    /// @param deadline The Unix timestamp after which the intent should be rejected.
    /// @custom:throws Expired If `block.timestamp > deadline`.
    /// @custom:throws InvalidSignature If signature recovery fails or signer != address(this).
    function _validateIntent(bytes32 structHash, bytes calldata signature, uint256 deadline) internal view {
        if (block.timestamp > deadline) revert Expired();

        bytes32 digest = _hashTypedDataV4(structHash);

        // Uses SignerEIP7702 logic: verifies if 'digest' was signed by 'address(this)'.
        // In EIP-7702, address(this) IS the EOA.
        // This function handles ECDSA recovery securely.
        if (!_rawSignatureValidation(digest, signature)) revert InvalidSignature();
    }

    /// @dev Retrieves the namespaced storage pointer using ERC-7201.
    /// @return $ The storage pointer to DelegateStorage struct at the designated slot.
    function _getDelegateStorage() private pure returns (DelegateStorage storage $) {
        assembly {
            $.slot := DELEGATE_STORAGE_LOCATION
        }
    }

    /// @dev Marks a nonce as used, preventing replay attacks.
    /// @param nonce The nonce to consume.
    /// @custom:throws NonceAlreadyUsed If the nonce has already been consumed.
    function _useNonce(uint256 nonce) internal {
        DelegateStorage storage $ = _getDelegateStorage();
        if ($.isUsed[nonce]) revert NonceAlreadyUsed();
        $.isUsed[nonce] = true;
    }
}
