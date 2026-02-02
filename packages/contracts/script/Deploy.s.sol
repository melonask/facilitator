// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Delegate} from "@facilitator/contracts/Delegate.sol";

/// @title Deterministic multi-chain deployer for Delegate
/// @dev Uses the Keyless CREATE2 Deployer (0x4e59b44847b379578588920cA78FbF26c0B4956C)
///      which is pre-deployed on all major EVM chains, to guarantee the same address everywhere.
///
/// Usage:
///   # Dry-run (simulation)
///   forge script script/Deploy.s.sol --rpc-url <RPC_URL>
///
///   # Broadcast to a single chain
///   forge script script/Deploy.s.sol --rpc-url <RPC_URL> --broadcast
///
///   # Deploy to multiple chains (same address guaranteed)
///   forge script script/Deploy.s.sol --rpc-url $BASE_RPC     --broadcast
///   forge script script/Deploy.s.sol --rpc-url $OPTIMISM_RPC  --broadcast
///   forge script script/Deploy.s.sol --rpc-url $ARBITRUM_RPC  --broadcast
///
/// Environment:
///   DEPLOYER_PRIVATE_KEY  - Private key of the account paying for gas
///   DEPLOY_SALT           - (Optional) 32-byte hex salt, defaults to zero
contract DeployDelegate is Script {
    function run() external {
        bytes32 salt = vm.envOr("DEPLOY_SALT", bytes32(0));
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        bytes memory initCode = type(Delegate).creationCode;
        address predicted = _computeAddress(salt, keccak256(initCode));

        console.log("Chain ID      :", block.chainid);
        console.log("Salt          :", vm.toString(salt));
        console.log("Predicted addr:", predicted);

        if (predicted.code.length > 0) {
            console.log("Already deployed, skipping.");
            return;
        }

        vm.startBroadcast(deployerKey);
        (bool success, bytes memory result) = CREATE2_FACTORY.call(abi.encodePacked(salt, initCode));
        vm.stopBroadcast();

        require(success && result.length == 32, "CREATE2 deployment failed");
        // casting to 'bytes32' is safe because result.length == 32 is checked above
        // forge-lint: disable-next-line(unsafe-typecast)
        address deployed = address(uint160(uint256(bytes32(result))));

        require(deployed == predicted, "Address mismatch");
        console.log("Deployed at   :", deployed);
    }

    function _computeAddress(bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_FACTORY, salt, initCodeHash)))));
    }
}
