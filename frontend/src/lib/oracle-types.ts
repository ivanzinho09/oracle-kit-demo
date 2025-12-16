// Oracle Spec Types for Structured Natural Language Oracle Language (SNLOL)

export type OracleCategory =
    | 'CRYPTO_PRICE'
    | 'FOREX_RATE'
    | 'WEATHER'
    | 'SPORTS_SCORE'
    | 'DATE_EVENT'
    | 'GENERAL_AI';

export type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==' | '!=';

export interface OracleSourceConfig {
    name: string;           // Human-readable name (e.g., "CoinGecko")
    endpoint: string;       // Full API URL
    params?: Record<string, string>; // Query parameters
    headers?: Record<string, string>; // Optional headers (for auth)
}

export interface DiscreteOracleSpec {
    type: 'DISCRETE';
    category: OracleCategory;
    natural_language_summary: string;
    source: OracleSourceConfig;
    extraction_path: string; // JSONPath expression (e.g., "$.bitcoin.usd")
    comparison: {
        operator: ComparisonOperator;
        target_value: number | string | boolean;
    };
    resolution_timestamp: string; // ISO 8601 format
}

export interface ContiguousOracleSpec {
    type: 'CONTIGUOUS';
    category: 'GENERAL_AI';
    natural_language_summary: string;
}

export type OracleSpec = DiscreteOracleSpec | ContiguousOracleSpec;

export interface OracleClassification {
    type: 'DISCRETE' | 'CONTIGUOUS';
    category: OracleCategory;
    reason: string;
}

// Whitelist of trusted data sources
export const TRUSTED_SOURCES: Record<OracleCategory, OracleSourceConfig | null> = {
    CRYPTO_PRICE: {
        name: 'CoinGecko',
        endpoint: 'https://api.coingecko.com/api/v3/simple/price',
        params: {}
    },
    FOREX_RATE: {
        name: 'ExchangeRate-API',
        endpoint: 'https://open.er-api.com/v6/latest/USD',
        params: {}
    },
    WEATHER: {
        name: 'wttr.in',
        endpoint: 'https://wttr.in', // City appended to path
        params: {}
    },
    SPORTS_SCORE: {
        name: 'TheSportsDB',
        endpoint: 'https://www.thesportsdb.com/api/v1/json/3/searchteams.php',
        params: {}
    },
    DATE_EVENT: null, // Handled via static logic or Calendarific
    GENERAL_AI: null  // No API source, uses Gemini + Search
};

