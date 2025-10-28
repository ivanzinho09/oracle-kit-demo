// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;


import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {SimpleMarket} from "../src/SimpleMarket.sol";


/// @notice Calls `settleMarketManually(marketId, outcome)` if status is `NeedsManual`.
contract SettleMarketManually is Script {
    function run() external {
        address marketAddr = vm.envAddress("MARKET");
        uint256 marketId = vm.envUint("MARKET_ID");
        uint256 outcome = vm.envUint("OUTCOME"); // 1=No, 2=Yes
        uint256 pk = vm.envUint("PRIVATE_KEY"); // caller EOA

        SimpleMarket market = SimpleMarket(marketAddr);

        vm.startBroadcast(pk);
        market.settleMarketManually(marketId, SimpleMarket.Outcome(outcome));
        vm.stopBroadcast();

        console2.log("Manually settled market:", marketId, outcome);
    }
}