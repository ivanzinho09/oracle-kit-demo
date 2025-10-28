// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {SimpleMarket} from "../src/SimpleMarket.sol";

/// @notice Calls `newMarket(question)` on an existing SimpleMarket.
contract NewMarket is Script {
    function run() external returns (uint256 marketId) {
        address marketAddr = vm.envAddress("MARKET");
        uint256 pk = vm.envUint("PRIVATE_KEY"); // caller EOA

        string memory question = "Will Sweden win the 2025 Eurovision contest?"; // "The New York Yankees will win the 2009 world series.";

        SimpleMarket market = SimpleMarket(marketAddr);

        vm.startBroadcast(pk);
        marketId = market.newMarket(question);
        vm.stopBroadcast();

        console2.log("New market created: id=", marketId);
        console2.log("Question:", question);
    }
}
