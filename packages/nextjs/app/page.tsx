"use client";

import { useEffect, useState, useRef, useCallback, useId } from "react";
import { useAccount, useChainId, usePublicClient, useSignTypedData, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt, useWalletClient, useWriteContract } from "wagmi";
import { encodeFunctionData, erc20Abi, formatUnits, isAddress, isHex, getAddress, parseUnits, type Address, type Hex } from "viem";
import {
  Bot,
  User,
  Sparkles,
  Send,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Droplets,
  Layers,
  Award,
  TrendingUp,
  ShieldCheck,
  Zap,
  Cpu,
  Activity,
  AlertTriangle,
} from "lucide-react";
import { getPublicClient } from "@wagmi/core";
import { CreditsPanelWithVault } from "@/components/CreditsPanelWithVault";
import { ensureWalletOnChain, type AddChainFn } from "@/lib/chain-switch";
import { wagmiConfig } from "@/lib/wagmi-config";
import {
  DEPLOYMENT,
  ETHEREUM_CHAIN_ID,
  ROBINHOOD_CHAIN_ID,
  chainName,
} from "@/lib/deployment";
import { cn } from "@/lib/utils";

// --- Data Types ---
type StockChip = {
  symbol: string;
  name: string;
  issuer: string;
  chainId: number;
  defaultAddress: Address;
};
type PhilosophyChip = { id: string; investor: string; title: string; method: string };

/**
 * Assets offered in the UI. Every entry was verified to return a live CLASSIC quote from
 * the Trading API; the registry in lib/trading/registry.ts is the authoritative list and
 * will reject anything not present there.
 */
