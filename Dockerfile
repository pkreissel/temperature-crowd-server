FROM node:22-slim

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/contract/package.json ./packages/contract/

# Install dependencies using pnpm
RUN pnpm install --frozen-lockfile

# Copy source files
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/
COPY packages/contract ./packages/contract

# Set working directory to the API app
WORKDIR /app/apps/api

# Expose the API port
EXPOSE 3000

# Run the app using tsx (which is installed in devDependencies)
CMD ["npx", "tsx", "src/index.ts"]
