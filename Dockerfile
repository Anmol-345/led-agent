# Multi-stage Dockerfile for leg-agent (Node 24.11 + Foundry)

# --- Stage 1: Foundry Base Image ---
FROM ghcr.io/foundry-rs/foundry:latest AS foundry

# --- Stage 2: Node Dependencies & Build Stage ---
FROM node:24.11-alpine AS builder

WORKDIR /app

# Install build tools needed for native sqlite modules if any
RUN apk add --no-xattr --no-cache python3 make g++ git

# Copy root and workspace package files
COPY package.json package-lock.json ./
COPY packages/nextjs/package.json ./packages/nextjs/
COPY packages/foundry/package.json* ./packages/foundry/

# Install Node dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client for credits database
WORKDIR /app/packages/nextjs
ENV PRISMA_CREDIT_GENERATE=true
RUN npm run credits:generate

# Build Next.js application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# --- Stage 3: Production Runtime Stage ---
FROM node:24.11-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN apk add --no-xattr --no-cache sqlite bash

# Copy installed dependencies and built artifacts from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/nextjs/package.json ./packages/nextjs/
COPY --from=builder /app/packages/nextjs/node_modules ./packages/nextjs/node_modules
COPY --from=builder /app/packages/nextjs/.next ./packages/nextjs/.next
COPY --from=builder /app/packages/nextjs/public ./packages/nextjs/public
COPY --from=builder /app/packages/nextjs/prisma ./packages/nextjs/prisma
COPY --from=builder /app/packages/nextjs/scripts ./packages/nextjs/scripts
COPY --from=builder /app/packages/nextjs/lib ./packages/nextjs/lib
COPY --from=builder /app/packages/nextjs/contracts ./packages/nextjs/contracts

# Ensure directory for SQLite database persistence exists
RUN mkdir -p /app/packages/nextjs/prisma/data

EXPOSE 3000

WORKDIR /app/packages/nextjs
CMD ["sh", "-c", "npm run credits:migrate && npm start"]
