import {
  createPublicClient,
  http,
  formatUnits,
  erc20Abi,
} from "viem";
import { getActiveNetwork } from "@/lib/networks";
import { viemChainForNetwork } from "@repo/viem-chain";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const addr = body?.address;
    const chainId = Number(body?.chainId);
    if (typeof addr !== "string" || !/^0x[a-fA-F0-9]{40}$/i.test(addr)) {
      return Response.json({ error: "Invalid address" }, { status: 400 });
    }
    if (!Number.isFinite(chainId)) {
      return Response.json({ error: "Invalid chainId" }, { status: 400 });
    }
    const net = getActiveNetwork();
    if (net.chainId !== chainId) {
      return Response.json(
        { error: "chainId does not match active network in scaffold.config" },
        { status: 400 },
      );
    }
    const chain = viemChainForNetwork(net);
    const client = createPublicClient({
      chain,
      transport: http(net.rpcUrl),
    });
    const wei = await client.getBalance({ address: addr as `0x${string}` });
    const nativeFormatted = formatUnits(wei, net.nativeCurrency.decimals);
    const contracts = net.tokens.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [addr as `0x${string}`],
    }));
    const tokens: {
      symbol: string;
      balance: string;
      decimals: number;
      address: string;
    }[] = [];
    if (contracts.length) {
      const results = await client.multicall({ contracts, allowFailure: true });
      results.forEach((r, i) => {
        const t = net.tokens[i];
        if (r.status === "success") {
          tokens.push({
            symbol: t.symbol,
            balance: formatUnits(r.result as bigint, t.decimals),
            decimals: t.decimals,
            address: t.address,
          });
        } else {
          tokens.push({
            symbol: t.symbol,
            balance: "0",
            decimals: t.decimals,
            address: t.address,
          });
        }
      });
    }
    return Response.json({
      native: {
        symbol: net.nativeCurrency.symbol,
        balance: nativeFormatted,
        decimals: net.nativeCurrency.decimals,
      },
      tokens,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/balances]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