const STOCKS: StockChip[] = [
  { symbol: "NVDA", name: "NVIDIA Corp.", issuer: "Robinhood", chainId: ROBINHOOD_CHAIN_ID, defaultAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { symbol: "TSLA", name: "Tesla Inc.", issuer: "Robinhood", chainId: ROBINHOOD_CHAIN_ID, defaultAddress: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
  { symbol: "AAPL", name: "Apple Inc.", issuer: "Robinhood", chainId: ROBINHOOD_CHAIN_ID, defaultAddress: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
  { symbol: "SPY", name: "S&P 500 ETF", issuer: "Robinhood", chainId: ROBINHOOD_CHAIN_ID, defaultAddress: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" },
  { symbol: "NVDAon", name: "NVIDIA (Ondo)", issuer: "Ondo", chainId: ETHEREUM_CHAIN_ID, defaultAddress: "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE" },
  { symbol: "SPYon", name: "S&P 500 ETF (Ondo)", issuer: "Ondo", chainId: ETHEREUM_CHAIN_ID, defaultAddress: "0xfedc5f4a6c38211c1338aa411018dfaf26612c08" },
];

/** Permissionless mint on the testnet mock USDC (LocalCreditUSDC). */
const MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const PHILOSOPHIES: PhilosophyChip[] = [
  { id: "buffett", investor: "Warren Buffett", title: "Owner Earnings & Economic Moat", method: "owner-earnings" },
  { id: "graham", investor: "Ben Graham", title: "Graham Number & Margin of Safety", method: "graham-number" },
  { id: "munger", investor: "Charlie Munger", title: "Moat & High ROIC Bounded", method: "owner-earnings" },
  { id: "lynch", investor: "Peter Lynch", title: "PEG Ratio & Growth Stories", method: "graham-number" },
  { id: "greenblatt", investor: "Joel Greenblatt", title: "Magic Formula Yield", method: "graham-number" },
  { id: "schloss", investor: "Walter Schloss", title: "Net-Net Asset Backing", method: "graham-number" },
];

type StepStatus = "idle" | "running" | "success" | "error";

type ExecutionStep = {
  id: string;
  title: string;
  detail: string;
  status: StepStatus;
};

type RecommendationData = {
  id: string;
  assetSymbol: string;
  assetAddress: Address;
  assetChainId: number;
  stance: "undervalued" | "fairly-valued" | "overvalued" | "insufficient-basis" | "research-only";
  thesis: string;
  risks: string;
  evidence: Array<{ field: string; value: string; period: string | null }>;
  calculations: Array<{ method: string; result: string | null }>;
  generatedAt: string;
  expiresAt: string;
};

type QuoteData = {
  quoteId: string;
  /** Chain this quote settles on. */
  chainId: number;
  inputToken: Address;
  inputAmount: string;
  outputToken: Address;
  minimumOutput: string;
  fee: {
    bps: number;
    token: Address;
    amount: string;
  };
  transaction?: {
    to: Address;
    data: Hex;
    value: string;
  };
  expiresAt: string;
};

function formatAtomicAmount(raw: string, decimals: number): string {
  try {
    const formatted = formatUnits(BigInt(raw), decimals);
    const numeric = Number(formatted);
    return Number.isFinite(numeric)
      ? numeric.toLocaleString(undefined, { maximumFractionDigits: 6 })
      : formatted;
  } catch {
    return raw;
  }
}

function quoteOutputAmount(quote: QuoteData): string {
  return formatAtomicAmount(quote.minimumOutput, 18);
}

function quoteUnitPrice(quote: QuoteData): string {
  const output = Number(formatAtomicAmount(quote.minimumOutput, 18).replaceAll(",", ""));
  const input = Number(quote.inputAmount);
  return Number.isFinite(input) && Number.isFinite(output) && output > 0
    ? `${(input / output).toFixed(6)} USDC`
    : "Unavailable";
}

/** Quotes are short-lived; submitting expired calldata reverts after gas is already spent. */
function quoteExpired(quote: QuoteData, at: number = Date.now()): boolean {
  const expiry = Date.parse(quote.expiresAt);
  return Number.isFinite(expiry) && expiry <= at;
}

function quoteFeeAmount(quote: QuoteData): string {
  // Settlement tokens (USDC/USDG) are 6dp; equity tokens are 18dp.
  const decimals = quote.fee.token.toLowerCase() === quote.inputToken.toLowerCase() ? 6 : 18;
  return formatAtomicAmount(quote.fee.amount, decimals);
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  // Attached interactive data for assistant messages
  stock?: StockChip;
  philosophy?: PhilosophyChip;
  steps?: ExecutionStep[];
  recommendation?: RecommendationData | null;
  /** The quote that will actually be signed. */
  quote?: QuoteData | null;
  /** Testnet only: real mainnet pricing for the asset the user asked about. */
  displayQuote?: QuoteData | null;
  /** Testnet only: set when the signed swap is not the quoted asset. */
  standIn?: StandInInfo | null;
  /** ERC-20 approval the API says is still owed, or null when none is needed. */
  approval?: RequiredApprovalData | null;
  txHash?: Hex | null;
  tradeConfirmed?: boolean;
  blockNumber?: bigint | null;
  error?: string | null;
};

/** Mirrors RequiredApproval in lib/trading/uniswap.ts. */
type RequiredApprovalData = {
  to: Address;
  data: Hex;
  value: string;
  chainId: number;
};

/** Mirrors StandInExecution in lib/trading/standin.ts. */
type StandInInfo = {
  isStandIn: true;
  quotedSymbol: string;
  quotedChainName: string;
  executedChainId: number;
  executedChainName: string;
  reason: string;
};

/** Testnet stand-in disclosure. This must never be hidden — the user is signing a
 *  different swap from the one being priced. */
function StandInNotice({ standIn }: { standIn: StandInInfo }) {
  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2.5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-300">
          Testnet stand-in trade
        </span>
      </div>
      <p className="mt-1 text-[11px] font-sans leading-snug text-amber-200/90">
        {standIn.reason}
      </p>
    </div>
  );
}

// Animated Pixel Bionic Leg SVG Component
function PixelBionicLeg({ className }: { className?: string }) {
  return (
    <div className={cn("relative flex items-center justify-center p-3", className)}>
      <svg
        viewBox="0 0 120 120"
        className="w-20 h-20 sm:w-24 sm:h-24 text-[#a3e635] filter drop-shadow-[0_0_14px_rgba(163,230,53,0.5)] leg-anim"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="50" y="10" width="20" height="12" rx="2" fill="currentColor" fillOpacity="0.9" />
        <circle cx="60" cy="16" r="3" fill="#0a0b0d" />
        <rect x="54" y="24" width="12" height="28" rx="2" fill="currentColor" fillOpacity="0.8" />
        <line x1="60" y1="26" x2="60" y2="48" stroke="#0a0b0d" strokeWidth="2" strokeDasharray="2 2" />
        <circle cx="60" cy="56" r="8" fill="currentColor" />
        <circle cx="60" cy="56" r="4" fill="#0a0b0d" />
        <rect x="55" y="66" width="10" height="30" rx="2" fill="currentColor" fillOpacity="0.8" />
        <rect x="58" y="70" width="4" height="22" fill="#0a0b0d" />
        <circle cx="60" cy="100" r="5" fill="currentColor" />
        <path d="M50 106 C50 106, 60 108, 75 108 C82 108, 85 104, 85 104" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <circle cx="60" cy="56" r="12" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" className="animate-spin" />
      </svg>
    </div>
  );
}

export default function DemoPage() {
  const { address, isConnected } = useAccount();
  const activeChainId = useChainId();
  const vaultChainId = DEPLOYMENT.vaultChainId;
  const publicClient = usePublicClient({ chainId: vaultChainId });
  const { data: walletClient } = useWalletClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  // Quotes carry ~30s of validity. Tick so the confirm button disables itself when one
  // lapses rather than letting stale calldata be submitted after approvals burnt gas.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Move the wallet to `chainId` before signing there. Credits live on the vault chain;
   * a trade settles on the asset's own chain (or the stand-in chain on testnet), so the
   * two differ routinely and each call site passes what it needs.
   */
  const ensureChain = useCallback(
    async (chainId: number) => {
      await ensureWalletOnChain({
        chainId,
        currentChainId: activeChainId,
        switchChain: switchChainAsync,
        addChain: walletClient
          ? (args => walletClient.request(args as never)) as AddChainFn
          : undefined,
      });
    },
    [activeChainId, switchChainAsync, walletClient],
  );

  // Selected Chip States
  const [selectedStock, setSelectedStock] = useState<StockChip>(STOCKS[0]);
  const [selectedPhilosophy, setSelectedPhilosophy] = useState<PhilosophyChip>(PHILOSOPHIES[0]);
  const [tradeAmount, setTradeAmount] = useState<string>("50");
  const [inputPrompt, setInputPrompt] = useState<string>("");

  // Chat History State
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-msg",
      role: "assistant",
      content:
        "Welcome to Legendary Agent! I am your AI Financial Advisor running decentralized inference on the 0G Compute Network and executing tokenized stock swaps via Uniswap. Pick an asset & investor philosophy or type your prompt below to start.",
      timestamp: new Date(),
    },
  ]);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [activeTxHash, setActiveTxHash] = useState<Hex | null>(null);
  const [activeMsgId, setActiveMsgId] = useState<string | null>(null);

  // Credit Balances & Panel Toggle
  const [availableCredit, setAvailableCredit] = useState<string>("0");
  const [reservedCredit, setReservedCredit] = useState<string>("0");
  const [showManageCredits, setShowManageCredits] = useState<boolean>(false);
  const [isFunding, setIsFunding] = useState<boolean>(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const manageCreditsId = useId();

  // Wait for active transaction receipt
  const { isLoading: isTxPending, isSuccess: isTxSuccess, data: txReceipt } = useWaitForTransactionReceipt({
    hash: activeTxHash ?? undefined,
  });

  // Short Polling for Live Credits
  const fetchCredits = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/credits/balance?wallet=${address}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.available) {
        setAvailableCredit((Number(data.available) / 1_000_000).toFixed(2));
        setReservedCredit((Number(data.reserved) / 1_000_000).toFixed(2));
      }
    } catch {
      // Ignore
    }
  }, [address]);

  useEffect(() => {
    fetchCredits();
    const interval = setInterval(fetchCredits, 4000);
    return () => clearInterval(interval);
  }, [fetchCredits]);

  /**
   * Mint mock credit USDC on the testnet vault chain. /api/faucet only reports where to
   * mint from and which faucets to use; the mint itself is a permissionless call sent from
   * the user's own wallet, so no server-side key or funded donor is involved.
   */
  const fundWallet = useCallback(async () => {
    if (!address) throw new Error("Connect a wallet before funding it.");
    const res = await fetch("/api/faucet");
    const data = (await res.json()) as {
      error?: string;
      mockUsdcAddress?: Address | null;
      mintAmountMicroUsdc?: string;
    };
    if (!res.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Faucet unavailable.");
    }
    if (!data.mockUsdcAddress) {
      throw new Error(
        "Mock credit USDC is not deployed yet — run `just deploy sepolia` and set CREDIT_USDC_ADDRESS.",
      );
    }
    await writeContractAsync({
      abi: MINT_ABI,
      address: data.mockUsdcAddress,
      functionName: "mint",
      args: [address, BigInt(data.mintAmountMicroUsdc ?? "1000000000")],
      chainId: vaultChainId,
    });
    await fetchCredits();
  }, [address, fetchCredits, vaultChainId, writeContractAsync]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  // Watch Onchain Confirmation
  useEffect(() => {
    if (isTxSuccess && txReceipt && activeMsgId && txReceipt.status !== "success") {
      setMessages(prev =>
        prev.map(msg =>
          msg.id === activeMsgId
            ? {
                ...msg,
                steps: (msg.steps || []).map(s =>
                  s.id === "step-5" ? { ...s, status: "error" as StepStatus, detail: "Swap transaction reverted on the Base fork." } : s,
                ),
              }
            : msg,
        ),
      );
      setActiveTxHash(null);
      setActiveMsgId(null);
    } else if (isTxSuccess && txReceipt && activeMsgId) {
      setMessages(prev =>
        prev.map(msg => {
          if (msg.id !== activeMsgId) return msg;
          const updatedSteps = (msg.steps || []).map(s =>
            s.id === "step-5" ? { ...s, status: "success" as StepStatus, detail: `Confirmed in block #${txReceipt.blockNumber}` } : s,
          );
          return {
            ...msg,
            tradeConfirmed: true,
            blockNumber: txReceipt.blockNumber,
            steps: updatedSteps,
          };
        }),
      );
      fetchCredits();
      setActiveTxHash(null);
      setActiveMsgId(null);
    }
  }, [isTxSuccess, txReceipt, activeMsgId, fetchCredits]);

  // Local Faucet Action
  const handleFundWallet = async () => {
    if (!address) return;
    setIsFunding(true);
    try {
      await ensureChain(vaultChainId);
      await fundWallet();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Faucet failed.";
      setMessages(prev => [
        ...prev,
        { id: `funding-error-${Date.now()}`, role: "assistant", content: `Funding error: ${message}`, timestamp: new Date() },
      ]);
    } finally {
      setIsFunding(false);
    }
  };

  // Helper to update specific assistant message step
  const updateMsgStep = (msgId: string, stepId: string, status: StepStatus, detail?: string) => {
    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== msgId || !msg.steps) return msg;
        return {
          ...msg,
          steps: msg.steps.map(s => (s.id === stepId ? { ...s, status, ...(detail ? { detail } : {}) } : s)),
        };
      }),
    );
  };

  // Send Chat Message & Trigger 0G Inference + Credit Handoff + Uniswap Quote
  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputPrompt;
    const finalPrompt = textToSend.trim() || `Analyze ${selectedStock.symbol} using ${selectedPhilosophy.investor}'s ${selectedPhilosophy.title} strategy.`;

    if (!isConnected || !address) {
      setMessages(prev => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: "user",
          content: finalPrompt,
          timestamp: new Date(),
        },
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: "Please connect your Web3 wallet (MetaMask) using the header button to interact with 0G Compute & Uniswap Trading API.",
          timestamp: new Date(),
        },
      ]);
      setInputPrompt("");
      return;
    }

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `asst-${Date.now()}`;

    const initialSteps: ExecutionStep[] = [
      { id: "step-1", title: "Credit Authorization", detail: "Prepare EIP-712 reservation typed data...", status: "running" },
      { id: "step-2", title: "0G Compute Inference", detail: "Querying 0G Decentralized Compute Node...", status: "idle" },
      { id: "step-3", title: "Recommendation Handoff", detail: "Validating ValueInvestingRecommendation.v1...", status: "idle" },
      { id: "step-4", title: "Uniswap API Quote", detail: "Requesting Uniswap Trading API quote on Base...", status: "idle" },
      { id: "step-5", title: "Order Execution", detail: "Submit transaction via MetaMask...", status: "idle" },
    ];

    // Append User & Initial Assistant Message
    setMessages(prev => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: finalPrompt,
        timestamp: new Date(),
        stock: selectedStock,
        philosophy: selectedPhilosophy,
      },
      {
        id: assistantMsgId,
        role: "assistant",
        content: "Initiating 0G Compute inference & financial valuation pipeline...",
        timestamp: new Date(),
        stock: selectedStock,
        philosophy: selectedPhilosophy,
        steps: initialSteps,
      },
    ]);

    setInputPrompt("");
    setIsProcessing(true);

    try {
      // 1. Obtain Advisor Quote & Prepare EIP-712 Typed Data
      const quoteRes = await fetch("/api/advisor/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selectedStock.symbol,
          chainId: selectedStock.chainId,
          wallet: address,
          methods: [selectedPhilosophy.method],
          conversation: [{ role: "user", content: finalPrompt }],
          source: "web",
        }),
      });

      if (!quoteRes.ok) {
        const errData = await quoteRes.json();
        throw new Error(errData.error || "Failed to generate advisor credit quote.");
      }

      const { quote: advQuote } = await quoteRes.json();

      const prepRes = await fetch("/api/advisor/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote: advQuote, wallet: address }),
      });

      if (!prepRes.ok) {
        const errData = await prepRes.json();
        throw new Error(errData.error || "Failed to prepare credit authorization.");
      }

      const prepData = await prepRes.json();
      updateMsgStep(assistantMsgId, "step-1", "running", `Switching wallet to ${chainName(vaultChainId)}...`);
      await ensureChain(vaultChainId);
      // A live session grant already authorizes this charge on-chain, bounded by its cap
      // and expiry, so no per-run signature is needed. Only prompt when it does not cover.
      let customerSignature: Hex = "0x";
      if (prepData.sessionGrantCovers) {
        updateMsgStep(assistantMsgId, "step-1", "running", "Using your standing credit allowance...");
      } else {
        updateMsgStep(assistantMsgId, "step-1", "running", "Awaiting MetaMask EIP-712 signature...");
        // BigInt fields are serialized as strings over JSON; reconstruct before signing.
        try {
          const rawMsg = prepData.typedData.message;
          const reconstitutedMessage = {
            ...rawMsg,
            // EIP-712 uint256 / uint48 fields come back as strings; wagmi needs BigInt
            ...(rawMsg.maximumCharge !== undefined && { maximumCharge: BigInt(rawMsg.maximumCharge) }),
            ...(rawMsg.chainId !== undefined && { chainId: BigInt(rawMsg.chainId) }),
            ...(rawMsg.expiresAt !== undefined && { expiresAt: BigInt(rawMsg.expiresAt) }),
          };
          // MetaMask rejects if EIP712Domain is present in types; strip it out
          const { EIP712Domain: _omit, ...safeTypes } = prepData.typedData.types ?? {};
          customerSignature = await signTypedDataAsync({
            domain: prepData.typedData.domain,
            types: safeTypes,
            primaryType: prepData.typedData.primaryType,
            message: reconstitutedMessage,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : "Signature rejected";
          throw new Error(`MetaMask EIP-712 signature failed: ${reason}`);
        }
      }

      updateMsgStep(
        assistantMsgId,
        "step-1",
        "success",
        prepData.sessionGrantCovers
          ? "Charged against your standing credit allowance."
          : "Credit reservation signed & authorized.",
      );

      // 2. Run 0G Compute Inference & Valuation Engine
      updateMsgStep(assistantMsgId, "step-2", "running", "Executing 0G Compute Router inference...");

      const runRes = await fetch("/api/advisor/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: prepData.action,
          customerSignature,
          quote: advQuote,
          request: {
            conversation: [{ role: "user", content: finalPrompt }],
            chainId: selectedStock.chainId,
            correlationId: advQuote.correlationId,
            methods: [selectedPhilosophy.method],
            selections: [],
            source: "web",
            symbol: selectedStock.symbol,
            wallet: address,
          },
        }),
      });

      if (!runRes.ok) {
        const errData = await runRes.json();
        throw new Error(errData.error || "0G Advisor research run failed.");
      }

      const runData = await runRes.json();
      if (runData.kind !== "completed" || !runData.recommendation) {
        const failureCode = typeof runData.code === "string" ? runData.code : "unknown";
        throw new Error(runData.error || `Advisor run failed during ${failureCode} stage.`);
      }

      updateMsgStep(assistantMsgId, "step-2", "success", "0G Compute inference complete.");
      updateMsgStep(assistantMsgId, "step-3", "success", `Artifact ${runData.recommendation.version} validated.`);

      // Update message content with 0G AI response text & recommendation artifact
      setMessages(prev =>
        prev.map(msg => {
          if (msg.id !== assistantMsgId) return msg;
          return {
            ...msg,
            content: runData.response.interpretation,
            recommendation: runData.recommendation,
          };
        }),
      );

      // 3. Request the quote. No trade transaction is sent until the user confirms the quote card.
      updateMsgStep(assistantMsgId, "step-4", "running", `Fetching executable Uniswap Trading API quote on ${chainName(selectedStock.chainId)}...`);

      const uQuoteRes = await fetch("/api/trades/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionAction: prepData.action,
          recommendation: runData.recommendation,
          assetReference: selectedStock.symbol,
          chainId: selectedStock.chainId,
          amount: tradeAmount,
        }),
      });

      if (!uQuoteRes.ok) {
        const errData = await uQuoteRes.json();
        const reason = typeof errData.error === "string"
          ? errData.error
          : `Uniswap quote unavailable (HTTP ${uQuoteRes.status}).`;
        updateMsgStep(assistantMsgId, "step-4", "error", reason);
        setMessages(prev =>
          prev.map(msg =>
            msg.id === assistantMsgId
              ? { ...msg, content: `Uniswap quote error: ${reason}`, error: reason }
              : msg,
          ),
        );
      } else {
        const uQuoteData = await uQuoteRes.json();
        if (uQuoteData.quote) {
          updateMsgStep(assistantMsgId, "step-4", "success", "Quote ready. Review the amount, price, and fee before confirming.");
          setMessages(prev =>
            prev.map(msg => {
              if (msg.id !== assistantMsgId) return msg;
              return {
                ...msg,
                quote: uQuoteData.quote,
                approval: uQuoteData.approval ?? null,
                displayQuote: uQuoteData.displayQuote ?? null,
                standIn: uQuoteData.standIn ?? null,
              };
            }),
          );
        } else {
          updateMsgStep(assistantMsgId, "step-4", "error", "Quote payload missing.");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Execution error";
      setMessages(prev =>
        prev.map(m => (m.id === assistantMsgId ? { ...m, content: `Error: ${msg}`, error: msg } : m)),
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Submit Trade Transaction via MetaMask
  const handleExecuteTrade = async (
    msgId: string,
    quoteToTrade: QuoteData,
    approvalToSend: RequiredApprovalData | null,
  ) => {
    if (!quoteToTrade || !quoteToTrade.transaction) return;

    if (quoteExpired(quoteToTrade)) {
      updateMsgStep(msgId, "step-4", "error", "Quote expired. Request a fresh quote before trading.");
      return;
    }

    setActiveMsgId(msgId);
    updateMsgStep(msgId, "step-4", "running", "Confirm the USDC approval request in MetaMask...");

    try {
      // The quote knows where it settles — the asset's own chain on mainnet, or the
      // stand-in chain on testnet. Move the wallet there before signing anything.
      const tradeChainId = quoteToTrade.chainId;
      const tradeChain = chainName(tradeChainId);
      updateMsgStep(msgId, "step-4", "running", `Switching wallet to ${tradeChain}...`);
      await ensureChain(tradeChainId);

      if (!address) throw new Error("Connect a wallet before trading.");
      const tradeClient = getPublicClient(wagmiConfig, { chainId: tradeChainId });
      if (!tradeClient) throw new Error(`No RPC configured for ${tradeChain}.`);

      const nativeBalance = await tradeClient.getBalance({ address });
      if (nativeBalance === 0n) {
        throw new Error(
          `Wallet has no gas on ${tradeChain}. Fund it there and retry.`
        );
      }

      // Send the approval the API itself says is outstanding. The spender is version- and
      // chain-dependent, so a hand-built approve to a hardcoded proxy leaves the swap
      // reverting on insufficient allowance. A null approval means the allowance is
      // already sufficient and this step is skipped.
      if (approvalToSend) {
        updateMsgStep(msgId, "step-4", "running", "Confirm the token approval in MetaMask...");
        const approvalHash = await sendTransactionAsync({
          chainId: approvalToSend.chainId,
          to: approvalToSend.to,
          data: approvalToSend.data,
          value: BigInt(approvalToSend.value || "0"),
        });
        const approvalReceipt = await tradeClient.waitForTransactionReceipt({ hash: approvalHash, timeout: 60_000 });
        if (approvalReceipt.status !== "success") throw new Error(`Token approval reverted on ${tradeChain}.`);
        updateMsgStep(msgId, "step-4", "success", `Approval confirmed on ${tradeChain}.`);
      } else {
        updateMsgStep(msgId, "step-4", "success", "Existing allowance is sufficient.");
      }
      // The approval wait allows up to 60s while a quote lives ~30s, so re-check here:
      // signing stale calldata now would revert after the approval already cost gas.
      if (quoteExpired(quoteToTrade)) {
        throw new Error(
          "Quote expired while the approval was confirming. The approval stands; request a fresh quote to trade.",
        );
      }

      updateMsgStep(msgId, "step-5", "running", "Confirm the swap transaction in MetaMask...");

      const hash = await sendTransactionAsync({
        chainId: tradeChainId,
        to: quoteToTrade.transaction.to,
        data: quoteToTrade.transaction.data,
        value: BigInt(quoteToTrade.transaction.value || "0"),
      });

      setActiveTxHash(hash);
      setMessages(prev =>
        prev.map(m => (m.id === msgId ? { ...m, txHash: hash } : m)),
      );
      updateMsgStep(msgId, "step-5", "running", `Tx submitted: ${hash.slice(0, 10)}... (polling receipt)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction rejected";
      updateMsgStep(msgId, "step-4", "error", msg);
      updateMsgStep(msgId, "step-5", "error", msg);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-61px)] bg-[#090a0f] text-[#f3f4f6] font-sans relative overflow-hidden">
      {/* Background Grid & Scanline FX */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-[#a3e635]/0.04_1px,transparent_1px] [background-size:24px_24px] z-0" aria-hidden />
      <div className="fixed inset-0 pointer-events-none bg-gradient-to-b from-[#090a0f] via-transparent to-[#090a0f] opacity-80 z-0" aria-hidden />

      {/* Top 0G Status Bar */}
      <div className="relative z-10 border-b border-[#a3e635]/20 bg-[#0a0b0d]/90 backdrop-blur-md px-4 sm:px-6 py-2.5 flex items-center justify-between shrink-0 text-xs font-mono">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-[#a3e635]/10 border border-[#a3e635]/40 flex items-center justify-center text-[#a3e635]">
            <Cpu className="h-3.5 w-3.5" />
          </div>
          <span className="font-bold text-[#a3e635] uppercase tracking-wider">0G COMPUTE DECENTRALIZED INFERENCE</span>
          <span className="hidden sm:inline text-zinc-500">| {DEPLOYMENT.target} · vault on {chainName(vaultChainId)}</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 text-zinc-400">
            <span className="text-[10px] text-zinc-500 uppercase">Available Credit:</span>
            <span className="font-bold text-[#a3e635]">{availableCredit} USDC</span>
          </div>

          {isConnected && DEPLOYMENT.faucetEnabled && (
            <button
              type="button"
              onClick={handleFundWallet}
              disabled={isFunding}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#a3e635]/40 bg-[#a3e635]/10 text-[11px] font-mono text-[#a3e635] hover:bg-[#a3e635]/20 transition-all disabled:opacity-50"
            >
              <Droplets className={cn("h-3 w-3", isFunding && "animate-spin")} />
              <span>{isFunding ? "Funding..." : "Fund Wallet"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Chat Scroll Area */}
      <div className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scrollbar-thin">
        {messages.map(msg => (
          <div key={msg.id} className={cn("flex gap-3 max-w-4xl mx-auto", msg.role === "user" ? "justify-end" : "justify-start")}>
            {/* Assistant Avatar */}
            {msg.role === "assistant" && (
              <div className="h-8 w-8 rounded-lg bg-[#a3e635]/10 border border-[#a3e635]/40 flex items-center justify-center text-[#a3e635] shrink-0 mt-1 shadow-[0_0_10px_rgba(163,230,53,0.2)]">
                <Bot className="h-4 w-4" />
              </div>
            )}

            {/* Message Bubble */}
            <div className={cn("space-y-3 max-w-2xl w-full", msg.role === "user" ? "items-end" : "items-start")}>
              {/* Context Tag Header for User Messages */}
              {msg.role === "user" && msg.stock && (
                <div className="flex items-center justify-end gap-2 text-[10px] font-mono text-zinc-400">
                  <span className="px-1.5 py-0.5 rounded border border-[#a3e635]/30 bg-[#a3e635]/10 text-[#a3e635]">{msg.stock.symbol}</span>
                  {msg.philosophy && <span className="px-1.5 py-0.5 rounded border border-zinc-800 bg-zinc-900 text-zinc-300">{msg.philosophy.investor}</span>}
                </div>
              )}

              {/* Text Bubble */}
              <div
                className={cn(
                  "p-4 rounded-xl text-xs leading-relaxed font-sans shadow-md border",
                  msg.role === "user"
                    ? "bg-[#a3e635]/10 border-[#a3e635]/40 text-[#f3f4f6] font-mono"
                    : "bg-[#0a0b0d]/90 border-zinc-800 text-zinc-200",
                )}
              >
                {/* 0G Inference Badge for Assistant Messages */}
                {msg.role === "assistant" && msg.id !== "welcome-msg" && (
                  <div className="flex items-center gap-1.5 mb-2.5 text-[10px] font-mono text-[#a3e635] border-b border-zinc-800 pb-2">
                    <Sparkles className="h-3 w-3" />
                    <span>0G Compute Network Node Response</span>
                  </div>
                )}

                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>

              {/* Real Execution Steps Accordion */}
              {msg.steps && msg.steps.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2 text-xs font-mono">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Activity className="h-3 w-3 text-[#a3e635]" />
                    <span>Execution Steps</span>
                  </p>

                  <div className="space-y-1.5">
                    {msg.steps.map(step => (
                      <div
                        key={step.id}
                        className={cn(
                          "p-2 rounded border text-[11px] flex items-center justify-between transition-all",
                          step.status === "running" && "border-[#a3e635]/60 bg-[#a3e635]/5 text-[#a3e635] animate-pulse",
                          step.status === "success" && "border-emerald-500/30 bg-emerald-950/20 text-emerald-300",
                          step.status === "error" && "border-red-500/30 bg-red-950/20 text-red-300",
                          step.status === "idle" && "border-zinc-800/60 text-zinc-500",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {step.status === "running" && <RefreshCw className="h-3 w-3 animate-spin text-[#a3e635]" />}
                          {step.status === "success" && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                          {step.status === "error" && <AlertCircle className="h-3 w-3 text-red-400" />}
                          <span className="font-bold">{step.title}</span>
                        </div>
                        <span className="text-[10px] break-words text-right max-w-[70%] text-zinc-400">{step.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Inline Recommendation Artifact Card */}
              {msg.recommendation && (
                <div className="rounded-xl border border-[#a3e635]/40 bg-[#0a0b0d]/95 p-4 space-y-3 shadow-[0_0_16px_rgba(163,230,53,0.08)]">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                    <div className="flex items-center gap-2">
                      <Award className="h-4 w-4 text-[#a3e635]" />
                      <span className="text-xs font-mono font-bold text-[#f3f4f6]">
                        VALUE INVESTING RECOMMENDATION
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#a3e635]/40 bg-[#a3e635]/10 text-[#a3e635] font-bold uppercase">
                      STANCE: {msg.recommendation.stance}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block">Asset Token</span>
                      <span className="font-bold text-[#a3e635]">{msg.recommendation.assetSymbol}</span>
                    </div>
                    <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block">Chain ID</span>
                      <span className="font-bold text-zinc-200">{msg.recommendation.assetChainId}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase">Valuation Thesis</span>
                    <p className="text-xs text-zinc-300 leading-relaxed font-sans bg-zinc-900/50 p-2.5 rounded border border-zinc-800/80">
                      {msg.recommendation.thesis}
                    </p>
                  </div>
                </div>
              )}

              {/* Inline Uniswap API Quote Review Card */}
              {msg.quote && msg.quote.transaction && !msg.tradeConfirmed && (() => {
                // Prices shown are always the real asset's. On testnet that comes from
                // displayQuote, while msg.quote is the stand-in actually being signed.
                const priced = msg.displayQuote ?? msg.quote;
                const expired = quoteExpired(msg.quote, now);
                return (
                <div className="rounded-xl border border-sky-500/40 bg-[#0a0b0d]/95 p-4 space-y-3 shadow-[0_0_16px_rgba(56,189,248,0.08)]">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-sky-400" />
                      <span className="text-xs font-mono font-bold text-sky-300">
                        UNISWAP TRADING API QUOTE
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-sky-400">
                      {chainName(msg.stock?.chainId ?? priced.chainId)} Route
                    </span>
                  </div>

                  {msg.standIn ? <StandInNotice standIn={msg.standIn} /> : null}

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
                    <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block">Amount</span>
                      <span className="font-bold text-zinc-100">{priced.inputAmount} USDC</span>
                    </div>
                    <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block">Max Unit Price</span>
                      <span className="font-bold text-sky-300">{quoteUnitPrice(priced)} / {msg.stock?.symbol ?? selectedStock.symbol}</span>
                    </div>
                    <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block">Total Price</span>
                      <span className="font-bold text-zinc-100">{priced.inputAmount} USDC</span>
                    </div>
                    <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block">Min. Received</span>
                      <span className="font-bold text-sky-300">{quoteOutputAmount(priced)} {msg.stock?.symbol ?? selectedStock.symbol}</span>
                    </div>
                    <div className="bg-zinc-900/60 p-2 rounded border border-zinc-800 sm:col-span-2">
                      <span className="text-[10px] text-zinc-500 block">Fee</span>
                      <span className="font-bold text-zinc-200">{(priced.fee.bps / 100).toFixed(2)}% (≈ {quoteFeeAmount(priced)} {priced.fee.token.toLowerCase() === priced.outputToken.toLowerCase() ? (msg.stock?.symbol ?? selectedStock.symbol) : "USDC"})</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-400 font-sans">
                    {expired
                      ? "This quote has expired. Ask again to get fresh pricing — submitting stale terms would revert after the approval had already cost gas."
                      : "Review these terms. Nothing is submitted until you press the confirmation button and approve both MetaMask requests."}
                  </p>

                  <button
                    type="button"
                    onClick={() => handleExecuteTrade(msg.id, msg.quote!, msg.approval ?? null)}
                    disabled={expired || (isTxPending && activeMsgId === msg.id)}
                    className="w-full py-2.5 rounded-lg font-mono font-bold text-xs uppercase tracking-wider bg-sky-500 text-slate-950 hover:bg-sky-400 transition-all shadow-[0_0_16px_rgba(56,189,248,0.3)] disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {isTxPending && activeMsgId === msg.id ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Confirming in MetaMask...</span>
                      </>
                    ) : expired ? (
                      <>
                        <AlertCircle className="h-4 w-4" />
                        <span>Quote expired — request a new one</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4" />
                        <span>Confirm Trade via MetaMask</span>
                      </>
                    )}
                  </button>
                </div>
                );
              })()}

              {/* Inline Order-Success Card */}
              {msg.tradeConfirmed && (
                <div className="rounded-xl border border-[#a3e635] bg-[#0a0b0d]/95 p-4 space-y-3 text-center shadow-[0_0_24px_rgba(163,230,53,0.2)]">
                  <PixelBionicLeg />
                  <h4 className="text-xs font-mono font-bold text-[#a3e635] uppercase tracking-wider">
                    {msg.standIn ? "STAND-IN SWAP EXECUTED" : "SWAP EXECUTED SUCCESSFULLY!"}
                  </h4>
                  {msg.standIn ? (
                    <p className="text-left text-[11px] font-sans leading-snug text-amber-200/90">
                      This transaction is a stand-in on {msg.standIn.executedChainName}. No{" "}
                      {msg.standIn.quotedSymbol} was purchased.
                    </p>
                  ) : null}
                  {msg.txHash && (
                    <p className="text-[10px] font-mono text-[#a3e635] break-all bg-zinc-900/80 p-2 rounded border border-zinc-800">
                      Tx: {msg.txHash}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* User Avatar */}
            {msg.role === "user" && (
              <div className="h-8 w-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 shrink-0 mt-1">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}
        <div ref={chatBottomRef} />
      </div>

      {/* Classical Chat Input Area & Quick Chips */}
      <div className="relative z-10 border-t border-zinc-800 bg-[#0a0b0d]/95 backdrop-blur-md p-4 space-y-3 shrink-0">
        {/* Quick Selection Chips */}
        <div className="max-w-4xl mx-auto space-y-2">
          {/* Stock Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1">
            <span className="text-[10px] font-mono text-zinc-500 uppercase shrink-0">Stock Token:</span>
            {STOCKS.map(stock => {
              const active = selectedStock.symbol === stock.symbol;
              return (
                <button
                  key={stock.symbol}
                  type="button"
                  onClick={() => setSelectedStock(stock)}
                  className={cn(
                    "px-2 py-1 rounded text-[11px] font-mono transition-all shrink-0 border",
                    active
                      ? "border-[#a3e635] bg-[#a3e635]/15 text-[#a3e635] font-bold"
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  {stock.symbol}
                </button>
              );
            })}
          </div>

          {/* Philosophy Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1">
            <span className="text-[10px] font-mono text-zinc-500 uppercase shrink-0">Philosophy:</span>
            {PHILOSOPHIES.map(phil => {
              const active = selectedPhilosophy.id === phil.id;
              return (
                <button
                  key={phil.id}
                  type="button"
                  onClick={() => setSelectedPhilosophy(phil)}
                  className={cn(
                    "px-2 py-1 rounded text-[11px] font-mono transition-all shrink-0 border",
                    active
                      ? "border-[#a3e635] bg-[#a3e635]/15 text-[#a3e635] font-bold"
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  {phil.investor}
                </button>
              );
            })}
          </div>
        </div>

        {/* Text Input Box */}
        <div className="max-w-4xl mx-auto flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={inputPrompt}
              onChange={e => setInputPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendMessage();
                }
              }}
              placeholder={`Ask about ${selectedStock.symbol} using ${selectedPhilosophy.investor}'s valuation...`}
              disabled={isProcessing}
              className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-4 py-3 text-xs font-mono text-[#f3f4f6] focus:border-[#a3e635] focus:outline-none placeholder-zinc-500"
            />
          </div>

          {/* Amount Selection */}
          <div className="hidden xs:flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-2.5 text-xs font-mono">
            <input
              type="number"
              value={tradeAmount}
              onChange={e => setTradeAmount(e.target.value)}
              className="w-12 bg-transparent text-right text-zinc-200 focus:outline-none"
            />
            <span className="text-zinc-500 text-[10px]">USDC</span>
          </div>

          <button
            type="button"
            onClick={() => void handleSendMessage()}
            disabled={isProcessing}
            className="px-4 py-3 rounded-xl bg-[#a3e635] text-[#090a0f] font-mono font-bold text-xs hover:bg-[#b5f82a] transition-all shadow-[0_0_16px_rgba(163,230,53,0.3)] disabled:opacity-40 flex items-center gap-1.5 shrink-0"
          >
            {isProcessing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
      </div>

      {/* Bottom Collapsed Manage Credits Panel */}
      <div className="relative z-10 border-t border-zinc-800/80 bg-[#0a0b0d] px-4 py-2 shrink-0">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-zinc-500 uppercase">Customer Credit Vault:</span>
            <span className="text-[#a3e635] font-bold">{availableCredit} USDC Available</span>
            <span className="text-amber-400 font-bold hidden sm:inline">{reservedCredit} USDC Reserved</span>
          </div>

          <button
            type="button"
            onClick={() => setShowManageCredits(!showManageCredits)}
            aria-expanded={showManageCredits}
            aria-controls={manageCreditsId}
            className="text-[11px] font-mono text-zinc-400 hover:text-[#a3e635] flex items-center gap-1 transition-colors"
          >
            <span>{showManageCredits ? "Close Credits" : "Manage Credits"}</span>
            {showManageCredits ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </button>
        </div>

        {showManageCredits && (
          <div id={manageCreditsId} className="max-w-4xl mx-auto pt-3 pb-2 border-t border-zinc-800 mt-2 max-h-[300px] overflow-y-auto">
            <CreditsPanelWithVault />
          </div>
        )}
      </div>
    </div>
  );
}
