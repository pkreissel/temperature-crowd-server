FROM oven/bun:alpine

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/contract/package.json ./packages/contract/

# Install dependencies
RUN bun install

# Copy source files
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/
COPY packages/contract ./packages/contract

# Set working directory to the API app
WORKDIR /app/apps/api

# Expose the API port
EXPOSE 3000

# Run the app
CMD ["bun", "src/index.ts"]
