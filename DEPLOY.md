# Railway Deployment

## Quick Deploy

1. **Install Railway CLI:**
   ```bash
   npm install -g @railway/cli
   railway login
   ```

2. **Initialize Project:**
   ```bash
   cd /path/to/cre-gcp-prediction-market-demo
   railway init
   ```

3. **Set Environment Variables (in Railway Dashboard):**
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`  
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_MARKET_ADDRESS`
   - `CRE_ETH_PRIVATE_KEY`
   - `RPC_URL`
   - `GEMINI_API_KEY_VAR`
   - `FIREBASE_API_KEY_VAR`
   - `FIREBASE_PROJECT_ID_VAR`

4. **Deploy:**
   ```bash
   railway up
   ```

5. **Get Public URL:**
   ```bash
   railway domain
   ```

## Files Created
- `Dockerfile` - Container config with Node.js, Bun, and CRE CLI
- `railway.json` - Railway-specific settings
