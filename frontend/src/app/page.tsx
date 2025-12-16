"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, limit, onSnapshot, doc, getDoc } from "firebase/firestore";
import Link from "next/link";
import OracleCard from "@/components/OracleCard";

interface SettlementDoc {
    id: string;
    statusCode: number;
    question: string;
    geminiResponse: string;
    responseId: string;
    rawJsonString: string;
    txHash: string;
    createdAt: number;
    resolutionMethod?: 'DISCRETE' | 'CONTIGUOUS' | 'MOCK' | 'ADMIN';
    isFallback?: boolean;
    isManualSettlement?: boolean;
    adminOverride?: {
        finalResult: string;
        finalConfidence: number;
        adminSource: string;
        adminComments: string;
        adminTxHash: string;
        overrideTimestamp: number;
    };
}

const ITEMS_LIMIT = 10;
const MARKET_DURATION_SEC = 10; // 10 seconds for fast demo

interface PendingMarket {
    id: string;
    question: string;
    endsAt: number;
    status: string;
    oracleType?: 'DISCRETE' | 'CONTIGUOUS';
}

export default function Home() {
    const [docs, setDocs] = useState<SettlementDoc[]>([]);
    const [loading, setLoading] = useState(true);

    // Demo State
    const [question, setQuestion] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [pendingMarkets, setPendingMarkets] = useState<PendingMarket[]>([]);

    // Oracle Preview Modal State
    const [selectedOracleMarket, setSelectedOracleMarket] = useState<PendingMarket | null>(null);
    const [oracleSpec, setOracleSpec] = useState<any>(null);
    const [loadingOracle, setLoadingOracle] = useState(false);

    // Real-time Firestore Listener
    useEffect(() => {
        const q = query(
            collection(db, "demo"),
            orderBy("createdAt", "desc"),
            limit(ITEMS_LIMIT)
        );
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const docsData = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            } as SettlementDoc));
            setDocs(docsData);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // Settlement Queue - process one at a time
    const [settlingId, setSettlingId] = useState<string | null>(null);

    // Countdown Timer - only marks as "ready" but doesn't trigger directly
    useEffect(() => {
        if (pendingMarkets.length === 0) return;

        const timer = setInterval(() => {
            const now = Math.floor(Date.now() / 1000);

            setPendingMarkets(prev => prev.map(market => {
                const remaining = market.endsAt - now;
                if (remaining <= 0 && market.status === "pending") {
                    return { ...market, status: "ready" };  // Mark ready, don't trigger yet
                }
                return market;
            }));
        }, 1000);

        return () => clearInterval(timer);
    }, [pendingMarkets.length]);

    // Settlement processor - runs one at a time
    useEffect(() => {
        if (settlingId) return; // Already processing one

        const readyMarket = pendingMarkets.find(m => m.status === "ready");
        if (readyMarket) {
            setSettlingId(readyMarket.id);
            triggerSettlement(readyMarket.id).finally(() => {
                setSettlingId(null);
            });
        }
    }, [pendingMarkets, settlingId]);

    // Custom Duration State
    const [useCustomTime, setCustomTime] = useState(false);
    const [useConsortium, setConsortium] = useState(false);
    const [settleDate, setSettleDate] = useState("");

    // Calculate duration preview
    const getDurationPreview = () => {
        if (!settleDate) return "";
        const diff = new Date(settleDate).getTime() - Date.now();
        if (diff < 10000) return "(Too soon - min 10s)";

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `Resolves in ~${days} days ${hours % 24} hours`;
        if (hours > 0) return `Resolves in ~${hours} hours ${minutes % 60} minutes`;
        if (minutes > 0) return `Resolves in ~${minutes} minutes ${seconds % 60} seconds`;
        return `Resolves in ${seconds} seconds`;
    };

    const handleCreate = async () => {
        if (!question) return;

        let duration = MARKET_DURATION_SEC;
        if (useCustomTime && settleDate) {
            const diff = new Date(settleDate).getTime() - Date.now();
            if (diff < 10000) {
                alert("Settlement time must be at least 10 seconds in the future");
                return;
            }
            duration = Math.floor(diff / 1000);
        }

        setIsCreating(true);
        try {
            const res = await fetch("/api/market/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question, duration, isConsortium: useConsortium }),
            });
            const data = await res.json();
            if (data.success) {
                const now = Math.floor(Date.now() / 1000);
                setPendingMarkets(prev => [...prev, {
                    id: data.marketId,
                    question: question,
                    endsAt: now + duration,
                    status: "pending",
                    oracleType: data.oracleType
                }]);
                setQuestion("");
                setSettleDate(""); // Reset time
            } else {
                alert("Error creating market: " + data.error);
            }
        } catch (e: any) {
            alert("Error: " + e.message);
        } finally {
            setIsCreating(false);
        }
    };

    const triggerSettlement = async (marketId: string) => {
        // Update status
        setPendingMarkets(prev => prev.map(m =>
            m.id === marketId ? { ...m, status: "Requesting settlement..." } : m
        ));

        try {
            const res = await fetch("/api/market/settle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ marketId }),
            });

            setPendingMarkets(prev => prev.map(m =>
                m.id === marketId ? { ...m, status: "Running AI..." } : m
            ));

            const data = await res.json();
            if (data.success) {
                setPendingMarkets(prev => prev.map(m =>
                    m.id === marketId ? { ...m, status: "Done! ✓" } : m
                ));
                // Remove after delay
                setTimeout(() => {
                    setPendingMarkets(prev => prev.filter(m => m.id !== marketId));
                }, 2000);
            } else {
                setPendingMarkets(prev => prev.map(m =>
                    m.id === marketId ? { ...m, status: "Error: " + data.error } : m
                ));
            }
        } catch (e: any) {
            setPendingMarkets(prev => prev.map(m =>
                m.id === marketId ? { ...m, status: "Error: " + e.message } : m
            ));
        }
    };

    const formatTime = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const getTimeLeft = (endsAt: number) => {
        const now = Math.floor(Date.now() / 1000);
        return Math.max(0, endsAt - now);
    };

    // Fetch Oracle Spec from Firestore
    const fetchOracleSpec = async (market: PendingMarket) => {
        setSelectedOracleMarket(market);
        setLoadingOracle(true);
        setOracleSpec(null);

        try {
            const docRef = doc(db, "oracle_specs", market.id);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                setOracleSpec(docSnap.data());
            }
        } catch (e) {
            console.error("Failed to fetch oracle spec:", e);
        }
        setLoadingOracle(false);
    };

    const closeOracleModal = () => {
        setSelectedOracleMarket(null);
        setOracleSpec(null);
    };

    return (
        <main className="min-h-screen p-4 md:p-8">
            {/* Header Bar - like 9Lives nav */}
            <header className="retro-panel p-2 mb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-2xl">🔮</span>
                        <span className="text-xl font-bold tracking-tight">OracleKit</span>
                    </div>
                    <span className="text-sm text-gray-600">Prediction Market</span>
                </div>
                <div className="flex items-center gap-4">
                    <Link href="/admin" className="retro-button text-xs px-3 py-1">
                        🔧 Admin
                    </Link>
                    <div className="flex items-center gap-2">
                        <span className="status-dot green"></span>
                        <span className="text-xs">Online</span>
                    </div>
                </div>
            </header>

            <div className="flex flex-col items-center">
                {/* Main Window - Create Market */}
                <div className="w-full max-w-2xl retro-panel mb-6">
                    {/* Title Bar */}
                    <div className="retro-titlebar">
                        <span>Create New Market</span>
                        <div className="flex gap-1">
                            <button className="retro-button px-2 py-0 text-xs">_</button>
                            <button className="retro-button px-2 py-0 text-xs">□</button>
                            <button className="retro-button px-2 py-0 text-xs">×</button>
                        </div>
                    </div>

                    {/* Window Content */}
                    <div className="p-4">
                        <div className="flex gap-2 mb-4">
                            <input
                                type="text"
                                className="retro-input flex-1"
                                placeholder="e.g. Will ETH pass $4000 in 2025?"
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                disabled={isCreating}
                                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                            />
                            <button
                                onClick={handleCreate}
                                disabled={isCreating || !question}
                                className="retro-button retro-button-green font-bold"
                            >
                                {isCreating ? "Creating..." : "Create"}
                            </button>
                        </div>

                        <hr className="retro-divider" />

                        {/* Options */}
                        <div className="mb-4 flex flex-col gap-2">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={useCustomTime}
                                    onChange={e => setCustomTime(e.target.checked)}
                                    className="retro-checkbox"
                                />
                                <span className="text-sm">Set custom settlement time</span>
                            </label>

                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={useConsortium}
                                    onChange={e => setConsortium(e.target.checked)}
                                    className="retro-checkbox"
                                />
                                <span className="text-sm">Enable AI Consortium (5 Voters)</span>
                            </label>
                        </div>

                        {/* Date Picker */}
                        {useCustomTime && (
                            <div className="retro-inset p-3 mb-4">
                                <label className="block text-xs uppercase font-bold mb-2">Resolution Date & Time</label>
                                <input
                                    type="datetime-local"
                                    value={settleDate}
                                    onChange={e => setSettleDate(e.target.value)}
                                    min={new Date(Date.now() + 10000).toISOString().slice(0, 16)}
                                    className="retro-input w-full"
                                />
                                {settleDate && (
                                    <p className="retro-countdown mt-2 inline-block">
                                        {getDurationPreview()}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Pending Markets List */}
                        {pendingMarkets.length > 0 && (
                            <div className="mt-4">
                                <div className="text-xs uppercase font-bold mb-2 flex items-center gap-2">
                                    Pending Markets
                                    <span className="retro-badge">{pendingMarkets.length}</span>
                                </div>
                                <div className="retro-inset p-2 space-y-2">
                                    {pendingMarkets.map(market => (
                                        <div key={market.id} className="retro-panel p-2">
                                            <div className="flex items-center justify-between">
                                                <div className="flex-1 truncate mr-4 text-sm">
                                                    {market.question}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`retro-badge text-xs ${market.oracleType === 'DISCRETE' ? 'green' : ''}`}>
                                                        {market.oracleType === 'DISCRETE' ? '📡' : '🧠'}
                                                    </span>
                                                    <button
                                                        onClick={() => fetchOracleSpec(market)}
                                                        className="retro-button text-xs px-2 py-1"
                                                    >
                                                        🔮 View
                                                    </button>
                                                    <span className="retro-countdown">
                                                        {getTimeLeft(market.endsAt) > 0 ? formatTime(getTimeLeft(market.endsAt)) : '✓'}
                                                    </span>
                                                    <span className="text-xs w-20 text-right truncate">{market.status}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* History Section */}
                <div className="w-full max-w-4xl retro-panel">
                    {/* Title Bar */}
                    <div className="retro-titlebar">
                        <span>Recent Settlements</span>
                        <div className="flex gap-1">
                            <button className="retro-button px-2 py-0 text-xs">_</button>
                            <button className="retro-button px-2 py-0 text-xs">□</button>
                            <button className="retro-button px-2 py-0 text-xs">×</button>
                        </div>
                    </div>

                    <div className="p-4">
                        {loading && (
                            <div className="text-center py-8">
                                <span className="retro-badge">Loading history...</span>
                            </div>
                        )}

                        {!loading && docs.length === 0 && (
                            <div className="text-center py-8 text-gray-600">
                                No settlements yet.
                            </div>
                        )}

                        <div className="space-y-3">
                            {docs.map(doc => {
                                let outcome = "UNKNOWN";
                                let confidence = 0;
                                let parsed: any = {};
                                try {
                                    parsed = JSON.parse(doc.geminiResponse);
                                    outcome = parsed.result;
                                    confidence = parsed.confidence;
                                } catch { }

                                const isSimulated = doc.txHash === "0x0000000000000000000000000000000000000000000000000000000000000000";
                                // Use admin override TX if available, otherwise use original TX
                                const displayTxHash = doc.adminOverride?.adminTxHash || doc.txHash;
                                const explorerUrl = `https://testnet-explorer.superposition.so/tx/${displayTxHash}`;

                                return (
                                    <div key={doc.id} className="retro-panel p-4">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex-1">
                                                <h3 className="font-bold text-base mb-2">{doc.question}</h3>
                                                <div className="flex flex-wrap gap-2 text-xs">
                                                    <Link href={`/audit/${doc.id}`} className="retro-link flex items-center gap-1">
                                                        Ref: {doc.responseId.slice(0, 10)}...
                                                    </Link>
                                                    <span className="retro-badge">
                                                        {new Date(doc.createdAt).toLocaleTimeString()}
                                                    </span>
                                                    {doc.resolutionMethod && (
                                                        <span className={`retro-badge text-xs ${doc.resolutionMethod === 'DISCRETE' ? 'green' : doc.isManualSettlement ? '' : ''}`}
                                                            style={doc.isManualSettlement ? { background: '#9b59b6', color: 'white' } : {}}>
                                                            {doc.isManualSettlement ? '👤 ADMIN' :
                                                                doc.resolutionMethod === 'DISCRETE' ? '📡 API' : '🧠 AI'}
                                                            {doc.isFallback && !doc.isManualSettlement && ' (fallback)'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className={`text-2xl font-bold px-3 py-1 ${outcome === 'YES' ? 'retro-badge green' : outcome === 'NO' ? 'retro-badge red' : 'retro-badge'}`}>
                                                    {outcome}
                                                </div>
                                                <div className="text-xs uppercase tracking-wide mt-2">
                                                    Confidence: {(confidence / 100).toFixed(0)}%
                                                </div>
                                                {parsed?.consortium && (
                                                    <div className="mt-2">
                                                        <span className="retro-badge text-xs">
                                                            Consortium: {parsed.consortium.tally?.YES || 0}Y - {parsed.consortium.tally?.NO || 0}N
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <hr className="retro-divider" />

                                        <div className="retro-inset p-3">
                                            <h4 className="text-xs uppercase font-bold mb-2">On-Chain Proof</h4>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                                <div>
                                                    <div className="text-xs text-gray-600 mb-1">Settlement Transaction</div>
                                                    {isSimulated ? (
                                                        <span className="text-gray-500 italic">Simulated (No on-chain TX)</span>
                                                    ) : (
                                                        <a
                                                            href={explorerUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="retro-link font-mono text-xs"
                                                        >
                                                            {displayTxHash.slice(0, 10)}...{displayTxHash.slice(-8)}
                                                        </a>
                                                    )}
                                                </div>

                                                <div>
                                                    <div className="text-xs text-gray-600 mb-1">OracleKit Evidence ID</div>
                                                    <div className="font-mono text-xs retro-badge truncate max-w-full">
                                                        {doc.responseId}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <footer className="mt-6 text-center text-xs text-gray-600">
                    <div className="retro-panel inline-block p-2">
                        OracleKit Prediction Market Demo • Powered by AI
                    </div>
                </footer>
            </div>

            {/* Oracle Preview Modal */}
            {selectedOracleMarket && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="retro-container max-w-lg w-full max-h-[80vh] overflow-y-auto">
                        <div className="retro-titlebar flex justify-between items-center">
                            <span>🔮 Oracle Definition</span>
                            <button onClick={closeOracleModal} className="text-xl">✕</button>
                        </div>

                        <div className="p-4">
                            <div className="retro-inset p-3 mb-4">
                                <div className="text-sm text-gray-600 mb-1">Market #{selectedOracleMarket.id}</div>
                                <div className="font-medium">{selectedOracleMarket.question}</div>
                                <div className="mt-2">
                                    <span className={`retro-badge text-xs ${selectedOracleMarket.oracleType === 'DISCRETE' ? 'green' : ''}`}>
                                        {selectedOracleMarket.oracleType === 'DISCRETE' ? '📡 DISCRETE' : '🧠 CONTIGUOUS'}
                                    </span>
                                </div>
                            </div>

                            {loadingOracle ? (
                                <div className="text-center py-4 retro-badge">Loading oracle spec...</div>
                            ) : oracleSpec ? (
                                <div>
                                    <div className="retro-panel p-3 mb-3">
                                        <div className="text-xs text-gray-600 mb-1">How this will be resolved:</div>
                                        <p className="text-sm">{oracleSpec.natural_language_summary}</p>
                                    </div>

                                    {oracleSpec.source && (
                                        <div className="retro-panel p-3 mb-3">
                                            <div className="text-xs text-gray-600 mb-1">Data Source</div>
                                            <div className="font-medium">{oracleSpec.source.name}</div>
                                            {oracleSpec.source.url && (
                                                <a href={oracleSpec.source.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline break-all">
                                                    {oracleSpec.source.url}
                                                </a>
                                            )}
                                        </div>
                                    )}

                                    {oracleSpec.extraction_path && (
                                        <div className="retro-panel p-3 mb-3">
                                            <div className="text-xs text-gray-600 mb-1">Data Extraction</div>
                                            <code className="text-xs bg-gray-100 px-2 py-1">{oracleSpec.extraction_path}</code>
                                        </div>
                                    )}

                                    {oracleSpec.comparison && (
                                        <div className="retro-panel p-3 mb-3">
                                            <div className="text-xs text-gray-600 mb-1">Resolution Condition</div>
                                            <code className="text-xs bg-gray-100 px-2 py-1">
                                                value {oracleSpec.comparison.operator} {String(oracleSpec.comparison.target_value)}
                                            </code>
                                        </div>
                                    )}

                                    <details className="mt-4">
                                        <summary className="cursor-pointer text-xs text-blue-600 hover:underline">View Raw Spec</summary>
                                        <pre className="mt-2 p-2 bg-gray-900 text-green-400 text-[10px] overflow-x-auto rounded max-h-48 overflow-y-auto">
                                            {JSON.stringify(oracleSpec, null, 2)}
                                        </pre>
                                    </details>
                                </div>
                            ) : (
                                <div className="retro-inset p-4 text-center text-gray-600">
                                    <p className="mb-2">🧠 AI-Resolved Market</p>
                                    <p className="text-xs">This market will be settled by Gemini AI using web search grounding.</p>
                                </div>
                            )}

                            <button
                                onClick={closeOracleModal}
                                className="retro-button w-full mt-4 py-2"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
