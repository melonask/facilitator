// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {Delegate} from "@facilitator/contracts/Delegate.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @dev Helper contract that rejects ETH transfers to test failure scenarios
contract Rejector {
    receive() external payable {
        revert("I hate money");
    }
}

contract DelegateTest is Test {
    Delegate public delegate;
    ERC20Mock public token;

    uint256 internal userPrivateKey;
    address internal user;

    uint256 internal attackerPrivateKey;
    address internal attacker;

    bytes32 constant PAYMENT_TYPEHASH =
        keccak256("PaymentIntent(address token,uint256 amount,address to,uint256 nonce,uint256 deadline)");

    bytes32 constant ETH_PAYMENT_TYPEHASH =
        keccak256("EthPaymentIntent(uint256 amount,address to,uint256 nonce,uint256 deadline)");

    // Domain separator components
    bytes32 constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 constant NAME_HASH = keccak256("Delegate");
    bytes32 constant VERSION_HASH = keccak256("1.0");

    function setUp() public {
        delegate = new Delegate();
        token = new ERC20Mock();

        userPrivateKey = 0xA11CE;
        user = vm.addr(userPrivateKey);

        attackerPrivateKey = 0xBAD;
        attacker = vm.addr(attackerPrivateKey);

        // Fund user
        token.mint(user, 10000 ether);
        vm.deal(user, 100 ether);

        // "Install" the code on the user (Simulate EIP-7702)
        vm.etch(user, address(delegate).code);
    }

    // =============================================================
    //                        HELPERS
    // =============================================================

    function _getDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                block.chainid,
                user // IMPORTANT: In EIP-7702, the verifying contract is the User's address
            )
        );
    }

    function _signErc20Intent(Delegate.PaymentIntent memory intent, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(PAYMENT_TYPEHASH, intent.token, intent.amount, intent.to, intent.nonce, intent.deadline)
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(_getDomainSeparator(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signEthIntent(Delegate.EthPaymentIntent memory intent, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(ETH_PAYMENT_TYPEHASH, intent.amount, intent.to, intent.nonce, intent.deadline));
        bytes32 digest = MessageHashUtils.toTypedDataHash(_getDomainSeparator(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // =============================================================
    //                    ERC20 TRANSFER TESTS
    // =============================================================

    function test_Transfer_Success() public {
        Delegate.PaymentIntent memory intent = Delegate.PaymentIntent({
            token: address(token), amount: 100 ether, to: address(0xB0B), nonce: 1, deadline: block.timestamp + 1 hours
        });
        bytes memory signature = _signErc20Intent(intent, userPrivateKey);

        vm.prank(address(this)); // Relayer can call this

        // High-level call: Cast 'user' to Delegate interface
        Delegate(payable(user)).transfer(intent, signature);

        assertEq(token.balanceOf(address(0xB0B)), 100 ether);
    }

    function test_Transfer_Revert_Expired() public {
        Delegate.PaymentIntent memory intent = Delegate.PaymentIntent({
            token: address(token),
            amount: 100 ether,
            to: address(0xB0B),
            nonce: 1,
            deadline: block.timestamp - 1 // Expired
        });
        bytes memory signature = _signErc20Intent(intent, userPrivateKey);

        vm.expectRevert("Expired");
        Delegate(payable(user)).transfer(intent, signature);
    }

    function test_Transfer_Revert_InvalidSignature_WrongSigner() public {
        Delegate.PaymentIntent memory intent = Delegate.PaymentIntent({
            token: address(token), amount: 100 ether, to: address(0xB0B), nonce: 1, deadline: block.timestamp + 1 hours
        });
        // Signed by attacker, not user
        bytes memory signature = _signErc20Intent(intent, attackerPrivateKey);

        vm.expectRevert("Invalid Intent Signature");
        Delegate(payable(user)).transfer(intent, signature);
    }

    function test_Transfer_Revert_InvalidSignature_TamperedData() public {
        Delegate.PaymentIntent memory intent = Delegate.PaymentIntent({
            token: address(token), amount: 100 ether, to: address(0xB0B), nonce: 1, deadline: block.timestamp + 1 hours
        });
        bytes memory signature = _signErc20Intent(intent, userPrivateKey);

        // Tamper with the intent amount after signing
        intent.amount = 200 ether;

        vm.expectRevert("Invalid Intent Signature");
        Delegate(payable(user)).transfer(intent, signature);
    }

    function test_Transfer_Revert_NonceUsed() public {
        Delegate.PaymentIntent memory intent = Delegate.PaymentIntent({
            token: address(token), amount: 100 ether, to: address(0xB0B), nonce: 1, deadline: block.timestamp + 1 hours
        });
        bytes memory signature = _signErc20Intent(intent, userPrivateKey);

        // 1. First call succeeds
        Delegate(payable(user)).transfer(intent, signature);

        // 2. Second call fails
        vm.expectRevert("Nonce already used");
        Delegate(payable(user)).transfer(intent, signature);
    }

    // =============================================================
    //                    ETH TRANSFER TESTS
    // =============================================================

    function test_TransferEth_Success() public {
        Delegate.EthPaymentIntent memory intent = Delegate.EthPaymentIntent({
            amount: 1 ether, to: address(0xB0B), nonce: 2, deadline: block.timestamp + 1 hours
        });
        bytes memory signature = _signEthIntent(intent, userPrivateKey);

        uint256 bobBal = address(0xB0B).balance;

        Delegate(payable(user)).transferEth(intent, signature);

        assertEq(address(0xB0B).balance, bobBal + 1 ether);
    }

    function test_TransferEth_Revert_CallFailed() public {
        Rejector rejector = new Rejector();

        Delegate.EthPaymentIntent memory intent = Delegate.EthPaymentIntent({
            amount: 1 ether, to: address(rejector), nonce: 2, deadline: block.timestamp + 1 hours
        });
        bytes memory signature = _signEthIntent(intent, userPrivateKey);

        // Should fail because Rejector contract reverts on receive
        vm.expectRevert("ETH transfer failed");
        Delegate(payable(user)).transferEth(intent, signature);
    }

    function test_TransferEth_Revert_Expired() public {
        Delegate.EthPaymentIntent memory intent =
            Delegate.EthPaymentIntent({amount: 1 ether, to: address(0xB0B), nonce: 2, deadline: block.timestamp - 1});
        bytes memory signature = _signEthIntent(intent, userPrivateKey);

        vm.expectRevert("Expired");
        Delegate(payable(user)).transferEth(intent, signature);
    }

    // =============================================================
    //                  INVALIDATE NONCE TESTS
    // =============================================================

    function test_InvalidateNonce_Success() public {
        // User calls their own code (Acting as "Entrypoint")
        vm.prank(user);
        Delegate(payable(user)).invalidateNonce(5);

        // Try to use nonce 5
        Delegate.EthPaymentIntent memory intent = Delegate.EthPaymentIntent({
            amount: 1 ether, to: address(0xB0B), nonce: 5, deadline: block.timestamp + 1 hours
        });
        bytes memory signature = _signEthIntent(intent, userPrivateKey);

        vm.expectRevert("Nonce already used");
        Delegate(payable(user)).transferEth(intent, signature);
    }

    function test_InvalidateNonce_Revert_OnlyOwner() public {
        // Attacker tries to invalidate User's nonce
        vm.prank(attacker);

        vm.expectRevert("Only owner");
        Delegate(payable(user)).invalidateNonce(10);
    }

    function test_InvalidateNonce_Revert_AlreadyUsed() public {
        vm.prank(user);
        Delegate(payable(user)).invalidateNonce(5);

        vm.prank(user);
        vm.expectRevert("Nonce already used");
        Delegate(payable(user)).invalidateNonce(5);
    }

    // =============================================================
    //                   MISCELLANEOUS & FUZZ
    // =============================================================

    function test_Receive_Eth() public {
        // Cover receive() external payable
        uint256 balBefore = user.balance;

        (bool success,) = user.call{value: 1 ether}("");

        assertTrue(success, "Receive failed");
        assertEq(user.balance, balBefore + 1 ether);
    }

    function testFuzz_Transfer_Erc20(uint256 amount, uint256 nonce) public {
        amount = bound(amount, 1, 1000 ether);
        nonce = bound(nonce, 100, 999999);

        Delegate.PaymentIntent memory intent = Delegate.PaymentIntent({
            token: address(token), amount: amount, to: address(0xB0B), nonce: nonce, deadline: block.timestamp + 1 hours
        });
        bytes memory signature = _signErc20Intent(intent, userPrivateKey);

        Delegate(payable(user)).transfer(intent, signature);

        assertEq(token.balanceOf(address(0xB0B)), amount);
    }

    // ERC-1271 Test: The EOA should be able to validate its own signatures
    function test_IsValidSignature() public view {
        // 1. Create a random hash to sign
        bytes32 hash = keccak256("Some arbitrary message");

        // 2. ERC-7739 wraps the hash in a PersonalSign EIP-712 struct
        bytes32 personalSignTypehash = keccak256("PersonalSign(bytes prefixed)");
        bytes32 structHash = keccak256(abi.encode(personalSignTypehash, hash));
        bytes32 digest = MessageHashUtils.toTypedDataHash(_getDomainSeparator(), structHash);

        // 3. Sign the wrapped digest with the User's key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // 4. Call isValidSignature on the EOA (which has the Delegate code)
        bytes4 result = IERC1271(user).isValidSignature(hash, signature);

        assertEq(result, IERC1271.isValidSignature.selector, "Signature should be valid");
    }
}
