# BOT Chain port — submission draft
# Fill after you provide: hackathon name, tracks, deadline, judging criteria.

## Status

| Item | State |
|------|--------|
| License / ATTRIBUTION | Done |
| Deployer wallet | Created (see chat for public address) |
| Contract migration | Done — `DeployBotchain.s.sol` |
| Testnet deploy | Pending faucet funding |
| Mainnet deploy | Blocked until you type `approved for mainnet` |
| Frontend BOT wiring | Done (target `botchain` / `botchain-testnet`) |
| DESIGN.md | Written — awaiting your OK before deep visual polish |
| Ecosystem tier | Not Tier 1 yet (traction rewards, not seed) |

## Problem

Investors want legendary-investor style advice with onchain credit settlement, but L2 fees and slow confirmation UX kill agent micropayments.

## Solution

leg-agent: AI advisor + `CustomerCreditVault` on BOT Chain (sub-second blocks, ~$0.002 gas).

## Why BOT Chain specifically

Sub-second finality and tiny fees make per-turn credit reservations practical; EVM-compatible so vault Solidity ports unchanged.

## Built vs inherited

See [ATTRIBUTION.md](./ATTRIBUTION.md).

## Tech stack

Next.js, Foundry, viem/wagmi, 0G inference router, Uniswap Trading API (quotes; fills still stand-in off BOT).

## Live addresses

(Populate after deploy — see `deployments/botchain-677.json` / `968`.)

## Ecosystem honesty

Scheme A needs a tradeable token + LP — we do not ship that yet.  
Scheme C needs thousands of valid users — not cleared.  
Near-term value: technical help, DApp store, incubator — apply at ecosystem@botchain.info.
