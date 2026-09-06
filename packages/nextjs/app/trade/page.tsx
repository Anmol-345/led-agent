import { TradePanel } from "@/components/trading/TradePanel";

export const metadata = {
  title: "Tokenized Stock Trading | Leg Agent",
  description: "Trade recommendation-bound tokenized stocks with server-validated quotes and direct 10 bps Uniswap integrator fee.",
};

export default function TradePage() {
  return (
    <main className="container mx-auto py-8 px-4">
      <div className="text-center max-w-xl mx-auto mb-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Leg Trading
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Turn value-investing recommendations into customer-confirmed trades on supported chains.
        </p>
      </div>
      <TradePanel />
    </main>
  );
}
