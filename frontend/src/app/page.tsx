"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";

interface SettlementDoc {
    id: string;
    statusCode: number;
    question: string;
    geminiResponse: string;
    responseId: string;
    rawJsonString: string;
    txHash: string;
    createdAt: number;
}

const ITEMS_LIMIT = 10;

export default function Home() {
    const [docs, setDocs] = useState<SettlementDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchDocs = async () => {
            try {
                const q = query(
                    collection(db, "demo"),
                    orderBy("createdAt", "desc"),
                    limit(ITEMS_LIMIT)
                );
                const querySnapshot = await getDocs(q);
                const docsData = querySnapshot.docs.map(
                    doc =>
                        ({
                            id: doc.id,
                            ...doc.data(),
                        } as SettlementDoc)
                );
                setDocs(docsData);
            } catch (err) {
                console.error(err);
                if (err instanceof Error) {
                    setError(
                        `Failed to fetch data: ${err.message}. Ensure your Firebase configuration and security rules are set up correctly.`
                    );
                } else {
                    setError("An unknown error occurred.");
                }
            } finally {
                setLoading(false);
            }
        };

        fetchDocs();
    }, []);

    return (
        <main className="flex min-h-screen flex-col items-center p-24 bg-gray-900 text-white">
            <h1 className="text-4xl font-bold mb-8">
                Recent Market Settlements
            </h1>

            {loading && <p>Loading...</p>}

            {error && <p className="text-red-500">{error}</p>}

            {!loading && !error && docs.length === 0 && (
                <p>No documents found.</p>
            )}

            {!loading && !error && docs.length > 0 && (
                <div className="w-full max-w-4xl">
                    {docs.map(doc => (
                        <div
                            key={doc.id}
                            className="bg-gray-800 p-4 rounded-lg mb-4"
                        >
                            <h2 className="text-xl font-semibold">
                                Response ID: {doc.responseId}
                            </h2>
                            <p>
                                <span className="font-bold">
                                    Transaction Hash:
                                </span>{" "}
                                {doc.txHash ===
                                "0x0000000000000000000000000000000000000000000000000000000000000000"
                                    ? "0x00000 ... (simulated)"
                                    : doc.txHash}
                            </p>
                            <p>
                                <span className="font-bold">Created At:</span>{" "}
                                {new Date(doc.createdAt).toLocaleString()}
                            </p>
                            <p>
                                <span className="font-bold">Status Code:</span>{" "}
                                {doc.statusCode}
                            </p>
                            <p>
                                <span className="font-bold">
                                    Market question:
                                </span>{" "}
                                {doc.question}
                            </p>
                            <div className="mt-2">
                                <p className="font-bold">Gemini Response:</p>
                                <pre className="bg-gray-700 p-2 rounded-md text-sm overflow-x-auto">
                                    {JSON.stringify(
                                        JSON.parse(doc.geminiResponse),
                                        null,
                                        2
                                    )}
                                </pre>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </main>
    );
}
