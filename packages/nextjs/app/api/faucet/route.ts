import { isAddress } from "viem";
import { DEPLOYMENT, chainName } from "@/lib/deployment";

/**
 * Testnet funding information.
 *
 * There is nothing to hand out server-side: native testnet ETH comes from public faucets,
 * and the mock credit USDC exposes a permissionless `mint`, so the user's own wallet sends
 * that transaction and pays its own (free) testnet gas. This route just tells the client
 * where to go and what to call.
 *
 * On mainnet there is no faucet at all — customers bring their own funds.
 */
export function GET() {
  if (!DEPLOYMENT.faucetEnabled) {
    return Response.json(
      { error: "No faucet on the mainnet deployment; fund the wallet with real assets." },
      { status: 403 }
    );
  }

  const usdc = process.env.CREDIT_USDC_ADDRESS?.trim();

  return Response.json({
    ok: true,
    chainId: DEPLOYMENT.vaultChainId,
    chainName: chainName(DEPLOYMENT.vaultChainId),
    // Permissionless mint(address,uint256) on the deployed mock; undefined until deployed.
    mockUsdcAddress: usdc && isAddress(usdc) ? usdc : null,
    mintAmountMicroUsdc: "1000000000", // 1000 USDC at 6 decimals
    faucets: [
      {
        label: "Sepolia ETH — Google Cloud",
        url: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
      },
      {
        label: "Sepolia ETH — Alchemy",
        url: "https://sepoliafaucet.com",
      },
      {
        label: "Sepolia ETH — PoW faucet",
        url: "https://sepolia-faucet.pk910.de",
      },
    ],
  });
}
