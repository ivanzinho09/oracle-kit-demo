#!/bin/bash

# Configuration
RPC_URL="https://0xrpc.io/sep"
MARKET_ADDRESS="0x5De80647572bE8B6a9ba1350CDf3dB9f95B4F266"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check for .env file
if [ -f "cre-workflow/.env" ]; then
    source cre-workflow/.env
else
    echo "Error: .env file not found in cre-workflow/"
    exit 1
fi

if [ -z "$CRE_ETH_PRIVATE_KEY" ]; then
    echo "Error: CRE_ETH_PRIVATE_KEY not set in .env"
    exit 1
fi

# 1. Get Question
echo -e "${BLUE}=== CRE Prediction Market Demo ===${NC}"
echo "Enter your prediction market question (e.g. 'Will it rain in London tomorrow?'):"
read QUESTION

if [ -z "$QUESTION" ]; then
    echo "Error: Question cannot be empty"
    exit 1
fi

# 2. Get Next Market ID
echo -e "\n${YELLOW}Step 1: Checking next Market ID...${NC}"
NEXT_ID_HEX=$(cast call $MARKET_ADDRESS "nextMarketId()" --rpc-url $RPC_URL)
NEXT_ID=$(cast to-dec $NEXT_ID_HEX)
echo "Next Market ID: $NEXT_ID"

# 3. Create Market
echo -e "\n${YELLOW}Step 2: Creating Market...${NC}"
echo "Submitting transaction..."
cast send $MARKET_ADDRESS "newMarket(string)" "$QUESTION" --rpc-url $RPC_URL --private-key $CRE_ETH_PRIVATE_KEY

echo -e "${GREEN}Market $NEXT_ID created!${NC}"

# 4. Wait for Market Close
echo -e "\n${YELLOW}Step 3: Waiting for market to close (3 minutes)...${NC}"
echo "This is enforced by the smart contract. Feel free to grab a coffee ☕"

for i in {180..1}; do 
    printf "\rTime remaining: %2d seconds" $i
    sleep 1
done
echo -e "\n${GREEN}Market closed!${NC}"

# 5. Request Settlement
echo -e "\n${YELLOW}Step 4: Requesting Settlement...${NC}"
SETTLEMENT_TX=$(cast send $MARKET_ADDRESS "requestSettlement(uint256)" $NEXT_ID --rpc-url $RPC_URL --private-key $CRE_ETH_PRIVATE_KEY --json | jq -r .transactionHash)

if [ -z "$SETTLEMENT_TX" ] || [ "$SETTLEMENT_TX" == "null" ]; then
    echo "Error: Failed to get transaction hash. Check if you have enough ETH."
    exit 1
fi

echo "Settlement Requested. Tx Hash: $SETTLEMENT_TX"

# 6. Run CRE Simulation
echo -e "\n${YELLOW}Step 5: Running CRE Simulation...${NC}"
echo "Simulating Chainlink Runtime Environment..."

export PATH="$HOME/.bun/bin:$HOME/.cre/bin:$PATH"
cd cre-workflow
cre workflow simulate prediction-market-demo --target local-simulation --evm-tx-hash $SETTLEMENT_TX --evm-event-index 0 --trigger-index 0 --non-interactive

echo -e "\n${GREEN}=== Demo Complete! ===${NC}"
echo "Check the frontend at http://localhost:3000 to see the result."
echo "(Ensure you are running 'bun run dev' in the frontend folder)"
