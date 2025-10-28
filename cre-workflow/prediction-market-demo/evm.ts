// evm.ts
// EVM on-chain settlement for prediction markets.
// Uses CRE EVM Write capability to submit settlement reports.

import {
  cre,
  type Runtime,
  getNetwork,
  bytesToHex,
  hexToBase64,
} from "@chainlink/cre-sdk";
import {encodeAbiParameters, parseAbiParameters } from "viem";
import { GeminiResponseSchema, type Config, type LLMResult } from "./types";

/*********************************
 * On-Chain Settlement
 *********************************/

/**
 * Settles a prediction market on-chain using CRE's EVM Write capability.
 * Validates the Gemini response, encodes the report data, signs it with ECDSA, and submits it to the contract.
 * 
 * @param runtime - CRE runtime instance with config and secrets
 * @param marketId - ID of the market to settle
 * @param outcomeJson - JSON string from Gemini containing the result and confidence
 * @param responseId - Unique identifier from the Gemini response
 * @returns Transaction hash of the settlement transaction
 */
export function settleMarket(runtime: Runtime<Config>, marketId: bigint, outcomeJson: string, responseId: string): string {

  // Validate & parse the Gemini output (throws on invalid structure or out-of-range values)
  const parsed: LLMResult = GeminiResponseSchema.parse(JSON.parse(outcomeJson));

  const evmCfg = runtime.config.evms[0];

  // Resolve concrete chain selector from chainSelectorName
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: evmCfg.chainSelectorName,
    isTestnet: true,
  });
  if (!network) throw new Error(`Unknown chain name: ${evmCfg.chainSelectorName}`);

  runtime.log(`Settling Market at contract: ${evmCfg.marketAddress}`);

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);

  // Encode report payload for signing & submission
  const outcomeUint = mapOutcomeToUint(parsed.result);
  const reportData = makeReportData(marketId, outcomeUint, parsed.confidence, responseId);

  runtime.log(
    `Writing report — marketId: ${marketId}, outcome: ${parsed.result} (${outcomeUint}), confidence: ${parsed.confidence}, responseId: ${responseId}`
  );

  // Sign the report using ECDSA over keccak256 (EVM-compatible signature)
  const reportResponse = runtime
    .report({
      encodedPayload: hexToBase64(reportData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  // Submit the signed report to the SimpleMarket contract via onReport()
  const writeReportResult = evmClient
    .writeReport(runtime, {
      receiver: evmCfg.marketAddress,
      report: reportResponse,
      gasConfig: {
        gasLimit: runtime.config.evms[0].gasLimit,
      },
    })
    .result();

  runtime.log("Waiting for write report response");
  const txHash = bytesToHex(writeReportResult.txHash ?? new Uint8Array(32));
  runtime.log(`Write report transaction succeeded: ${txHash}`);

  return txHash;
}

/*********************************
 * Helper Functions
 *********************************/

/**
 * Maps string outcome from Gemini to uint8 for Solidity enum.
 * 
 * @param r - Outcome string from Gemini ("YES", "NO", or "INCONCLUSIVE")
 * @returns Corresponding uint8 value (1=NO, 2=YES, 3=INCONCLUSIVE)
 */
const mapOutcomeToUint = (r: LLMResult["result"]): 1 | 2 | 3 => {
  switch (r) {
    case "NO":
      return 1;
    case "YES":
      return 2;
    case "INCONCLUSIVE":
      return 3;
  }
};

/**
 * ABI-encodes the settlement report data for the SimpleMarket contract.
 * 
 * @param marketId - ID of the market being settled
 * @param outcomeUint - Numeric outcome (1=NO, 2=YES, 3=INCONCLUSIVE)
 * @param confidenceBp - Confidence score in basis points (0-10000)
 * @param responseId - Gemini response ID for audit trail
 * @returns ABI-encoded bytes for the report
 */
const makeReportData = (marketId: bigint, outcomeUint: 1 | 2 | 3, confidenceBp: number, responseId: string) =>
  encodeAbiParameters(parseAbiParameters("uint256 marketId, uint8 outcome, uint16 confidenceBp, string responseId"), [
    marketId,
    outcomeUint,
    confidenceBp,
    responseId,
  ]);
