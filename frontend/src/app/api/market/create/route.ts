
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { OracleSpec, DiscreteOracleSpec, ContiguousOracleSpec, TRUSTED_SOURCES, OracleCategory } from "@/lib/oracle-types";

const ABI = [
    "function newMarket(string calldata question, uint256 duration) public returns (uint256)",
    "function nextMarketId() public view returns (uint256)"
];

// Firebase Init
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};
const app = initializeApp(firebaseConfig, "create-route");
const db = getFirestore(app);

const CLASSIFICATION_PROMPT = `You are an oracle classifier for a prediction market.

Analyze the user's market question and determine if it can be resolved via a **DISCRETE** data source (API call) or requires **CONTIGUOUS** AI reasoning.

=== DISCRETE CATEGORIES ===

1. CRYPTO_PRICE: Cryptocurrency prices
   - API: https://api.coingecko.com/api/v3/simple/price
   - params: { "ids": "<coin_id>", "vs_currencies": "usd" }
   - coin_id examples: "bitcoin", "ethereum", "solana", "dogecoin", "cardano"
   - extraction_path: $.<coin_id>.usd (e.g., $.bitcoin.usd)

2. WEATHER: Current temperature (Celsius) for a city
   - API: https://wttr.in/<city>?format=j1
   - params: {} (city goes in URL path)
   - extraction_path: $.current_condition[0].temp_C
   - Example cities: "NewYork", "London", "Tokyo", "Sydney" (no spaces, use CamelCase)

3. FOREX_RATE: Currency exchange rates (base: USD)
   - API: https://open.er-api.com/v6/latest/USD
   - params: {} (no params needed)
   - extraction_path: $.rates.<currency_code> (e.g., $.rates.EUR, $.rates.GBP)
   - Common codes: EUR, GBP, JPY, AUD, CAD, CHF, CNY

4. SPORTS_SCORE: Did a team win their most recent game?
   - Step 1: Use team search to get team ID: https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=<team_name>
   - Step 2: Use last events API: https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=<team_id>
   - For oracle spec, use the eventslast endpoint with params: { "team_search": "<team_name>" }
   - extraction_path: Use $.results[0].intHomeScore and $.results[0].intAwayScore
   - ONLY USE FOR: "Did X win their last game?" type questions
   - DO NOT USE FOR: Future games, predictions, or complex sports stats

=== CONTIGUOUS (AI Reasoning) ===
Use for: Elections, company news, subjective predictions, complex multi-step queries, future events beyond simple price/weather.

=== OUTPUT FORMAT ===
Return VALID JSON ONLY:
{
  "type": "DISCRETE" | "CONTIGUOUS",
  "category": "CRYPTO_PRICE" | "FOREX_RATE" | "WEATHER" | "SPORTS_SCORE" | "DATE_EVENT" | "GENERAL_AI",
  "reason": "Brief explanation",
  "spec": {
    "natural_language_summary": "Human readable resolution logic",
    "extraction_path": "$.path.to.value",
    "comparison": { "operator": ">|<|>=|<=|==|!=", "target_value": <number_or_string> },
    "resolution_timestamp": "ISO timestamp",
    "api_params": { ... }
  }
}

=== EXAMPLES ===

Q: "Is Bitcoin above $100,000?"
→ DISCRETE, CRYPTO_PRICE, extraction_path: $.bitcoin.usd, comparison: { ">", 100000 }, api_params: { "ids": "bitcoin", "vs_currencies": "usd" }

Q: "Is the temperature below 0°C in New York?"
→ DISCRETE, WEATHER, extraction_path: $.current_condition[0].temp_C, comparison: { "<", 0 }, api_params: {}

Q: "Is EUR/USD above 1.10?"
→ DISCRETE, FOREX_RATE, extraction_path: $.rates.EUR, comparison: { ">", 1.10 }, api_params: {}

Q: "Did the Lakers win their last game?" or "Did the Bulls win their most recent game?"
→ DISCRETE, SPORTS_SCORE, extraction_path: $.results[0], comparison: { "==", true }, api_params: { "team_search": "Los Angeles Lakers" }

Q: "Will the Lakers win tonight?" or "Will the Celtics win the championship?"
→ CONTIGUOUS, GENERAL_AI (future event, subjective - cannot use API)
`;

