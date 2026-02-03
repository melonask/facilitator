// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployDelegate} from "../script/Deploy.s.sol";
import {Delegate} from "@facilitator/contracts/Delegate.sol";

/// @dev Mock CREATE2 factory for testing
contract MockCreate2Factory {
    fallback() external payable {
        // First 32 bytes = salt, rest = initCode
        bytes32 salt;
        assembly {
            salt := calldataload(0)
        }
        bytes memory initCode = msg.data[32:];

        address deployed;
        assembly {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }

        // Return the 32-byte address (matching real factory behavior)
        assembly {
            mstore(0, deployed)
            return(0, 32)
        }
    }
}

/// @dev Factory that always reverts
contract RevertingFactory {
    fallback() external payable {
        revert();
    }
}

/// @dev Factory that succeeds but doesn't deploy anything (returns address(0))
contract NoOpFactory {
    fallback() external payable {
        // Return success but with zero address (simulates failed CREATE2)
        assembly {
            mstore(0, 0)
            return(0, 32)
        }
    }
}

contract DeployTest is Test {
    DeployDelegate deployer;

    // Anvil account #0
    uint256 constant DEPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant DEPLOYER_ADDR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    function setUp() public {
        deployer = new DeployDelegate();
        vm.deal(DEPLOYER_ADDR, 100 ether);
    }

    function test_Deploy_Success() public {
        _etchCreate2Factory();
        bytes32 salt = bytes32(uint256(100));
        deployer.deploy(salt, DEPLOYER_KEY);

        address predicted = _predictAddress(salt);
        assertTrue(predicted.code.length > 0);
    }

    function test_Deploy_SkipsIfAlreadyDeployed() public {
        _etchCreate2Factory();
        bytes32 salt = bytes32(uint256(200));
        deployer.deploy(salt, DEPLOYER_KEY);
        // Second call should skip (already deployed) without reverting
        deployer.deploy(salt, DEPLOYER_KEY);
    }

    function test_Deploy_CustomSalt() public {
        _etchCreate2Factory();
        bytes32 salt = bytes32(uint256(300));
        deployer.deploy(salt, DEPLOYER_KEY);

        address predicted = _predictAddress(salt);
        assertTrue(predicted.code.length > 0);
    }

    function test_Deploy_Revert_FactoryFails() public {
        // Etch reverting factory
        RevertingFactory rev = new RevertingFactory();
        vm.etch(CREATE2_FACTORY, address(rev).code);

        vm.expectRevert("CREATE2 call failed");
        deployer.deploy(bytes32(uint256(400)), DEPLOYER_KEY);
    }

    function test_Deploy_Revert_DeploymentFailed() public {
        // Etch a factory that returns success but doesn't actually deploy code
        NoOpFactory noop = new NoOpFactory();
        vm.etch(CREATE2_FACTORY, address(noop).code);

        vm.expectRevert("CREATE2 deployment failed");
        deployer.deploy(bytes32(uint256(500)), DEPLOYER_KEY);
    }

    // ── helpers ──

    function _predictAddress(bytes32 salt) internal pure returns (address) {
        bytes32 initCodeHash = keccak256(type(Delegate).creationCode);
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_FACTORY, salt, initCodeHash)))));
    }

    function _etchCreate2Factory() internal {
        MockCreate2Factory factory = new MockCreate2Factory();
        vm.etch(CREATE2_FACTORY, address(factory).code);
    }
}
