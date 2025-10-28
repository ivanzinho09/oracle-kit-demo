// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {SimpleMarket} from "../src/SimpleMarket.sol";

/// @notice Deploys a new SimpleMarket with the configured ERC20 payment token.
contract DeploySimpleMarket is Script {
    function run() external returns (SimpleMarket market) {
        address token = vm.envAddress("PAYMENT_TOKEN");
        uint256 pk = vm.envUint("PRIVATE_KEY"); // deployer EOA

        vm.startBroadcast(pk);
        market = new SimpleMarket(token);
        vm.stopBroadcast();

        console2.log("SimpleMarket deployed at:", address(market));
        console2.log("Payment token:", token);
    }
}