export async function POST(request: Request) {
    try {
        const { question, duration, isConsortium } = await request.json();
        if (!question) return NextResponse.json({ error: "No question provided" }, { status: 400 });

        // Append tag if requested
        const finalQuestion = isConsortium ? `${question} [CONSORTIUM]` : question;

        // Default to 10 seconds if not provided or invalid
        const marketDuration = duration && !isNaN(Number(duration)) && Number(duration) >= 10
            ? Number(duration)
            : 10;

        const rpcUrl = process.env.RPC_URL;
        const privateKey = process.env.CRE_ETH_PRIVATE_KEY;
        const marketAddress = process.env.NEXT_PUBLIC_MARKET_ADDRESS;
        const geminiKey = process.env.GEMINI_API_KEY;

        if (!rpcUrl || !privateKey || !marketAddress) {
            return NextResponse.json({ error: "Server misconfigured (missing env vars)" }, { status: 500 });
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const contract = new ethers.Contract(marketAddress, ABI, wallet);

        // Get ID first
        const nextId = await contract.nextMarketId();
        const marketId = nextId.toString();

        // Get current nonce and create transaction with explicit nonce
        const nonce = await provider.getTransactionCount(wallet.address, "pending");
        console.log(`[Create] Using nonce: ${nonce} for market #${marketId}`);

        // Create with custom duration and explicit nonce + retry logic
        let tx;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            try {
                tx = await contract.newMarket(finalQuestion, marketDuration, {
                    nonce: nonce + attempts, // Increment nonce on retry
                    gasLimit: 500000 // Set explicit gas limit
                });
                await tx.wait(); // Wait for confirmation
                console.log(`[Create] Market #${marketId} created, tx: ${tx.hash}`);
                break;
            } catch (txError: any) {
                attempts++;
                console.error(`[Create] TX attempt ${attempts} failed:`, txError.message);

                if (txError.message?.includes("nonce") && attempts < maxAttempts) {
                    console.log(`[Create] Retrying with incremented nonce...`);
                    await new Promise(r => setTimeout(r, 1000)); // Wait 1 second before retry
                    continue;
                }

                // Re-throw if not a nonce issue or max attempts reached
                throw txError;
            }
        }

        if (!tx) {
            throw new Error("Failed to create market after multiple attempts");
        }

        // --- ORACLE CLASSIFICATION ---
        let oracleSpec: OracleSpec | null = null;

        if (geminiKey) {
            try {
                const genAI = new GoogleGenerativeAI(geminiKey);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

                const result = await model.generateContent(`${CLASSIFICATION_PROMPT}\n\nMarket Question: "${question}"`);
                const responseText = result.response.text();

                // Parse JSON
                let cleanJson = responseText.replace(/```json|```/g, "").trim();
                const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
                if (jsonMatch) cleanJson = jsonMatch[0];

                const parsed = JSON.parse(cleanJson);

                if (parsed.type === "DISCRETE") {
                    const category = parsed.category as OracleCategory;
                    const sourceConfig = TRUSTED_SOURCES[category];

                    oracleSpec = {
                        type: "DISCRETE",
                        category: category,
                        natural_language_summary: parsed.spec?.natural_language_summary || "Oracle resolution logic.",
                        source: sourceConfig ? {
                            ...sourceConfig,
                            params: { ...sourceConfig.params, ...parsed.spec?.api_params }
                        } : { name: "Unknown", endpoint: "", params: {} },
                        extraction_path: parsed.spec?.extraction_path || "$",
                        comparison: parsed.spec?.comparison || { operator: "==", target_value: true },
                        resolution_timestamp: parsed.spec?.resolution_timestamp || new Date().toISOString()
                    } as DiscreteOracleSpec;
                } else {
                    oracleSpec = {
                        type: "CONTIGUOUS",
                        category: "GENERAL_AI",
                        natural_language_summary: parsed.spec?.natural_language_summary || "Resolved via AI reasoning and web search."
                    } as ContiguousOracleSpec;
                }

                console.log(`[Create] Market #${marketId} classified as ${oracleSpec.type}`);

                // Store in Firestore
                await setDoc(doc(db, "oracle_specs", marketId), {
                    marketId: marketId,
                    question: question,
                    spec: JSON.stringify(oracleSpec),
                    createdAt: Date.now()
                });

            } catch (classifyError) {
                console.error("[Create] Classification failed, defaulting to CONTIGUOUS", classifyError);
                oracleSpec = {
                    type: "CONTIGUOUS",
                    category: "GENERAL_AI",
                    natural_language_summary: "Resolved via AI reasoning (classification failed)."
                };
            }
        }

        return NextResponse.json({
            success: true,
            marketId,
            txHash: tx.hash,
            oracleType: oracleSpec?.type || "UNKNOWN"
        });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

