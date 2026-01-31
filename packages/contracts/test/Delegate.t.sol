// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Delegate} from "../src/Delegate.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract DelegateTest is Test {
    Delegate public delegate;
    MockERC20 public token;

    uint256 internal userPrivateKey;
    address internal user;

    bytes32 constant PAYMENT_TYPEHASH =
        keccak256("PaymentIntent(address token,uint256 amount,address to,uint256 nonce,uint256 deadline)");

    bytes32 constant ETH_PAYMENT_TYPEHASH =
        keccak256("EthPaymentIntent(uint256 amount,address to,uint256 nonce,uint256 deadline)");

    function setUp() public {
        delegate = new Delegate();
        token = new MockERC20();

        userPrivateKey = 0xA11CE;
        user = vm.addr(userPrivateKey);

        token.mint(user, 1000 ether);
    }

    function _signErc20Intent(Delegate.PaymentIntent memory intent) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(PAYMENT_TYPEHASH, intent.token, intent.amount, intent.to, intent.nonce, intent.deadline)
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Delegate")),
                keccak256(bytes("1.0")),
                block.chainid,
                user
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signEthIntent(Delegate.EthPaymentIntent memory intent) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(ETH_PAYMENT_TYPEHASH, intent.amount, intent.to, intent.nonce, intent.deadline));

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Delegate")),
                keccak256(bytes("1.0")),
                block.chainid,
                user
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_Eip7702_DelegatedTransfer() public {
        Delegate.PaymentIntent memory intent = Delegate.PaymentIntent({
            token: address(token), amount: 100 ether, to: address(0xB0B), nonce: 0, deadline: block.timestamp + 1 hours
        });

        bytes memory signature = _signErc20Intent(intent);

        assertEq(token.balanceOf(user), 1000 ether);
        assertEq(token.balanceOf(address(0xB0B)), 0);

        vm.etch(user, address(delegate).code);

        vm.prank(address(this));
        (bool success,) = user.call(abi.encodeWithSelector(Delegate.transfer.selector, intent, signature));
        require(success, "Call failed");

        assertEq(token.balanceOf(user), 900 ether);
        assertEq(token.balanceOf(address(0xB0B)), 100 ether);
    }

    function test_Eip7702_DelegatedETHTransfer() public {
        Delegate.EthPaymentIntent memory intent = Delegate.EthPaymentIntent({
            amount: 1 ether, to: address(0xB0B), nonce: 0, deadline: block.timestamp + 1 hours
        });

        bytes memory signature = _signEthIntent(intent);

        vm.deal(user, 10 ether);
        uint256 bobBefore = address(0xB0B).balance;

        vm.etch(user, address(delegate).code);

        vm.prank(address(this));
        (bool success,) = user.call(abi.encodeWithSelector(Delegate.transferEth.selector, intent, signature));
        require(success, "Call failed");

        assertEq(address(user).balance, 9 ether);
        assertEq(address(0xB0B).balance, bobBefore + 1 ether);
    }

    function test_InvalidateNonce() public {
        vm.etch(user, address(delegate).code);

        // Call invalidateNonce from the user address (owner)
        vm.prank(user);
        (bool success,) = user.call(abi.encodeWithSelector(Delegate.invalidateNonce.selector, uint256(5)));
        require(success, "invalidateNonce failed");

        // Now try to use nonce 5 in a transfer — should fail
        Delegate.PaymentIntent memory intent = Delegate.PaymentIntent({
            token: address(token), amount: 1 ether, to: address(0xB0B), nonce: 5, deadline: block.timestamp + 1 hours
        });

        bytes memory signature = _signErc20Intent(intent);

        vm.prank(address(this));
        (bool success2,) = user.call(abi.encodeWithSelector(Delegate.transfer.selector, intent, signature));
        assertFalse(success2, "Should have reverted due to used nonce");
    }

    function test_ReplayProtection() public {
        Delegate.PaymentIntent memory intent = Delegate.PaymentIntent({
            token: address(token), amount: 10 ether, to: address(0xB0B), nonce: 0, deadline: block.timestamp + 1 hours
        });

        bytes memory signature = _signErc20Intent(intent);

        vm.etch(user, address(delegate).code);

        // First call succeeds
        vm.prank(address(this));
        (bool success,) = user.call(abi.encodeWithSelector(Delegate.transfer.selector, intent, signature));
        require(success, "First call failed");

        // Second call with same nonce should fail
        vm.prank(address(this));
        (bool success2,) = user.call(abi.encodeWithSelector(Delegate.transfer.selector, intent, signature));
        assertFalse(success2, "Replay should have failed");
    }
}
