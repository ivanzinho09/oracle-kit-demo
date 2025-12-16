// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SimpleMarket} from "../src/SimpleMarket.sol";
import {MockToken} from "../src/MockToken.sol";

contract DeploySuperposition is Script {
    function run() external {
        vm.startBroadcast();

        // 1. Deploy Mock Token
        MockToken token = new MockToken();
        console.log("Deployed MockToken at:", address(token));

        // 2. Deploy Market (using Mock Token)
        SimpleMarket market = new SimpleMarket(address(token));
        console.log("Deployed Market at:", address(market));

        // 3. Mint some tokens to the deployer for testing
        // The constructor already mints, but good to be explicit or mint more if needed
        // token.mint(msg.sender, 1000 * 10**18);

        vm.stopBroadcast();
    }
}
