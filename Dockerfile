# Use Node.js as base
FROM node:20-slim

# Install dependencies for CRE CLI and Bun
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install CRE CLI
RUN curl -fsSL https://cre.chain.link/install | bash
ENV PATH="/root/.cre/bin:${PATH}"

# Set working directory
WORKDIR /app

# Copy entire project
COPY . .

# Install frontend dependencies
WORKDIR /app/frontend
RUN npm install

# Build Next.js
RUN npm run build

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Start the app
CMD ["npm", "start"]
