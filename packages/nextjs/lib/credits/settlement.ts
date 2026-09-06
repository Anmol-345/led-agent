import { getAddress, isAddress } from "viem";
import { DEPLOYMENT } from "../deployment";

/**
 * Which chain the credit vault lives on and which token it settles in.
 *
 * Server-only: on testnet the token is a mock deployed per environment, so its address
 * arrives via CREDIT_USDC_ADDRESS rather than being knowable at build time. Both the
 * public config route and the account response read this, so the client is never told
 * one chain while the server uses another.
 */
export type VaultSettlement = {
  chainId: number;
  usdcAddress: `0x${string}`;
};

export function vaultSettlement(
  environment: Record<string, string | undefined> = process.env,
): VaultSettlement {
  // Pinned in the contract on mainnet; supplied per deployment on testnet.
  const configured = DEPLOYMENT.vaultUsdcAddress ?? environment.CREDIT_USDC_ADDRESS?.trim();
  if (!configured || !isAddress(configured)) {
    throw new Error(
      "CREDIT_USDC_ADDRESS must name the deployed credit settlement token on this target.",
    );
  }
  return {
    chainId: DEPLOYMENT.vaultChainId,
    usdcAddress: getAddress(configured),
  };
}
