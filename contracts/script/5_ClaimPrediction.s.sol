// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;


import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {SimpleMarket} from "../src/SimpleMarket.sol";


/// @notice Calls `claimPrediction(marketId)` to withdraw winnings.
contract ClaimPrediction is Script {
    function run() external {
        address marketAddr = vm.envAddress("MARKET");
        uint256 marketId = vm.envUint("MARKET_ID");
        uint256 pk = vm.envUint("PRIVATE_KEY"); // claimer EOA


        SimpleMarket market = SimpleMarket(marketAddr);


        vm.startBroadcast(pk);
        market.claimPrediction(marketId);
        vm.stopBroadcast();


        console2.log("Claimed winnings for market:", marketId);
    }
}