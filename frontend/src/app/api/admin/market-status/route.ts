import { NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";

// Initialize Firebase
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const marketId = searchParams.get("marketId");

        if (!marketId) {
            return NextResponse.json({ error: "Market ID required" }, { status: 400 });
        }

        // Find settlement document for this market
        const settlementsRef = collection(db, "settlements");
        const q = query(settlementsRef, where("marketId", "==", marketId));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return NextResponse.json({
                marketId,
                settlement: null,
                message: "No settlement found"
            });
        }

        const settlementDoc = snapshot.docs[0];
        const settlementData = settlementDoc.data();

        return NextResponse.json({
            marketId,
            settlement: {
                responseId: settlementDoc.id,
                result: settlementData.parsedGemini?.result || "UNKNOWN",
                confidence: settlementData.parsedGemini?.confidence || 0,
                resolutionMethod: settlementData.resolutionMethod || "UNKNOWN",
                isFallback: settlementData.isFallback || false,
                isManualSettlement: settlementData.isManualSettlement || false,
                adminSource: settlementData.adminSource,
                adminComments: settlementData.adminComments,
                timestamp: settlementData.timestamp
            }
        });

    } catch (error: any) {
        console.error("[Admin] Market status error", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
