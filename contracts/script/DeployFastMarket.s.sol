// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SimpleMarket} from "../src/SimpleMarket.sol";

contract DeployFastMarket is Script {
    function run() external {
        // USDC on Sepolia
        address usdc = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
        
        vm.startBroadcast();
        SimpleMarket market = new SimpleMarket(usdc);
        vm.stopBroadcast();
        
        console.log("Deployed FastMarket at:", address(market));
    }
}
