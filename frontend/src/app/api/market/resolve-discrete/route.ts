import { NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { DiscreteOracleSpec, OracleSpec } from "@/lib/oracle-types";

// Firebase Init
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};
const app = getApps().length === 0 ? initializeApp(firebaseConfig, "resolve-discrete-route") : getApps()[0];
const db = getFirestore(app);

/**
 * Simple JSONPath-like value extractor using dot notation.
 * Supports: $.foo.bar, foo.bar, $[0].bar, etc.
 */
function extractValue(data: any, path: string): any {
    // Normalize path: remove leading $. if present
    let cleanPath = path.replace(/^\$\.?/, '');

    // Split by dots or bracket notation
    const parts = cleanPath.split(/\.|\[['"]?|['"]?\]/).filter(Boolean);

    let current = data;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}

/**
 * Execute a Discrete Oracle resolution.
 * Fetches data from the configured API, extracts the value, and applies the comparison.
 */
export async function POST(request: Request) {
    try {
        const { marketId } = await request.json();
        if (!marketId) {
            return NextResponse.json({ error: "marketId required" }, { status: 400 });
        }

        // 1. Fetch Oracle Spec from Firestore
        const specDoc = await getDoc(doc(db, "oracle_specs", marketId));
        if (!specDoc.exists()) {
            return NextResponse.json({
                error: "No Oracle Spec found for this market",
                fallback: true,
                fallbackReason: "SPEC_NOT_FOUND"
            }, { status: 404 });
        }

        const specData = specDoc.data();
        const oracleSpec: OracleSpec = JSON.parse(specData.spec);

        if (oracleSpec.type !== "DISCRETE") {
            return NextResponse.json({
                error: "Market is not DISCRETE type",
                fallback: true,
                fallbackReason: "CONTIGUOUS_TYPE"
            }, { status: 400 });
        }

        const discreteSpec = oracleSpec as DiscreteOracleSpec;
        console.log(`[Discrete] Resolving Market #${marketId} via ${discreteSpec.source.name} (${discreteSpec.category})`);

        // 2. Build API URL - handle category-specific patterns
        let url: URL;
        let sportsTeamData: any = null; // Store sports context for response

        if (discreteSpec.category === 'WEATHER') {
            // wttr.in uses city in URL path: https://wttr.in/NewYork?format=j1
            const cityFromPath = discreteSpec.source.params?.city ||
                discreteSpec.source.endpoint.split('/').pop() ||
                'NewYork';
            url = new URL(`https://wttr.in/${cityFromPath}?format=j1`);
        } else if (discreteSpec.category === 'SPORTS_SCORE') {
            // Two-step sports resolution:
            // 1. Search for team to get ID
            // 2. Get last events
            const teamName = discreteSpec.source.params?.team_search ||
                discreteSpec.source.params?.t ||
                'Lakers';

            console.log(`[Discrete] SPORTS: Searching for team "${teamName}"`);

            // Step 1: Search team
            const searchUrl = `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(teamName)}`;
            const searchResponse = await fetch(searchUrl);

            if (!searchResponse.ok) {
                console.error(`[Discrete] Team search failed: ${searchResponse.status}`);
                return NextResponse.json({
                    error: `Team search failed: ${searchResponse.status}`,
                    fallback: true,
                    fallbackReason: "SPORTS_TEAM_SEARCH_FAILED"
                }, { status: 502 });
            }

            const searchData = await searchResponse.json();
            if (!searchData.teams || searchData.teams.length === 0) {
                console.error(`[Discrete] Team not found: ${teamName}`);
                return NextResponse.json({
                    error: `Team not found: ${teamName}`,
                    fallback: true,
                    fallbackReason: "SPORTS_TEAM_NOT_FOUND"
                }, { status: 404 });
            }

            const teamId = searchData.teams[0].idTeam;
            const teamFullName = searchData.teams[0].strTeam;
            console.log(`[Discrete] SPORTS: Found team ${teamFullName} (ID: ${teamId})`);

            // Step 2: Get last events
            url = new URL(`https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=${teamId}`);
            sportsTeamData = {
                teamId,
                teamName: teamFullName,
                searchQuery: teamName
            };
        } else {
            url = new URL(discreteSpec.source.endpoint);
            if (discreteSpec.source.params) {
                Object.entries(discreteSpec.source.params).forEach(([key, value]) => {
                    url.searchParams.append(key, value);
                });
            }
        }

        // 3. Fetch Data
        const response = await fetch(url.toString(), {
            headers: discreteSpec.source.headers || {}
        });

        if (!response.ok) {
            console.error(`[Discrete] API call failed: ${response.status}`);
            return NextResponse.json({
                error: `API call failed: ${response.status}`,
                fallback: true,
                fallbackReason: "API_ERROR"
            }, { status: 502 });
        }

        const data = await response.json();
        console.log(`[Discrete] API Response:`, JSON.stringify(data).slice(0, 200));

        // 4. Extract Value - handle SPORTS_SCORE specially
        let extractedValue: any;
        let sportsContext: any = null;

        if (discreteSpec.category === 'SPORTS_SCORE' && sportsTeamData) {
            // For sports, determine if the team won their last game
            const lastEvent = data.results?.[0];
            if (!lastEvent) {
                console.error(`[Discrete] No last event found for team`);
                return NextResponse.json({
                    error: "No recent games found",
                    fallback: true,
                    fallbackReason: "NO_RECENT_GAMES"
                }, { status: 500 });
            }

            const homeTeam = lastEvent.strHomeTeam;
            const awayTeam = lastEvent.strAwayTeam;
            const homeScore = parseInt(lastEvent.intHomeScore) || 0;
            const awayScore = parseInt(lastEvent.intAwayScore) || 0;
            const teamName = sportsTeamData.teamName;

            // Determine if our team won
            const isHomeTeam = homeTeam.toLowerCase().includes(teamName.toLowerCase()) ||
                teamName.toLowerCase().includes(homeTeam.toLowerCase());
            const teamScore = isHomeTeam ? homeScore : awayScore;
            const opponentScore = isHomeTeam ? awayScore : homeScore;
            const teamWon = teamScore > opponentScore;

            extractedValue = teamWon;
            sportsContext = {
                event: lastEvent.strEvent,
                date: lastEvent.dateEvent,
                homeTeam,
                awayTeam,
                homeScore,
                awayScore,
                ourTeam: teamName,
                isHomeTeam,
                teamScore,
                opponentScore,
                result: teamWon ? 'WIN' : (teamScore === opponentScore ? 'DRAW' : 'LOSS')
            };

            console.log(`[Discrete] SPORTS: ${teamName} ${sportsContext.result} (${teamScore}-${opponentScore}) in ${lastEvent.strEvent}`);
        } else {
            try {
                extractedValue = extractValue(data, discreteSpec.extraction_path);
            } catch (extractError) {
                console.error(`[Discrete] Value extraction failed`, extractError);
                return NextResponse.json({
                    error: "Value extraction failed",
                    fallback: true,
                    fallbackReason: "EXTRACTION_ERROR"
                }, { status: 500 });
            }
        }

        if (extractedValue === null || extractedValue === undefined) {
            console.error(`[Discrete] No value found at path: ${discreteSpec.extraction_path}`);
            return NextResponse.json({
                error: "No value at extraction path",
                fallback: true,
                fallbackReason: "NO_VALUE"
            }, { status: 500 });
        }

        console.log(`[Discrete] Extracted value: ${extractedValue}`);

        // 5. Apply Comparison
        const { operator, target_value } = discreteSpec.comparison;
        let result: boolean;

        // For SPORTS, extractedValue is already a boolean (teamWon)
        if (discreteSpec.category === 'SPORTS_SCORE' && typeof extractedValue === 'boolean') {
            result = extractedValue; // true = win, false = loss/draw
        } else {
            switch (operator) {
                case '>':
                    result = extractedValue > target_value;
                    break;
                case '<':
                    result = extractedValue < target_value;
                    break;
                case '>=':
                    result = extractedValue >= target_value;
                    break;
                case '<=':
                    result = extractedValue <= target_value;
                    break;
                case '==':
                    result = extractedValue == target_value;
                    break;
                case '!=':
                    result = extractedValue != target_value;
                    break;
                default:
                    result = false;
            }
        }

        const outcome = result ? "YES" : "NO";
        const confidence = 10000; // Discrete resolutions are deterministic = 100%

        console.log(`[Discrete] Comparison: ${extractedValue} ${operator} ${target_value} = ${result} => ${outcome}`);

        return NextResponse.json({
            success: true,
            outcome: outcome,
            confidence: confidence,
            extractedValue: extractedValue,
            targetValue: target_value,
            operator: operator,
            source: discreteSpec.source.name,
            fallback: false,
            // Additional data for Evidence Explorer
            apiResponse: data,
            oracleSpec: discreteSpec,
            apiUrl: url.toString(),
            // Sports-specific context
            ...(sportsContext && { sportsContext })
        });

    } catch (error: any) {
        console.error("[Discrete] Resolution failed", error);
        return NextResponse.json({
            error: error.message,
            fallback: true,
            fallbackReason: "UNKNOWN_ERROR"
        }, { status: 500 });
    }
}
