import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { encodeAbiParameters, parseAbiParameters, createWalletClient, http, defineChain, type Hex, createPublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { db, auth } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";


// --- Types ---
type Market = {
    question: string;
    marketOpen: bigint;
    marketClose: bigint;
    status: number; // 0=Open, 1=SettlementRequested, 2=Settled, 3=NeedsManual
    outcome: number;
    settledAt: bigint;
    evidenceURI: string;
    confidenceBps: number;
};

// --- ABI & Helpers ---
const MARKET_ABI = [
    "function requestSettlement(uint256 marketId) public",
    "function getMarket(uint256 marketId) public view returns (tuple(string question, uint256 marketOpen, uint256 marketClose, uint8 status, uint8 outcome, uint256 settledAt, string evidenceURI, uint16 confidenceBps, uint256[2] predCounts, uint256[2] predTotals))",
    "function onReport(bytes calldata metadata, bytes calldata report) external"
];

// Map outcomes to uint8
const mapOutcomeToUint = (r: "YES" | "NO" | "INCONCLUSIVE"): 1 | 2 | 3 => {
    switch (r) {
        case "NO": return 1;
        case "YES": return 2;
        case "INCONCLUSIVE": return 3;
    }
};

const makeReportData = (marketId: bigint, outcomeUint: 1 | 2 | 3, confidenceBp: number, responseId: string) =>
    encodeAbiParameters(parseAbiParameters("uint256 marketId, uint8 outcome, uint16 confidenceBp, string responseId"), [
        marketId,
        outcomeUint,
        confidenceBp,
        responseId,
    ]);

// --- Main Handler ---
export async function POST(request: Request) {
    try {
        const { marketId } = await request.json();
        if (marketId === undefined) return NextResponse.json({ error: "No marketId" }, { status: 400 });

        const marketIdBigInt = BigInt(marketId);

        // Environment Variables
        const rpcUrl = process.env.RPC_URL;
        const privateKey = process.env.CRE_ETH_PRIVATE_KEY;
        const marketAddress = process.env.NEXT_PUBLIC_MARKET_ADDRESS;
        const geminiKey = process.env.GEMINI_API_KEY;

        if (!rpcUrl || !privateKey || !marketAddress) {
            return NextResponse.json({ error: "Server configuration missing (RPC, Key, or Address)" }, { status: 500 });
        }

        console.log(`[API] Starting settlement for Market ${marketId} on ${rpcUrl}`);

        // 1. Setup Provider & Wallet (Ethers for View/Request, Viem for Report)
        // Using ethers for simple view calls as in contract ABI above
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const contract = new ethers.Contract(marketAddress, MARKET_ABI, wallet);

        // 2. Request Settlement (if not already requested)
        // Check status first to avoid revert
        const marketData = await contract.getMarket(marketIdBigInt);
        const status = Number(marketData.status); // 0=Open

        if (status === 0) {
            console.log(`[API] Requesting settlement (Status: Open)...`);
            const tx = await contract.requestSettlement(marketId);
            await tx.wait();
            console.log(`[API] Settlement Requested: ${tx.hash}`);
        } else {
            console.log(`[API] Market status is ${status}, skipping requestSettlement.`);
        }

        // 3. Get Question
        // Fetch fresh data
        const updatedMarketData = await contract.getMarket(marketIdBigInt);
        const question = updatedMarketData.question;
        console.log(`[API] Settling Question: "${question}"`);

        let parsed;
        let isConsortium = false;
        let fullEvidenceObject: any = {};
        let isFallback = false;
        let resolutionMethod: 'DISCRETE' | 'CONTIGUOUS' | 'MOCK' = 'CONTIGUOUS';

        // --- TRY DISCRETE RESOLUTION FIRST ---
        try {
            const discreteResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/market/resolve-discrete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ marketId })
            });

            const discreteResult = await discreteResponse.json();

            if (discreteResult.success && !discreteResult.fallback) {
                // DISCRETE resolution succeeded - no consortium needed (deterministic result)
                console.log(`[API] DISCRETE resolution succeeded: ${discreteResult.outcome}`);
                if (question.includes("[CONSORTIUM]")) {
                    console.log(`[API] ⚡ Consortium mode requested but SKIPPED for DISCRETE (deterministic API result)`);
                }
                parsed = {
                    result: discreteResult.outcome,
                    confidence: discreteResult.confidence,
                    discrete: {
                        extractedValue: discreteResult.extractedValue,
                        targetValue: discreteResult.targetValue,
                        operator: discreteResult.operator,
                        source: discreteResult.source,
                        apiResponse: discreteResult.apiResponse,
                        oracleSpec: discreteResult.oracleSpec,
                        apiUrl: discreteResult.apiUrl,
                        sportsContext: discreteResult.sportsContext
                    }
                };
                resolutionMethod = 'DISCRETE';
            } else {
                // DISCRETE failed or not applicable, proceed to Contiguous
                console.log(`[API] DISCRETE not applicable or failed: ${discreteResult.fallbackReason || 'N/A'}. Falling back to CONTIGUOUS.`);
                isFallback = discreteResult.fallback || false;
            }
        } catch (discreteError) {
            console.log(`[API] DISCRETE resolution call failed, falling back to CONTIGUOUS`, discreteError);
            isFallback = true;
        }

        // --- CONTIGUOUS RESOLUTION (Gemini) ---
        if (!parsed) {
            if (!geminiKey) {
                console.warn("[API] GEMINI_API_KEY missing. Using Mock AI Response.");
                const mockOutcomes = ["YES", "NO"];
                const mockResult = mockOutcomes[Math.floor(Math.random() * mockOutcomes.length)];
                console.log(`[API] Mock Result: ${mockResult}`);
                parsed = { result: mockResult, confidence: 9999 };
                resolutionMethod = 'MOCK';
            } else {
                // 4. Ask Gemini (CONTIGUOUS Resolution)
                resolutionMethod = 'CONTIGUOUS';
                const genAI = new GoogleGenerativeAI(geminiKey);
                const model = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash",
                    tools: [{ googleSearch: {} } as any], // Enable Grounding
                    systemInstruction: `You are a prediction market oracle. Verify the event using the provided search tool.
    Current Time: ${new Date().toISOString()}
    OUTPUT JSON ONLY: { "result": "YES" | "NO" | "INCONCLUSIVE", "confidence": <0-10000> }
    Rules:
    - YES: Event happened.
    - NO: Event did NOT happen and deadline passed.
    - INCONCLUSIVE: Event not happened yet but window still open, or ambiguous.
    `
                });

                // CONSORTIUM CHECK
                isConsortium = question.includes("[CONSORTIUM]");
                const cleanQuestion = question.replace(" [CONSORTIUM]", "");
                const prompt = `Market Question: "${cleanQuestion}". Has this happened? Return JSON.`;

                /* ------------------------------------------------------------------
                   HELPER: Single Gemini Call
                ------------------------------------------------------------------ */
                const askGemini = async (index: number) => {
                    try {
                        const result = await model.generateContent(prompt);
                        const responseText = result.response.text();

                        // Robust JSON Parsing
                        let cleanJson = responseText.replace(/```json|```/g, "").trim();
                        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
                        if (jsonMatch) cleanJson = jsonMatch[0];

                        const p = JSON.parse(cleanJson);
                        return {
                            result: (["YES", "NO", "INCONCLUSIVE"].includes(p.result)) ? p.result : "INCONCLUSIVE",
                            confidence: Number.isInteger(p.confidence) ? p.confidence : 0,
                            rawResponse: result.response // Return full object for storage
                        };
                    } catch (e) {
                        console.error(`[Judge ${index}] Failed`, e);
                        return { result: "INCONCLUSIVE", confidence: 0, rawResponse: {} };
                    }
                };



                if (isConsortium) {
                    console.log(`[API] 🤖 CONSORTIUM MODE ACTIVATED: 5 Judges Summoned`);

                    // Run 5 parallel requests
                    const judgeCount = 5;
                    const promises = Array.from({ length: judgeCount }, (_, i) => askGemini(i + 1));
                    const results = await Promise.all(promises);

                    // Use the first judge's metadata for the audit trail (representative sample for grounding)
                    // In a perfect world we'd store all 5, but for this demo we'll pick one representative 'generic response'
                    if (results[0]?.rawResponse) {
                        fullEvidenceObject = results[0].rawResponse;
                    }

                    // Tally Votes
                    const tally: Record<string, number> = { "YES": 0, "NO": 0, "INCONCLUSIVE": 0 };
                    let totalConfidence = 0;

                    results.forEach((r, i) => {
                        console.log(`[Judge ${i + 1}] Voted: ${r.result} (Conf: ${r.confidence})`);
                        tally[r.result as string] = (tally[r.result as string] || 0) + 1;
                        totalConfidence += r.confidence;
                    });

                    // Determine Winner
                    let winner = "INCONCLUSIVE";
                    let maxVotes = 0;

                    Object.entries(tally).forEach(([res, count]) => {
                        if (count > maxVotes) {
                            maxVotes = count;
                            winner = res;
                        } else if (count === maxVotes) {
                            winner = "INCONCLUSIVE"; // Tie implies ambiguity
                        }
                    });

                    const avgConfidence = Math.floor(totalConfidence / judgeCount);
                    console.log(`[Consortium] Final Verdict: ${winner} (Votes: ${JSON.stringify(tally)}, Avg Conf: ${avgConfidence})`);

                    parsed = {
                        result: winner,
                        confidence: avgConfidence,
                        consortium: {
                            judges: judgeCount,
                            tally: tally,
                            // Store individual votes for the audit trail
                            details: results.map(r => ({ result: r.result, confidence: r.confidence }))
                        }
                    };

                } else {
                    // SINGLE JUDGE MODE (Standard)
                    console.log(`[API] Standard Mode: Single Judge`);
                    const singleResult = await askGemini(1);
                    parsed = { result: singleResult.result, confidence: singleResult.confidence };
                    fullEvidenceObject = singleResult.rawResponse;
                    console.log(`[API] Judge Verdict: ${parsed.result} (Conf: ${parsed.confidence})`);
                }
            }
        } // End of if (!parsed) - CONTIGUOUS flow

        /* ------------------------------------------------------------------
           4. SUBMIT ON-CHAIN (Runs for BOTH DISCRETE and CONTIGUOUS)
        ------------------------------------------------------------------ */
        if (!parsed) {
            // This shouldn't happen, but safety fallback
            parsed = { result: "INCONCLUSIVE", confidence: 0 };
        }

        const validResult = parsed.result === "YES" ? 3 : parsed.result === "NO" ? 2 : 0;

        let outcomeEnum = 3; // Default Inconclusive
        if (parsed.result === "NO") outcomeEnum = 1;
        if (parsed.result === "YES") outcomeEnum = 2;

        const validConfidence = Math.min(Math.max(parsed.confidence || 0, 0), 10000);

        // 5. Submit Report (Viem for precise ABI encoding & raw access)

        // Define Custom Chain for Viem
        const chainId = (await provider.getNetwork()).chainId;
        const customChain = defineChain({
            id: Number(chainId),
            name: "Custom Chain",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: { default: { http: [rpcUrl] } }
        });

        const account = privateKeyToAccount(privateKey as Hex);
        const walletClient = createWalletClient({
            account,
            chain: customChain,
            transport: http()
        });

        // Generative AI doesn't give a stable responseId like the requested format, using timestamp as ID
        const responseId = `gemini-${Date.now()}`;

        console.log(`[API] Submitting Report: Outcome=${parsed.result}(${outcomeEnum}), Conf=${validConfidence}, Method=${resolutionMethod}${isFallback ? ' (FALLBACK)' : ''}`);

        const hash = await walletClient.writeContract({
            address: marketAddress as Hex,
            abi: [{
                name: 'onReport',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [
                    { type: 'bytes', name: 'metadata' },
                    { type: 'bytes', name: 'report' }
                ],
                outputs: []
            }],
            functionName: 'onReport',
            args: [
                "0x", // metadata
                encodeAbiParameters(
                    [{ type: 'uint256' }, { type: 'uint8' }, { type: 'uint16' }, { type: 'string' }],
                    [BigInt(marketId), outcomeEnum, validConfidence, responseId]
                )
            ],
            account: account
        });

        console.log(`[API] TX Submitted: ${hash}`);

        // 6. Write to Firestore (for Frontend UI)
        try {
            await signInAnonymously(auth);

            await setDoc(doc(db, "demo", responseId), {
                statusCode: 200,
                question: question,
                geminiResponse: JSON.stringify(parsed), // The structured result
                fullGenericResponse: JSON.stringify(fullEvidenceObject), // FULL Gemini object with grounding metadata
                responseId: responseId,
                txHash: hash,
                createdAt: Date.now(),
                consortiumMode: isConsortium,
                resolutionMethod: resolutionMethod,
                isFallback: isFallback
            });
            console.log(`[API] Firestore updated for ${responseId}`);
        } catch (fsError) {
            console.error(`[API] Firestore Write Failed:`, fsError);
            // Don't fail the request if Firestore fails, as on-chain TX succeeded
        }

        return NextResponse.json({ success: true, txHash: hash, result: parsed });

    } catch (e: any) {
        console.error("[API] Settlement Failed", e);
        return NextResponse.json({ error: e.message || "Settlement failed" }, { status: 500 });
    }
}
