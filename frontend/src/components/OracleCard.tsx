"use client";

import { useState } from "react";

interface OracleCardProps {
    spec: {
        type: 'DISCRETE' | 'CONTIGUOUS';
        category?: string;
        natural_language_summary: string;
        source?: { name: string };
        extraction_path?: string;
        comparison?: { operator: string; target_value: number | string | boolean };
        resolution_timestamp?: string;
        discrete?: {
            extractedValue: any;
            targetValue: any;
            operator: string;
            source: string;
        };
    } | null;
    resolutionMethod?: 'DISCRETE' | 'CONTIGUOUS' | 'MOCK';
    isFallback?: boolean;
}

export default function OracleCard({ spec, resolutionMethod, isFallback }: OracleCardProps) {
    const [expanded, setExpanded] = useState(false);

    if (!spec) return null;

    const isDiscrete = spec.type === 'DISCRETE';

    return (
        <div className="bg-white border-2 border-black shadow-[4px_4px_0px_0px_#000] mt-4">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b-2 border-black bg-gray-100">
                <div className="flex items-center gap-2">
                    <span className="text-lg">🔮</span>
                    <span className="font-bold text-sm uppercase tracking-wide">Oracle Definition</span>
                </div>
                <div className="flex items-center gap-2">
                    {isFallback && (
                        <span className="text-[10px] bg-yellow-200 border border-yellow-400 px-1.5 py-0.5 font-bold">
                            FALLBACK
                        </span>
                    )}
                    <span className={`text-xs font-bold px-2 py-1 border-2 border-black ${isDiscrete ? 'bg-green-200' : 'bg-purple-200'
                        }`}>
                        {isDiscrete ? '📡 DISCRETE' : '🧠 AI RESOLVED'}
                    </span>
                </div>
            </div>

            {/* Content */}
            <div className="p-3">
                <p className="text-sm text-gray-800 mb-3 leading-relaxed">
                    {spec.natural_language_summary}
                </p>

                {isDiscrete && spec.source && (
                    <div className="text-xs text-gray-600 space-y-1 border-t border-dashed border-gray-300 pt-2">
                        <div className="flex justify-between">
                            <span className="font-bold">Source:</span>
                            <span>{spec.source.name}</span>
                        </div>
                        {spec.extraction_path && (
                            <div className="flex justify-between">
                                <span className="font-bold">Path:</span>
                                <code className="bg-gray-100 px-1">{spec.extraction_path}</code>
                            </div>
                        )}
                        {spec.comparison && (
                            <div className="flex justify-between">
                                <span className="font-bold">Check:</span>
                                <code className="bg-gray-100 px-1">
                                    value {spec.comparison.operator} {String(spec.comparison.target_value)}
                                </code>
                            </div>
                        )}
                        {spec.resolution_timestamp && (
                            <div className="flex justify-between">
                                <span className="font-bold">Resolve At:</span>
                                <span>{new Date(spec.resolution_timestamp).toLocaleString()}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Result Details (if resolved via DISCRETE) */}
                {spec.discrete && (
                    <div className="mt-3 p-2 bg-green-50 border border-green-200 text-xs">
                        <div className="font-bold mb-1 text-green-700">✅ Verified via API:</div>
                        <div className="flex justify-between">
                            <span>Fetched:</span>
                            <code className="font-bold">{String(spec.discrete.extractedValue)}</code>
                        </div>
                        <div className="flex justify-between">
                            <span>Comparison:</span>
                            <code>{spec.discrete.extractedValue} {spec.discrete.operator} {spec.discrete.targetValue}</code>
                        </div>
                    </div>
                )}

                {/* Expand Button */}
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="mt-3 text-xs text-blue-600 hover:underline flex items-center gap-1"
                >
                    {expanded ? '▼ Hide Raw Spec' : '▶ View Raw Spec'}
                </button>

                {expanded && (
                    <pre className="mt-2 p-2 bg-gray-900 text-green-400 text-[10px] overflow-x-auto rounded border border-gray-700 max-h-48 overflow-y-auto">
                        {JSON.stringify(spec, null, 2)}
                    </pre>
                )}
            </div>
        </div>
    );
}
