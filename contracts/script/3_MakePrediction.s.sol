// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;


import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {SimpleMarket} from "../src/SimpleMarket.sol";


interface IERC20 { function approve(address spender, uint256 value) external returns (bool); }


/// @notice Approves tokens and calls `makePrediction(marketId, outcome, amount)`.
contract MakePrediction is Script {
    function run() external {
        address marketAddr = vm.envAddress("MARKET");
        uint256 marketId = vm.envUint("MARKET_ID");
        uint256 outcome = vm.envUint("OUTCOME"); // 1=No, 2=Yes
        uint256 amount = vm.envUint("AMOUNT"); // raw units
        uint256 pk = vm.envUint("PRIVATE_KEY"); // predictor EOA


        SimpleMarket market = SimpleMarket(marketAddr);
        address token = address(market.paymentToken());

        vm.startBroadcast(pk);
        IERC20(token).approve(marketAddr, amount);
        market.makePrediction(marketId, SimpleMarket.Outcome(outcome), amount);
        vm.stopBroadcast();


        console2.log("Prediction placed:", marketId, outcome, amount);
    }
}