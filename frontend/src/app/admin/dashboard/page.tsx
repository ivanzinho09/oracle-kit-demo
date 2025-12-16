"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ethers } from "ethers";

const ABI = [
    "function nextMarketId() view returns (uint256)",
    // Full Market struct: question, marketOpen, marketClose, status, outcome, settledAt, evidenceURI, confidenceBps, predCounts[2], predTotals[2]
    "function getMarket(uint256) view returns (tuple(string question, uint256 marketOpen, uint256 marketClose, uint8 status, uint8 outcome, uint256 settledAt, string evidenceURI, uint16 confidenceBps, uint256[2] predCounts, uint256[2] predTotals))"
];

interface Market {
    id: string;
    question: string;
    marketClose: number;
    status: number; // 0=Open, 1=SettlementRequested, 2=Settled, 3=NeedsManual
    outcome: number; // 0=None, 1=No, 2=Yes, 3=Inconclusive
    isInconclusive?: boolean;
    settlementData?: any;
}

export default function AdminDashboardPage() {
    const [markets, setMarkets] = useState<Market[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
    const [settleForm, setSettleForm] = useState({
        outcome: "YES",
        source: "",
        comments: ""
    });
    const [settling, setSettling] = useState(false);
    const [message, setMessage] = useState("");
    const router = useRouter();

    // Check auth on mount
    useEffect(() => {
        const session = localStorage.getItem("admin_session");
        if (!session) {
            router.push("/admin");
            return;
        }
        loadMarkets();
    }, [router]);

    const loadMarkets = async () => {
        setLoading(true);
        try {
            const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-rpc.superposition.so";
            const marketAddress = process.env.NEXT_PUBLIC_MARKET_ADDRESS;

            if (!marketAddress) {
                console.error("Market address not configured");
                setLoading(false);
                return;
            }

            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const contract = new ethers.Contract(marketAddress, ABI, provider);

            const nextId = await contract.nextMarketId();
            const totalMarkets = Number(nextId);

            const marketList: Market[] = [];

            // Fetch last 50 markets (or all if less)
            const startId = Math.max(1, totalMarkets - 50);

            for (let i = startId; i < totalMarkets; i++) {
                try {
                    const data = await contract.getMarket(i);

                    // Check Firestore for settlement data
                    let settlementData = null;
                    let isInconclusive = false;

                    // Fetch from our API
                    try {
                        const response = await fetch(`/api/admin/market-status?marketId=${i}`);
                        if (response.ok) {
                            const statusData = await response.json();
                            settlementData = statusData.settlement;
                            isInconclusive = statusData.settlement?.result === "INCONCLUSIVE";
                        }
                    } catch (e) {
                        // Ignore fetch errors
                    }

                    marketList.push({
                        id: i.toString(),
                        question: data.question.replace(" [CONSORTIUM]", ""),
                        marketClose: Number(data.marketClose),
                        status: Number(data.status),
                        outcome: Number(data.outcome),
                        isInconclusive,
                        settlementData
                    });
                } catch (e) {
                    console.error(`Failed to fetch market ${i}`, e);
                }
            }

            // Sort: INCONCLUSIVE first, then Open, then by ID descending
            marketList.sort((a, b) => {
                if (a.isInconclusive && !b.isInconclusive) return -1;
                if (!a.isInconclusive && b.isInconclusive) return 1;
                if (a.status === 0 && b.status !== 0) return -1;
                if (a.status !== 0 && b.status === 0) return 1;
                return parseInt(b.id) - parseInt(a.id);
            });

            setMarkets(marketList);
        } catch (e) {
            console.error("Failed to load markets", e);
        }
        setLoading(false);
    };

    const handleSettle = async () => {
        if (!selectedMarket) return;

        setSettling(true);
        setMessage("");

        try {
            const response = await fetch("/api/admin/settle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    marketId: selectedMarket.id,
                    outcome: settleForm.outcome,
                    source: settleForm.source,
                    comments: settleForm.comments,
                    adminPassword: "admin"
                })
            });

            const result = await response.json();

            if (result.success) {
                setMessage(`✅ Market #${selectedMarket.id} settled as ${settleForm.outcome}`);
                setSelectedMarket(null);
                setSettleForm({ outcome: "YES", source: "", comments: "" });
                loadMarkets(); // Refresh
            } else {
                setMessage(`❌ Settlement failed: ${result.error}`);
            }
        } catch (e: any) {
            setMessage(`❌ Error: ${e.message}`);
        }

        setSettling(false);
    };

    const getStatusBadge = (market: Market) => {
        // Status 3 (NeedsManual) from contract = INCONCLUSIVE
        if (market.status === 3 || market.isInconclusive) {
            return <span className="retro-badge" style={{ background: "#ffa500" }}>⚠️ NEEDS MANUAL</span>;
        }
        switch (market.status) {
            case 0: return <span className="retro-badge">🔵 Open</span>;
            case 1: return <span className="retro-badge" style={{ background: "#ffd700" }}>⏳ Pending</span>;
            case 2:
                return market.outcome === 2
                    ? <span className="retro-badge green">✅ YES</span>
                    : <span className="retro-badge red">❌ NO</span>;
            default: return <span className="retro-badge">Unknown</span>;
        }
    };

    const handleLogout = () => {
        localStorage.removeItem("admin_session");
        router.push("/admin");
    };

    return (
        <main className="min-h-screen retro-bg p-4">
            <div className="retro-container max-w-6xl mx-auto">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-2xl font-bold">🛠️ Admin Dashboard</h1>
                        <p className="text-sm text-gray-600">Manage market settlements</p>
                    </div>
                    <div className="space-x-2">
                        <button onClick={loadMarkets} className="retro-button">🔄 Refresh</button>
                        <button onClick={handleLogout} className="retro-button">🚪 Logout</button>
                    </div>
                </div>

                {message && (
                    <div className="retro-panel p-3 mb-4">
                        {message}
                    </div>
                )}

                {/* Market List */}
                <div className="retro-inset p-4">
                    <h2 className="font-bold mb-4">Markets ({markets.length})</h2>

                    {loading ? (
                        <div className="text-center py-8">Loading markets...</div>
                    ) : markets.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">No markets found</div>
                    ) : (
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                            {markets.map((market) => (
                                <div
                                    key={market.id}
                                    className={`retro-panel p-3 cursor-pointer hover:bg-gray-100 ${market.isInconclusive ? 'border-orange-500 border-2' : ''
                                        }`}
                                    onClick={() => setSelectedMarket(market)}
                                >
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1">
                                            <div className="font-bold text-sm">#{market.id}</div>
                                            <div className="text-sm">{market.question}</div>
                                        </div>
                                        <div className="text-right">
                                            {getStatusBadge(market)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Settlement Modal */}
                {selectedMarket && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                        <div className="retro-container max-w-lg w-full">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="font-bold text-lg">Manual Settlement</h2>
                                <button
                                    onClick={() => setSelectedMarket(null)}
                                    className="text-xl"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="retro-inset p-3 mb-4">
                                <div className="text-sm text-gray-600">Market #{selectedMarket.id}</div>
                                <div className="font-medium">{selectedMarket.question}</div>
                                <div className="mt-2">{getStatusBadge(selectedMarket)}</div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">Outcome *</label>
                                    <select
                                        value={settleForm.outcome}
                                        onChange={(e) => setSettleForm({ ...settleForm, outcome: e.target.value })}
                                        className="retro-input w-full"
                                    >
                                        <option value="YES">YES - Event happened</option>
                                        <option value="NO">NO - Event did not happen</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">Source / Evidence *</label>
                                    <input
                                        type="text"
                                        value={settleForm.source}
                                        onChange={(e) => setSettleForm({ ...settleForm, source: e.target.value })}
                                        className="retro-input w-full"
                                        placeholder="e.g., https://example.com/news-article"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">Admin Comments</label>
                                    <textarea
                                        value={settleForm.comments}
                                        onChange={(e) => setSettleForm({ ...settleForm, comments: e.target.value })}
                                        className="retro-input w-full h-24 resize-none"
                                        placeholder="Explain the reasoning for this settlement..."
                                    />
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={handleSettle}
                                        disabled={settling || !settleForm.source}
                                        className="retro-button flex-1 py-3"
                                    >
                                        {settling ? "Settling..." : "⚖️ Confirm Settlement"}
                                    </button>
                                    <button
                                        onClick={() => setSelectedMarket(null)}
                                        className="retro-button"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="mt-6 text-center">
                    <a href="/" className="text-sm text-blue-600 hover:underline">
                        ← Back to Markets
                    </a>
                </div>
            </div>
        </main>
    );
}
