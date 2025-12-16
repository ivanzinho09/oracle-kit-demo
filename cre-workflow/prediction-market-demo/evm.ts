// evm.ts
// EVM on-chain settlement for prediction markets.
// Uses CRE EVM Write capability to submit settlement reports.

import { cre, type Runtime, bytesToHex, hexToBase64 } from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters, createWalletClient, http, defineChain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
export async function settleMarket(runtime: Runtime<Config>, marketId: bigint, outcomeJson: string, responseId: string): Promise<string> {

  // Validate & parse Gemini output
  const parsed: LLMResult = GeminiResponseSchema.parse(JSON.parse(outcomeJson));
  const evmCfg = runtime.config.evms[0];

  runtime.log(`Settling Market at contract: ${evmCfg.marketAddress}`);
  runtime.log(`Outcome: ${parsed.result}, Confidence: ${parsed.confidence}`);

  // Map outcome
  const outcomeUint = mapOutcomeToUint(parsed.result);

  // Define Superposition Chain
  const superpositionChain = defineChain({
    id: 98985,
    name: "Superposition Testnet",
    nativeCurrency: { name: "SPN", symbol: "SPN", decimals: 18 },
    rpcUrls: {
      default: { http: ["https://testnet-rpc.superposition.so/"] },
    },
  });

  // Setup Viem Wallet
  // Use config-provided keys or environment variable override
  const privKey = process.env.CRE_ETH_PRIVATE_KEY || (runtime as any).secrets?.CRE_ETH_PRIVATE_KEY;
  if (!privKey) throw new Error("CRE_ETH_PRIVATE_KEY not found in env or secrets");

  const account = privateKeyToAccount(privKey as Hex);

  const client = createWalletClient({
    account,
    chain: superpositionChain,
    transport: http()
  });

  // Prepare Report Data
  const reportData = makeReportData(marketId, outcomeUint, parsed.confidence, responseId);

  // Send Transaction calling onReport(bytes,bytes)
  const hash = await client.writeContract({
    address: evmCfg.marketAddress as Hex,
    abi: [{
      name: 'onReport',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [{ type: 'bytes', name: 'metadata' }, { type: 'bytes', name: 'report' }],
      outputs: []
    }],
    functionName: 'onReport',
    args: ["0x" as Hex, reportData]
  });

  runtime.log(`Transaction sent: ${hash}`);
  return hash;
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
