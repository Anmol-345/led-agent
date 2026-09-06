#!/usr/bin/env bash
# Live smoke test against BOT Chain mainnet. Exits non-zero on any failure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/.env"

RPC="${BOTCHAIN_RPC:-https://rpc.botchain.ai}"
ADDR="${CREDIT_VAULT_ADDRESS:?set CREDIT_VAULT_ADDRESS}"
DEPLOYER="${DEPLOYER_ADDRESS:?set DEPLOYER_ADDRESS}"

echo "==> Chain ID"
CID=$(cast chain-id --rpc-url "$RPC")
echo "$CID"
[ "$CID" = "677" ] || { echo "WRONG CHAIN"; exit 1; }

echo "==> Contract has code"
CODE=$(cast code "$ADDR" --rpc-url "$RPC")
[ "$CODE" != "0x" ] || { echo "NO CODE"; exit 1; }

echo "==> Deployer balance"
cast balance "$DEPLOYER" --rpc-url "$RPC" --ether

echo "==> Read calls"
cast call "$ADDR" "totalAvailableLiability()(uint256)" --rpc-url "$RPC"
cast call "$ADDR" "totalReservedLiability()(uint256)" --rpc-url "$RPC"
cast call "$ADDR" "unwithdrawnRevenue()(uint256)" --rpc-url "$RPC"
cast call "$ADDR" "usdc()(address)" --rpc-url "$RPC"

echo "==> Access control: stranger pause should fail"
if cast send "$ADDR" "pause()" --private-key 0x0000000000000000000000000000000000000000000000000000000000000001 \
  --rpc-url "$RPC" 2>/dev/null; then
  echo "UNEXPECTED: stranger pause succeeded"; exit 1
fi
echo "stranger pause reverted (expected)"

echo "==> Write: pause then unpause as admin (real txs)"
TX=$(cast send "$ADDR" "pause()" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$RPC" --json | jq -r .transactionHash)
echo "pause tx: https://scan.botchain.ai/tx/$TX"
cast send "$ADDR" "unpause()" --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$RPC" >/dev/null
echo "gasUsed (pause): $(cast receipt "$TX" --rpc-url "$RPC" | grep gasUsed || true)"

echo "ALL CHECKS PASSED"
