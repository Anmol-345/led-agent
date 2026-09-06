const path = require("path");
const { loadEnvConfig } = require("@next/env");

// Monorepo app root (…/packages/nextjs → repo root). Avoids wrong inference when a parent folder also has a lockfile.
const projectRoot = path.join(__dirname, "..", "..");

// Load repo-root .env (ONECLAW_VAULT_ID, RPC_URL, …). Next only auto-loads env from packages/nextjs/ otherwise.
loadEnvConfig(projectRoot);

// RainbowKit / wagmi → MetaMask SDK + WalletConnect pull optional deps that break the Next browser bundle.
const stubAsyncStorage = path.join(__dirname, "lib", "stub-async-storage.cjs");
const stubPinoPretty = path.join(__dirname, "lib", "stub-pino-pretty.cjs");
/** Turbopack resolveAlias must be relative to this config file — absolute paths break (./Users/…). */
const nodeBuiltinStubRel = "./lib/node-builtins-browser-stub.cjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native C++ binary modules and Prisma drivers must remain external to Next.js server bundling.
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@prisma/client",
    "prisma",
  ],
  // Silence "multiple lockfiles" / wrong workspace root when developing inside a nested monorepo.
  outputFileTracingRoot: projectRoot,
  // Hide the Next.js dev indicator / dev tools entry in the browser (build & runtime errors still show).
  devIndicators: false,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Tree-shake lucide barrel imports → smaller client chunks (faster subpage loads).
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  transpilePackages: [
    "agent0-sdk",
    "@rainbow-me/rainbowkit",
    "wagmi",
    "@tanstack/react-query",
    "@scaffold-ui/hooks",
    "@scaffold-ui/components",
    "@scaffold-ui/debug-contracts",
    "@ampersend_ai/ampersend-sdk"
  ],
  // agent0-sdk references Node builtins (e.g. fs) for IPFS; browser registration uses wallet + on-chain paths only.
  webpack: (config, { isServer, webpack: webpackApi }) => {
    // MetaMask SDK + WalletConnect: optional deps break resolution from hoisted node_modules — replace at resolve time.
    config.plugins.push(
      new webpackApi.NormalModuleReplacementPlugin(
        /^@react-native-async-storage\/async-storage$/,
        stubAsyncStorage,
      ),
      new webpackApi.NormalModuleReplacementPlugin(/^pino-pretty$/, stubPinoPretty),
    );
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        path: false,
      };
    }
    const prevAlias = config.resolve.alias;
    const nextAlias =
      prevAlias && typeof prevAlias === "object" && !Array.isArray(prevAlias)
        ? { ...prevAlias }
        : {};
    nextAlias["@react-native-async-storage/async-storage"] = stubAsyncStorage;
    nextAlias["@react-native-async-storage/async-storage$"] = stubAsyncStorage;
    nextAlias["pino-pretty"] = stubPinoPretty;
    nextAlias["pino-pretty$"] = stubPinoPretty;
    config.resolve.alias = nextAlias;
    return config;
  },
  // next dev --turbo: aliases must be paths relative to next.config.js (not path.join absolutes).
  turbopack: {
    resolveAlias: {
      fs: nodeBuiltinStubRel,
      net: nodeBuiltinStubRel,
      tls: nodeBuiltinStubRel,
      dns: nodeBuiltinStubRel,
      child_process: nodeBuiltinStubRel,
      // Do not alias path — Turbopack applies resolveAlias on SSR too; Next.js metadata needs real path.join.
      "@react-native-async-storage/async-storage": "./lib/stub-async-storage.cjs",
      "pino-pretty": "./lib/stub-pino-pretty.cjs",
    },
  },
  async redirects() {
    return [
      {
        source: "/favicon.ico",
        destination: "/icon.svg",
        permanent: false,
      },
    ];
  },
};
module.exports = nextConfig;
