import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, setDoc, updateDoc, collection, query, where, getDocs } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const ADMIN_PASSWORD = "admin";

const ABI = [
    "function submitReport(uint256 marketId, uint8 outcome, uint16 confidence, string calldata responseId) external",
    "function requestSettlement(uint256 marketId) external",
    "function settleMarketManually(uint256 marketId, uint8 outcome) external",
    // Full Market struct: question, marketOpen, marketClose, status, outcome, settledAt, evidenceURI, confidenceBps, predCounts[2], predTotals[2]
    "function getMarket(uint256) view returns (tuple(string question, uint256 marketOpen, uint256 marketClose, uint8 status, uint8 outcome, uint256 settledAt, string evidenceURI, uint16 confidenceBps, uint256[2] predCounts, uint256[2] predTotals))"
];

// Status enum: 0=Open, 1=SettlementRequested, 2=Settled, 3=NeedsManual

// Initialize Firebase
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);
const auth = getAuth(app);

export async function POST(request: Request) {
    try {
        const { marketId, outcome, source, comments, adminPassword } = await request.json();

        // Validate password
        if (adminPassword !== ADMIN_PASSWORD) {
            return NextResponse.json({ error: "Invalid admin password" }, { status: 401 });
        }

        // Validate inputs
        if (!marketId || !outcome || !source) {
            return NextResponse.json({
                error: "Missing required fields: marketId, outcome, source"
            }, { status: 400 });
        }

        if (!["YES", "NO"].includes(outcome)) {
            return NextResponse.json({
                error: "Outcome must be YES or NO"
            }, { status: 400 });
        }

        const rpcUrl = process.env.RPC_URL;
        const privateKey = process.env.CRE_ETH_PRIVATE_KEY;
        const marketAddress = process.env.NEXT_PUBLIC_MARKET_ADDRESS;

        if (!rpcUrl || !privateKey || !marketAddress) {
            return NextResponse.json({
                error: "Server misconfigured (missing env vars)"
            }, { status: 500 });
        }

        console.log(`[Admin] Manual settlement: Market #${marketId} => ${outcome}`);

        // Setup provider and contract
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const contract = new ethers.Contract(marketAddress, ABI, wallet);

        // Get market data
        const marketData = await contract.getMarket(marketId);
        const question = marketData.question.replace(" [CONSORTIUM]", "");
        const status = Number(marketData.status); // 0=Open, 1=Pending, 2=Settled, 3=NeedsManual

        console.log(`[Admin] Market #${marketId} status: ${status}`);

        // Check if already fully settled
        if (status === 2) {
            return NextResponse.json({
                error: "Market is already fully settled"
            }, { status: 400 });
        }

        const responseId = `admin-${Date.now()}`;
        const outcomeEnum = outcome === "YES" ? 2 : 1; // 0=None, 1=No, 2=Yes
        const confidence = 10000; // 100% for admin settlement
        let tx;

        if (status === 3) {
            // NeedsManual - use settleMarketManually
            console.log(`[Admin] Using settleMarketManually for NeedsManual market`);
            tx = await contract.settleMarketManually(marketId, outcomeEnum);
        } else if (status === 0) {
            // Open - need to request settlement first, then submit report
            console.log(`[Admin] Market is Open, requesting settlement first...`);
            const reqTx = await contract.requestSettlement(marketId);
            await reqTx.wait();
            console.log(`[Admin] Settlement requested: ${reqTx.hash}`);

            console.log(`[Admin] Submitting report...`);
            tx = await contract.submitReport(marketId, outcomeEnum, confidence, responseId);
        } else if (status === 1) {
            // SettlementRequested - submit report directly
            console.log(`[Admin] Market is SettlementRequested, submitting report...`);
            tx = await contract.submitReport(marketId, outcomeEnum, confidence, responseId);
        } else {
            return NextResponse.json({
                error: `Unknown market status: ${status}`
            }, { status: 400 });
        }

        console.log(`[Admin] TX Submitted: ${tx.hash}`);
        await tx.wait();

        // Store in Firestore - find existing settlement and UPDATE it
        await signInAnonymously(auth);

        const adminOverride = {
            isManualSettlement: true,
            adminOverride: {
                finalResult: outcome,
                finalConfidence: confidence,
                adminSource: source,
                adminComments: comments || "",
                adminTxHash: tx.hash,
                overrideTimestamp: Date.now()
            }
        };

        // Find existing settlement in settlements collection
        const settlementsRef = collection(db, "settlements");
        const settlementsQ = query(settlementsRef, where("marketId", "==", marketId.toString()));
        const settlementsSnap = await getDocs(settlementsQ);

        if (!settlementsSnap.empty) {
            // Update existing settlement
            const existingDoc = settlementsSnap.docs[0];
            await updateDoc(doc(db, "settlements", existingDoc.id), adminOverride);
            console.log(`[Admin] Updated existing settlement: ${existingDoc.id}`);
        } else {
            // Create new (fallback for markets that didn't have prior settlement)
            await setDoc(doc(db, "settlements", responseId), {
                marketId: marketId.toString(),
                question: question,
                parsedGemini: { result: outcome, confidence: confidence },
                resolutionMethod: "ADMIN",
                isFallback: false,
                ...adminOverride,
                timestamp: Date.now(),
                txHash: tx.hash
            });
        }

        // Find existing in demo collection and update
        const demoRef = collection(db, "demo");
        const demoQ = query(demoRef, where("question", "==", question));
        const demoSnap = await getDocs(demoQ);

        if (!demoSnap.empty) {
            // Update existing demo entry
            const existingDemo = demoSnap.docs[0];
            await updateDoc(doc(db, "demo", existingDemo.id), {
                ...adminOverride,
                // Update the geminiResponse to show final result
                geminiResponse: JSON.stringify({
                    result: outcome,
                    confidence: confidence,
                    wasInconclusive: true,
                    adminOverride: true
                }),
                resolutionMethod: "ADMIN"
            });
            console.log(`[Admin] Updated existing demo entry: ${existingDemo.id}`);
        } else {
            // Create new
            await setDoc(doc(db, "demo", responseId), {
                statusCode: 200,
                question: question,
                geminiResponse: JSON.stringify({ result: outcome, confidence: confidence }),
                responseId: responseId,
                txHash: tx.hash,
                createdAt: Date.now(),
                resolutionMethod: "ADMIN",
                isFallback: false,
                ...adminOverride
            });
        }

        console.log(`[Admin] Firestore updated for market #${marketId}`);

        return NextResponse.json({
            success: true,
            txHash: tx.hash,
            responseId: responseId,
            outcome: outcome,
            message: `Market #${marketId} manually settled as ${outcome}`
        });

    } catch (error: any) {
        console.error("[Admin] Settlement error", error);
        return NextResponse.json({
            error: error.message || "Settlement failed"
        }, { status: 500 });
    }
}
