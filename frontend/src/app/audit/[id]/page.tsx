"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import Link from "next/link";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig, "audit-page") : getApps()[0];
const db = getFirestore(app);

export default function AuditPage() {
    const { id } = useParams();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [apiTestResult, setApiTestResult] = useState<any>(null);
    const [apiTestLoading, setApiTestLoading] = useState(false);

    useEffect(() => {
        if (!id) return;
        const fetchData = async () => {
            try {
                const docRef = doc(db, "demo", id as string);
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    setData({ id: snap.id, ...snap.data() });
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [id]);

    const runApiTest = async (apiUrl: string) => {
        setApiTestLoading(true);
        try {
            const res = await fetch(apiUrl);
            const json = await res.json();
            setApiTestResult({ success: true, data: json, timestamp: new Date().toISOString() });
        } catch (e: any) {
            setApiTestResult({ success: false, error: e.message, timestamp: new Date().toISOString() });
        } finally {
            setApiTestLoading(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="retro-panel p-4">
                <span className="retro-badge">Loading Evidence...</span>
            </div>
        </div>
    );

    if (!data) return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="retro-panel p-4">
                <span className="retro-badge red">Evidence Not Found</span>
            </div>
        </div>
    );

    const parsedGemini = data.geminiResponse ? JSON.parse(data.geminiResponse) : {};
    let fullResponse: any = null;
    try {
        fullResponse = data.fullGenericResponse ? JSON.parse(data.fullGenericResponse) : null;
    } catch { }

    // Extract grounding chunks if available (standard Gemini structure)
    const groundingMetadata = fullResponse?.candidates?.[0]?.groundingMetadata;
    const searchEntry = groundingMetadata?.searchEntryPoint?.renderedContent;
    const groundingChunks = groundingMetadata?.groundingChunks || [];

    // DISCRETE data
    const isDiscrete = data.resolutionMethod === 'DISCRETE';
    const discreteData = parsedGemini.discrete;

    return (
        <main className="min-h-screen p-4 md:p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Navigation */}
                <Link href="/" className="retro-button inline-flex items-center gap-2">
                    ← Back to Market
                </Link>

                {/* Main Window */}
                <div className="retro-panel">
                    {/* Title Bar */}
                    <div className="retro-titlebar">
                        <span>OracleKit Evidence Explorer</span>
                        <div className="flex gap-1">
                            <button className="retro-button px-2 py-0 text-xs">_</button>
                            <button className="retro-button px-2 py-0 text-xs">□</button>
                            <button className="retro-button px-2 py-0 text-xs">×</button>
                        </div>
                    </div>

                    {/* Header Section */}
                    <div className="p-4 border-b-2 border-gray-400">
                        <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2">
                                <span className="text-xs uppercase font-bold">Evidence Record</span>
                                {data.resolutionMethod && (
                                    <span className={`retro-badge text-xs ${isDiscrete ? 'green' : data.isManualSettlement ? '' : ''}`}
                                        style={data.isManualSettlement ? { background: '#9b59b6', color: 'white' } : {}}>
                                        {data.isManualSettlement ? '👤 ADMIN SETTLEMENT' :
                                            isDiscrete ? '📡 DISCRETE (API)' : '🧠 CONTIGUOUS (AI)'}
                                        {data.isFallback && ' - FALLBACK'}
                                    </span>
                                )}
                            </div>
                            <span className="retro-badge font-mono text-xs">{data.responseId}</span>
                        </div>
                        <h1 className="text-xl font-bold mb-4">{data.question}</h1>

                        <div className="flex items-center gap-4">
                            <div className={`text-3xl font-bold px-4 py-2 ${parsedGemini.result === 'YES' ? 'retro-badge green' : parsedGemini.result === 'NO' ? 'retro-badge red' : 'retro-badge'}`}>
                                {parsedGemini.result}
                            </div>
                            <div className="retro-inset px-4 py-2">
                                <div className="text-xs text-gray-600">Confidence</div>
                                <div className="text-lg font-bold">{(parsedGemini.confidence / 100).toFixed(0)}%</div>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 space-y-6">
                        {/* ADMIN MANUAL SETTLEMENT */}
                        {data.isManualSettlement && (
                            <section className="retro-inset p-4" style={{ borderColor: '#9b59b6' }}>
                                <h2 className="font-bold mb-4 flex items-center gap-2">
                                    👤 Admin Manual Settlement
                                    <span className="retro-badge text-xs" style={{ background: '#9b59b6', color: 'white' }}>Manual Override</span>
                                </h2>

                                <div className="space-y-3">
                                    {/* Show original AI result if available */}
                                    {parsedGemini?.result === "INCONCLUSIVE" || data.adminOverride && (
                                        <div className="retro-panel p-3 mb-2" style={{ background: '#fff3cd', borderColor: '#ffc107' }}>
                                            <div className="text-xs text-gray-600 mb-1">Original AI Result</div>
                                            <div className="font-medium">INCONCLUSIVE → Manually settled as {data.adminOverride?.finalResult || parsedGemini?.result}</div>
                                        </div>
                                    )}

                                    <div className="retro-panel p-3">
                                        <div className="text-xs text-gray-600 mb-1">Settlement Source</div>
                                        <a
                                            href={data.adminOverride?.adminSource || data.adminSource}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:underline break-all"
                                        >
                                            {data.adminOverride?.adminSource || data.adminSource || "Not provided"}
                                        </a>
                                    </div>

                                    {(data.adminOverride?.adminComments || data.adminComments) && (
                                        <div className="retro-panel p-3">
                                            <div className="text-xs text-gray-600 mb-1">Admin Comments</div>
                                            <div className="text-sm whitespace-pre-wrap">{data.adminOverride?.adminComments || data.adminComments}</div>
                                        </div>
                                    )}

                                    {data.adminOverride?.adminTxHash && (
                                        <div className="retro-panel p-3">
                                            <div className="text-xs text-gray-600 mb-1">Override Transaction</div>
                                            <a
                                                href={`https://testnet-explorer.superposition.so/tx/${data.adminOverride.adminTxHash}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:underline font-mono text-xs"
                                            >
                                                {data.adminOverride.adminTxHash.slice(0, 20)}...{data.adminOverride.adminTxHash.slice(-8)}
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* DISCRETE RESOLUTION DETAILS */}
                        {isDiscrete && discreteData && (
                            <section className="retro-inset p-4">
                                <h2 className="font-bold mb-4 flex items-center gap-2">
                                    📡 Discrete API Resolution
                                    <span className="retro-badge green text-xs">{discreteData.source}</span>
                                </h2>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                    <div className="retro-panel p-3">
                                        <div className="text-xs text-gray-600 mb-1">Extracted Value</div>
                                        <div className="font-mono text-lg font-bold">{String(discreteData.extractedValue)}</div>
                                    </div>
                                    <div className="retro-panel p-3">
                                        <div className="text-xs text-gray-600 mb-1">Comparison</div>
                                        <div className="font-mono text-lg">
                                            {discreteData.extractedValue} {discreteData.operator} {discreteData.targetValue}
                                        </div>
                                    </div>
                                </div>

                                {/* API URL */}
                                {discreteData.apiUrl && (
                                    <div className="retro-panel p-3 mb-4">
                                        <div className="text-xs text-gray-600 mb-1">API Endpoint</div>
                                        <code className="text-xs block bg-gray-100 p-2 rounded overflow-x-auto">
                                            {discreteData.apiUrl}
                                        </code>
                                        <button
                                            onClick={() => runApiTest(discreteData.apiUrl)}
                                            disabled={apiTestLoading}
                                            className="retro-button mt-2 text-sm"
                                        >
                                            {apiTestLoading ? '⏳ Running...' : '▶ Run API Now'}
                                        </button>
                                    </div>
                                )}

                                {/* API Test Result */}
                                {apiTestResult && (
                                    <div className={`retro-panel p-3 mb-4 ${apiTestResult.success ? 'border-green-500' : 'border-red-500'}`}>
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="font-bold text-sm">
                                                {apiTestResult.success ? '✅ API Response (Live)' : '❌ API Error'}
                                            </span>
                                            <span className="text-xs text-gray-500">{apiTestResult.timestamp}</span>
                                        </div>
                                        <pre className="text-xs bg-black text-green-400 p-2 rounded overflow-x-auto max-h-40">
                                            {JSON.stringify(apiTestResult.success ? apiTestResult.data : apiTestResult.error, null, 2)}
                                        </pre>
                                    </div>
                                )}

                                {/* Original API Response */}
                                {discreteData.apiResponse && (
                                    <div className="retro-panel p-3">
                                        <div className="text-xs text-gray-600 mb-1">API Response (At Resolution Time)</div>
                                        <pre className="text-xs bg-black text-green-400 p-2 rounded overflow-x-auto max-h-40">
                                            {JSON.stringify(discreteData.apiResponse, null, 2)}
                                        </pre>
                                    </div>
                                )}

                                {/* Oracle Spec */}
                                {discreteData.oracleSpec && (
                                    <details className="mt-4">
                                        <summary className="cursor-pointer text-sm font-bold">View Oracle Specification</summary>
                                        <pre className="text-xs bg-gray-900 text-blue-300 p-2 rounded overflow-x-auto max-h-60 mt-2">
                                            {JSON.stringify(discreteData.oracleSpec, null, 2)}
                                        </pre>
                                    </details>
                                )}
                            </section>
                        )}

                        {/* CONSORTIUM BREAKDOWN */}
                        {parsedGemini.consortium && (
                            <section className="retro-inset p-4">
                                <h2 className="font-bold mb-4 flex items-center gap-2">
                                    AI Consortium Consensus
                                    <span className="retro-badge">{parsedGemini.consortium.judges} Agents</span>
                                </h2>

                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                    {parsedGemini.consortium.details?.map((vote: any, idx: number) => (
                                        <div key={idx} className="retro-panel p-3 text-center">
                                            <div className="text-xs text-gray-600 mb-1">Agent #{idx + 1}</div>
                                            <div className={`font-bold text-lg ${vote.result === 'YES' ? 'retro-badge green' : vote.result === 'NO' ? 'retro-badge red' : 'retro-badge'}`}>
                                                {vote.result}
                                            </div>
                                            <div className="text-xs text-gray-600 mt-1">Conf: {vote.confidence}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-4 text-center">
                                    <span className="retro-badge text-sm">
                                        Global Tally: <span className="font-bold">{parsedGemini.consortium.tally?.YES || 0} YES</span> vs <span className="font-bold">{parsedGemini.consortium.tally?.NO || 0} NO</span>
                                    </span>
                                </div>
                            </section>
                        )}

                        {/* GROUNDING / SOURCES */}
                        {groundingChunks.length > 0 && (
                            <section className="retro-inset p-4">
                                <h2 className="font-bold mb-4">Search Grounding (Web Evidence)</h2>
                                <div className="retro-panel p-3">
                                    <ul className="space-y-2">
                                        {groundingChunks.map((chunk: any, i: number) => (
                                            chunk.web ? (
                                                <li key={i} className="flex gap-3 text-sm">
                                                    <span className="text-gray-600 w-6 font-mono text-right">{i + 1}.</span>
                                                    <div>
                                                        <a href={chunk.web.uri} target="_blank" className="retro-link block truncate max-w-md">
                                                            {chunk.web.title || chunk.web.uri}
                                                        </a>
                                                    </div>
                                                </li>
                                            ) : null
                                        ))}
                                    </ul>
                                </div>
                                {searchEntry && <div className="mt-4 text-xs text-gray-600" dangerouslySetInnerHTML={{ __html: searchEntry }} />}
                            </section>
                        )}

                        {/* RAW LOGS */}
                        <section>
                            <h3 className="font-bold mb-2 text-sm uppercase">Raw Execution Log</h3>
                            <div className="retro-inset overflow-hidden text-xs">
                                {/* Transaction Tab */}
                                <div className="retro-panel p-2 font-bold border-b-2 border-gray-400">
                                    On-Chain Transaction
                                </div>
                                <div className="p-3 font-mono bg-white">
                                    {data.txHash === "0x0000000000000000000000000000000000000000000000000000000000000000" ? (
                                        <span className="text-orange-600">Simulation Run (No TX)</span>
                                    ) : (
                                        <a href={`https://testnet-explorer.superposition.so/tx/${data.txHash}`} target="_blank" className="retro-link">
                                            {data.txHash} ↗
                                        </a>
                                    )}
                                </div>

                                {/* AI Response Tab */}
                                <div className="retro-panel p-2 font-bold border-b-2 border-t-2 border-gray-400">
                                    Full AI Response Object
                                </div>
                                <pre className="p-3 overflow-x-auto bg-black text-green-400 font-mono max-h-96">
                                    {data.fullGenericResponse ? JSON.stringify(JSON.parse(data.fullGenericResponse), null, 2) : "No raw trace available."}
                                </pre>
                            </div>
                        </section>
                    </div>
                </div>

                {/* Footer */}
                <footer className="text-center text-xs text-gray-600">
                    <div className="retro-panel inline-block p-2">
                        OracleKit Evidence Explorer • Cryptographic Reasoning Engine
                    </div>
                </footer>
            </div>
        </main>
    );
}
