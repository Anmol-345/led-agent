"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  erc20Abi,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { CUSTOMER_CREDIT_VAULT_ABI } from "@/contracts/generatedAbis";
import {
  checkCreditTransactionReceipt,
  createSerialTaskQueue,
  creditTransactionScopeMatches,
  creditTransactionStorageKey,
  parsePersistedCreditTransaction,
  parseUsdcAmount,
  type CreditTransactionState,
} from "@/lib/credits/ui";
import {
  DEPLOYMENT,
  SETTLEMENT_TOKEN_LABEL,
  chainName,
  explorerAddressUrl,
  explorerTxUrl,
} from "@/lib/deployment";

// The vault chain follows the deployment target (Base on mainnet, Sepolia on testnet).
// The settlement token is passed in, because on testnet it is a mock deployed per
// environment and only the server knows its address.
const VAULT_CHAIN_ID = DEPLOYMENT.vaultChainId;
const VAULT_CHAIN_NAME = chainName(VAULT_CHAIN_ID);
const USDC_DECIMAL_PATTERN = /^\d+\.\d{6}$/;

const usageItemSchema = z.object({
  authorizationId: z.string(),
  correlationId: z.string(),
  serviceType: z.string(),
  status: z.string(),
  rejectionReason: z.string().nullable(),
  maximumChargeUsdc: z.string().regex(USDC_DECIMAL_PATTERN),
  customerChargeUsdc: z.string().regex(USDC_DECIMAL_PATTERN),
  components: z
    .object({
      zeroG: z.string().regex(USDC_DECIMAL_PATTERN),
      fmp: z.string().regex(USDC_DECIMAL_PATTERN),
      legService: z.string().regex(USDC_DECIMAL_PATTERN),
    })
    .nullable(),
  corrections: z.array(
    z.object({
      id: z.string(),
      reason: z.string(),
      totalUsdc: z.string().regex(USDC_DECIMAL_PATTERN),
      components: z.object({
        zeroG: z.string().regex(USDC_DECIMAL_PATTERN),
        fmp: z.string().regex(USDC_DECIMAL_PATTERN),
        legService: z.string().regex(USDC_DECIMAL_PATTERN),
      }),
      createdAt: z.string(),
    }),
  ),
  createdAt: z.string().nullable(),
  expiresAt: z.string(),
});

const accountDataSchema = z.object({
  wallet: z.string(),
  baseChainId: z.literal(VAULT_CHAIN_ID),
  baseUsdcAddress: z.string(),
  availableUsdc: z.string().regex(USDC_DECIMAL_PATTERN),
  providerEligibleUsdc: z.string().regex(USDC_DECIMAL_PATTERN),
  reservedUsdc: z.string().regex(USDC_DECIMAL_PATTERN),
  pendingDepositsUsdc: z.string().regex(USDC_DECIMAL_PATTERN),
  depositActivity: z.array(
    z.object({
      transactionHash: z.string(),
      amountUsdc: z.string().regex(USDC_DECIMAL_PATTERN),
      finality: z.string(),
      reason: z.string().nullable(),
      observedAt: z.string(),
    }),
  ),
  usageHistory: z.array(usageItemSchema),
});

const challengeSchema = z.object({
  challengeId: z.string().min(1),
  message: z.string().min(1),
  expiresAt: z.string(),
});

const errorSchema = z.object({ error: z.string().optional() });

export type AccountData = z.infer<typeof accountDataSchema>;
type Tab = "overview" | "deposit" | "withdraw" | "history";
const tabs: readonly Tab[] = ["overview", "deposit", "withdraw", "history"];

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = errorSchema.safeParse(await response.json());
    return parsed.success && parsed.data.error ? parsed.data.error : fallback;
  } catch {
    return fallback;
  }
}

function statusClasses(status?: string): string {
  if (!status) return "bg-slate-700 text-slate-400";
  switch (status.toLowerCase()) {
    case "settled":
      return "bg-emerald-500/10 text-emerald-400";
    case "reserved":
    case "pending":
    case "provisional":
      return "bg-amber-500/10 text-amber-400";
    case "failed":
    case "rejected":
      return "bg-rose-500/10 text-rose-400";
    default:
      return "bg-slate-700 text-slate-400";
  }
}

export function CreditsPanel({
  vaultAddress,
  usdcAddress,
}: {
  vaultAddress: Address;
  usdcAddress: Address;
}) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const publicClient = usePublicClient({ chainId: VAULT_CHAIN_ID });
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const { writeContractAsync, isPending: isConfirmingInWallet } = useWriteContract();

  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [verifyingWallet, setVerifyingWallet] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<CreditTransactionState | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const accountRequestId = useRef(0);
  const sessionMutations = useRef(createSerialTaskQueue());
  const activeWallet = useRef<Address | undefined>(address);
  activeWallet.current = address;
  const transactionStorageKey = address
    ? creditTransactionStorageKey(VAULT_CHAIN_ID, vaultAddress, address)
    : null;
  const currentTransactionStorageKey = useRef<string | null>(transactionStorageKey);
  currentTransactionStorageKey.current = transactionStorageKey;
  const activeTransactionScope = useRef<{
    operationId: string;
    storageKey: string;
  } | null>(null);

  const rememberTransaction = useCallback(
    (
      next: CreditTransactionState | null,
      expectedOperationId?: string,
    ): boolean => {
      if (
        !transactionStorageKey ||
        currentTransactionStorageKey.current !== transactionStorageKey ||
        (expectedOperationId !== undefined &&
          !creditTransactionScopeMatches(
            currentTransactionStorageKey.current,
            activeTransactionScope.current?.operationId ?? null,
            transactionStorageKey,
            expectedOperationId,
          ))
      ) {
        return false;
      }
      activeTransactionScope.current = next
        ? { operationId: next.operationId, storageKey: transactionStorageKey }
        : null;
      setTransaction(next);
      if (next?.hash) {
        localStorage.setItem(
          transactionStorageKey,
          JSON.stringify({
            kind: next.kind,
            hash: next.hash,
            operationId: next.operationId,
          }),
        );
      } else {
        localStorage.removeItem(transactionStorageKey);
      }
      return true;
    },
    [transactionStorageKey],
  );

  const transactionScopeIsActive = useCallback(
    (operationId: string) =>
      creditTransactionScopeMatches(
        currentTransactionStorageKey.current,
        activeTransactionScope.current?.operationId ?? null,
        transactionStorageKey,
        operationId,
      ),
    [transactionStorageKey],
  );

  const requireActiveTransactionScope = useCallback((operationId: string) => {
    if (!transactionScopeIsActive(operationId)) {
      throw new Error("The connected wallet changed before the transaction was submitted.");
    }
  }, [transactionScopeIsActive]);

  const setScopedTransactionError = useCallback(
    (operationId: string, message: string) => {
      if (transactionScopeIsActive(operationId)) {
        setErrorMsg(message);
      }
    },
    [transactionScopeIsActive],
  );

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, vaultAddress] : undefined,
    chainId: VAULT_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const parsedDepositAmount = useMemo(() => {
    try {
      return parseUsdcAmount(depositAmount);
    } catch {
      return null;
    }
  }, [depositAmount]);

  const isVerified =
    Boolean(address) &&
    Boolean(accountData?.wallet) &&
    accountData?.wallet?.toLowerCase() === address?.toLowerCase();
  const transactionBusy =
    transaction !== null ||
    isSwitchingChain ||
    isConfirmingInWallet;
  const depositNeedsApproval =
    parsedDepositAmount !== null &&
    (allowance ?? 0n) < parsedDepositAmount;

  const loadAccount = useCallback(async (wallet?: Address, quiet = false) => {
    if (!wallet || !activeWallet.current || activeWallet.current.toLowerCase() !== wallet.toLowerCase()) {
      return;
    }
    const requestId = ++accountRequestId.current;
    setLoadingAccount(true);
    if (!quiet) {
      setErrorMsg(null);
    }

    try {
      const response = await fetch("/api/credits/account", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        if (
          requestId === accountRequestId.current &&
          activeWallet.current &&
          wallet &&
          activeWallet.current.toLowerCase() === wallet.toLowerCase()
        ) {
          setAccountData(null);
          if (!quiet && response.status !== 401) {
            setErrorMsg(await responseError(response, "Failed to load the credit account."));
          }
        }
        return;
      }

      const parsed = accountDataSchema.safeParse(await response.json());
      if (
        !parsed.success ||
        !parsed.data?.wallet ||
        !wallet ||
        parsed.data.wallet.toLowerCase() !== wallet.toLowerCase() ||
        !parsed.data.baseUsdcAddress ||
        parsed.data.baseUsdcAddress.toLowerCase() !== usdcAddress.toLowerCase()
      ) {
        throw new Error(`The account response did not match the connected ${VAULT_CHAIN_NAME} wallet.`);
      }
      if (
        requestId === accountRequestId.current &&
        activeWallet.current &&
        wallet &&
        activeWallet.current.toLowerCase() === wallet.toLowerCase()
      ) {
        setAccountData(parsed.data);
      }
    } catch (error) {
      if (
        requestId === accountRequestId.current &&
        activeWallet.current &&
        wallet &&
        activeWallet.current.toLowerCase() === wallet.toLowerCase()
      ) {
        setAccountData(null);
        if (!quiet) {
          setErrorMsg(error instanceof Error ? error.message : "Failed to load the credit account.");
        }
      }
    } finally {
      if (
        requestId === accountRequestId.current &&
        activeWallet.current &&
        wallet &&
        activeWallet.current.toLowerCase() === wallet.toLowerCase()
      ) {
        setLoadingAccount(false);
      }
    }
  }, []);

  useEffect(() => {
    accountRequestId.current += 1;
    setAccountData(null);
    setErrorMsg(null);
    setVerifyingWallet(false);
    setDepositAmount("");
    setWithdrawAmount("");
    if (address) {
      void loadAccount(address, true);
    } else {
      setLoadingAccount(false);
    }
  }, [address, loadAccount]);

  useEffect(() => {
    activeTransactionScope.current = null;
    setTransaction(null);
    if (!transactionStorageKey) return;
    try {
      const stored = localStorage.getItem(transactionStorageKey);
      const parsed = parsePersistedCreditTransaction(stored);
      if (parsed === null) {
        localStorage.removeItem(transactionStorageKey);
        return;
      }
      activeTransactionScope.current = {
        operationId: parsed.operationId,
        storageKey: transactionStorageKey,
      };
      setTransaction(parsed);
    } catch {
      localStorage.removeItem(transactionStorageKey);
    }
  }, [transactionStorageKey]);

  const verifyWallet = async () => {
    if (!address) {
      setErrorMsg("Connect the wallet whose private credit history you want to view.");
      return;
    }
    const wallet = address;
    const walletIsActive = () =>
      Boolean(activeWallet.current) && Boolean(wallet) && activeWallet.current?.toLowerCase() === wallet?.toLowerCase();

    setVerifyingWallet(true);
    setErrorMsg(null);
    try {
      const challengeResponse = await fetch("/api/credits/challenge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          action: "read-account",
          requestId: crypto.randomUUID(),
        }),
      });
      if (!challengeResponse.ok) {
        throw new Error(await responseError(challengeResponse, "Could not create a wallet challenge."));
      }

      const challenge = challengeSchema.safeParse(await challengeResponse.json());
      if (!challenge.success) {
        throw new Error("The server returned an invalid wallet challenge.");
      }
      if (!walletIsActive()) {
        return;
      }

      const signature = await signMessageAsync({
        account: wallet,
        message: challenge.data.message,
      });
      if (!walletIsActive()) {
        return;
      }
      const sessionResponse = await sessionMutations.current(async () => {
        if (!walletIsActive()) {
          return null;
        }
        return fetch("/api/credits/session", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeId: challenge.data.challengeId,
            message: challenge.data.message,
            signature,
          }),
        });
      });
      if (sessionResponse === null) {
        return;
      }
      if (!sessionResponse.ok) {
        throw new Error(await responseError(sessionResponse, "Wallet verification failed."));
      }

      await loadAccount(wallet);
    } catch (error) {
      if (walletIsActive()) {
        setErrorMsg(error instanceof Error ? error.message : "Wallet verification failed.");
      }
    } finally {
      if (walletIsActive()) {
        setVerifyingWallet(false);
      }
    }
  };

  const lockPrivateView = async () => {
    const wallet = address;
    accountRequestId.current += 1;
    setAccountData(null);
    setLoadingAccount(false);
    try {
      const response = await sessionMutations.current(() => {
        return fetch("/api/credits/session", {
          method: "DELETE",
          credentials: "include",
        });
      });
      if (!response.ok) {
        throw new Error("Session revocation failed.");
      }
    } catch {
      if (
        wallet !== undefined &&
        Boolean(activeWallet.current) &&
        activeWallet.current?.toLowerCase() === wallet?.toLowerCase()
      ) {
        setErrorMsg("The local view is locked, but the server session could not be revoked.");
      }
    }
  };

  const ensureVaultChain = async () => {
    if (walletChainId !== VAULT_CHAIN_ID) {
      await switchChainAsync({ chainId: VAULT_CHAIN_ID });
    }
  };

  const waitForSuccess = async (hash: Hex) => {
    if (!publicClient) {
      throw new Error(`The ${VAULT_CHAIN_NAME} RPC client is unavailable.`);
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`The ${VAULT_CHAIN_NAME} transaction reverted.`);
    }
  };

  const refreshVerifiedAccount = async () => {
    if (address && isVerified) {
      await loadAccount(address, true);
    }
  };

  const applyConfirmedTransaction = async (confirmed: CreditTransactionState) => {
    if (!transactionScopeIsActive(confirmed.operationId)) {
      return;
    }
    try {
      if (confirmed.kind === "approval") {
        await refetchAllowance();
        requireActiveTransactionScope(confirmed.operationId);
      } else {
        if (confirmed.kind === "deposit") {
          setDepositAmount("");
          await refetchAllowance();
          requireActiveTransactionScope(confirmed.operationId);
        } else {
          setWithdrawAmount("");
        }
        await refreshVerifiedAccount();
        requireActiveTransactionScope(confirmed.operationId);
      }
      if (rememberTransaction(null, confirmed.operationId)) {
        setErrorMsg(null);
      }
    } catch {
      if (transactionScopeIsActive(confirmed.operationId)) {
        setErrorMsg(
          `The ${VAULT_CHAIN_NAME} transaction confirmed, but the local account view could not be refreshed.`,
        );
        rememberTransaction(null, confirmed.operationId);
      }
    }
  };

  const reconcileTransaction = async (submitted: CreditTransactionState) => {
    if (!submitted.hash || !publicClient) {
      setScopedTransactionError(
        submitted.operationId,
        `The ${VAULT_CHAIN_NAME} transaction cannot be checked until the ${VAULT_CHAIN_NAME} RPC client is available.`,
      );
      return;
    }
    const transactionHash = submitted.hash;
    if (!rememberTransaction({ ...submitted, outcome: "waiting" }, submitted.operationId)) {
      return;
    }
    const outcome = await checkCreditTransactionReceipt(async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash });
      return receipt.status;
    });
    if (outcome === "unknown") {
      rememberTransaction(
        { ...submitted, outcome: "unknown" },
        submitted.operationId,
      );
      setScopedTransactionError(
        submitted.operationId,
        `The transaction outcome is still unknown. Actions remain locked; check the ${VAULT_CHAIN_NAME} receipt before retrying.`,
      );
      return;
    }
    if (outcome === "reverted") {
      if (rememberTransaction(null, submitted.operationId)) {
        setErrorMsg(`The ${submitted.kind} transaction reverted on ${VAULT_CHAIN_NAME}.`);
      }
      return;
    }
    await applyConfirmedTransaction(submitted);
  };

  const handleDeposit = async () => {
    if (!address) {
      setErrorMsg("Connect a wallet before depositing USDC.");
      return;
    }

    const operationId = crypto.randomUUID();
    let submitted: CreditTransactionState | null = null;
    setErrorMsg(null);
    try {
      rememberTransaction({ kind: "deposit", operationId });
      const amount = parseUsdcAmount(depositAmount);
      await ensureVaultChain();
      requireActiveTransactionScope(operationId);
      if (!publicClient) {
        throw new Error(`The ${VAULT_CHAIN_NAME} RPC client is unavailable.`);
      }

      const currentAllowance = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, vaultAddress],
      });
      requireActiveTransactionScope(operationId);

      if (currentAllowance < amount) {
        rememberTransaction({ kind: "approval", operationId }, operationId);
        const approvalHash = await writeContractAsync({
          account: address,
          address: usdcAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [vaultAddress, amount],
          chainId: VAULT_CHAIN_ID,
        });
        submitted = {
          kind: "approval",
          hash: approvalHash,
          operationId,
          outcome: "waiting",
        };
        rememberTransaction(submitted, operationId);
        await waitForSuccess(approvalHash);
        requireActiveTransactionScope(operationId);
        submitted = null;
        await refetchAllowance();
        requireActiveTransactionScope(operationId);
      }

      rememberTransaction({ kind: "deposit", operationId }, operationId);
      const depositHash = await writeContractAsync({
        account: address,
        address: vaultAddress,
        abi: CUSTOMER_CREDIT_VAULT_ABI,
        functionName: "deposit",
        args: [amount],
        chainId: VAULT_CHAIN_ID,
      });
      submitted = {
        kind: "deposit",
        hash: depositHash,
        operationId,
        outcome: "waiting",
      };
      rememberTransaction(submitted, operationId);
      await waitForSuccess(depositHash);
      requireActiveTransactionScope(operationId);
      submitted = null;
      await applyConfirmedTransaction({
        kind: "deposit",
        hash: depositHash,
        operationId,
        outcome: "waiting",
      });
    } catch (error) {
      if (submitted?.hash) {
        await reconcileTransaction(submitted);
      } else {
        if (rememberTransaction(null, operationId)) {
          setErrorMsg(error instanceof Error ? error.message : "The USDC deposit failed.");
        }
      }
    }
  };

  const handleWithdraw = async () => {
    if (!address) {
      setErrorMsg("Connect a wallet before withdrawing USDC.");
      return;
    }

    const operationId = crypto.randomUUID();
    let submitted: CreditTransactionState | null = null;
    setErrorMsg(null);
    try {
      rememberTransaction({ kind: "withdrawal", operationId });
      const amount = parseUsdcAmount(withdrawAmount);
      await ensureVaultChain();
      requireActiveTransactionScope(operationId);
      if (!publicClient) {
        throw new Error(`The ${VAULT_CHAIN_NAME} RPC client is unavailable.`);
      }
      const withdrawalHash = await writeContractAsync({
        account: address,
        address: vaultAddress,
        abi: CUSTOMER_CREDIT_VAULT_ABI,
        functionName: "withdraw",
        args: [amount],
        chainId: VAULT_CHAIN_ID,
      });
      submitted = {
        kind: "withdrawal",
        hash: withdrawalHash,
        operationId,
        outcome: "waiting",
      };
      rememberTransaction(submitted, operationId);
      await waitForSuccess(withdrawalHash);
      requireActiveTransactionScope(operationId);
      submitted = null;
      await applyConfirmedTransaction({
        kind: "withdrawal",
        hash: withdrawalHash,
        operationId,
        outcome: "waiting",
      });
    } catch (error) {
      if (submitted?.hash) {
        await reconcileTransaction(submitted);
      } else {
        if (rememberTransaction(null, operationId)) {
          setErrorMsg(
            error instanceof Error ? error.message : "The USDC withdrawal failed.",
          );
        }
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-100 shadow-2xl backdrop-blur-md">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center">
        <div>
          <h1 className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-2xl font-bold text-transparent">
            Leg Customer Credits
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {SETTLEMENT_TOKEN_LABEL} on {VAULT_CHAIN_NAME} • wallet-custodied • provider billing requires confirmed credit
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300">
            {chainName(VAULT_CHAIN_ID)} · USDC · Chain {VAULT_CHAIN_ID} ·{" "}
            <a
              className="underline"
              href={explorerAddressUrl(VAULT_CHAIN_ID, vaultAddress) ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
              vault {vaultAddress.slice(0, 6)}…{vaultAddress.slice(-4)}
            </a>
          </div>
          {isVerified && (
            <button
              type="button"
              onClick={() => void lockPrivateView()}
              className="text-xs text-slate-400 underline hover:text-slate-200"
            >
              Lock private account view
            </button>
          )}
        </div>
      </div>

      {!isConnected && (
        <div className="mb-6 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-200">
          Connect a wallet to deposit or withdraw. Private billing history is shown only after that wallet signs a one-time challenge.
        </div>
      )}

      {isConnected && !isVerified && (
        <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100 sm:flex-row sm:items-center">
          <span>
            {loadingAccount
              ? "Checking for an existing wallet-bound session…"
              : "Sign a wallet challenge to unlock this wallet’s private credit and usage view."}
          </span>
          <button
            type="button"
            onClick={() => void verifyWallet()}
            disabled={loadingAccount || verifyingWallet || isSigning}
            className="rounded-lg bg-amber-300 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
          >
            {verifyingWallet || isSigning ? "Verify in wallet…" : "Verify wallet"}
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setErrorMsg(null)}
            className="text-rose-400 hover:text-rose-200"
          >
            ✕
          </button>
        </div>
      )}

      {transaction && (
        <div
          aria-live="polite"
          className="mb-6 flex flex-col items-start justify-between gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-200 sm:flex-row sm:items-center"
        >
          <span>
            {transaction.hash
              ? transaction.outcome === "unknown"
                ? `${VAULT_CHAIN_NAME} transaction outcome unknown: `
                : `Waiting for ${VAULT_CHAIN_NAME} confirmation: `
              : "Confirm in your wallet: "}
            <span className="font-semibold capitalize">{transaction.kind}</span>
            {transaction.hash && (
              <>
                {" · "}
                <a
                  className="underline"
                  href={explorerTxUrl(VAULT_CHAIN_ID, transaction.hash) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  view transaction
                </a>
              </>
            )}
          </span>
          {transaction.hash && transaction.outcome === "unknown" && (
            <button
              type="button"
              onClick={() => void reconcileTransaction(transaction)}
              className="rounded-lg border border-sky-300/40 px-3 py-1.5 font-semibold hover:bg-sky-300/10"
            >
              Check receipt
            </button>
          )}
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Withdrawable",
            value: accountData?.availableUsdc,
            color: "text-emerald-400",
            note: "On-chain, unreserved; includes pending deposits",
          },
          {
            label: "Provider Eligible",
            value: accountData?.providerEligibleUsdc,
            color: "text-blue-400",
            note: "Confirmed amount available for new requests",
          },
          {
            label: "Live Reserved",
            value: accountData?.reservedUsdc,
            color: "text-amber-400",
            note: "On-chain maximum for active requests",
          },
          {
            label: "Pending for Providers",
            value: accountData?.pendingDepositsUsdc,
            color: "text-sky-400",
            note: "Subset of live available; self-withdrawable",
          },
        ].map(item => (
          <div key={item.label} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{item.label}</span>
            <div className={`mt-2 text-3xl font-extrabold ${item.color}`}>
              {isVerified && item.value ? `$${item.value}` : "—"}
            </div>
            <span className="mt-1 block text-xs text-slate-500">{item.note}</span>
          </div>
        ))}
      </div>

      <div className="mb-6 flex gap-2 overflow-x-auto border-b border-slate-800">
        {tabs.map(tab => (
          <button
            type="button"
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-t-lg px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? "border-b-2 border-blue-400 bg-slate-800 text-blue-400"
                : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-800/30 p-4 text-sm text-slate-300">
            <h2 className="mb-2 font-semibold text-slate-200">Web3 custody, private billing history</h2>
            <ul className="list-inside list-disc space-y-1 text-slate-400">
              <li>Your wallet deposits and withdraws directly from the {VAULT_CHAIN_NAME} vault.</li>
              <li>The local Leg database cannot move or trap your USDC.</li>
              <li>Wallet verification protects private requests and usage; vault balances and events remain public on {VAULT_CHAIN_NAME}.</li>
            </ul>
          </div>
        </div>
      )}

      {activeTab === "deposit" && (
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-800/30 p-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-200">Deposit {SETTLEMENT_TOKEN_LABEL} on {VAULT_CHAIN_NAME}</h2>
            <p className="mt-1 text-xs text-slate-400">
              When approval is needed, the app requests exactly this deposit amount. The deposit becomes self-withdrawable when mined and billable only after the configured confirmation depth.
            </p>
          </div>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <input
              aria-label="USDC deposit amount"
              inputMode="decimal"
              placeholder="Amount in USDC (for example 50.00)"
              value={depositAmount}
              onChange={event => setDepositAmount(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none sm:w-80"
            />
            <button
              type="button"
              onClick={() => void handleDeposit()}
              disabled={transactionBusy || !isConnected}
              className="w-full rounded-xl bg-blue-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 sm:w-auto"
            >
              {transactionBusy
                ? "Transaction pending…"
                : depositNeedsApproval
                  ? "Approve & deposit"
                  : "Deposit USDC"}
            </button>
          </div>
          {isVerified && accountData && accountData.depositActivity.length > 0 && (
            <div className="border-t border-slate-800 pt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-300">Recent wallet deposits</h3>
              <ul className="space-y-2 text-xs text-slate-400">
                {accountData.depositActivity.slice(0, 10).map(deposit => (
                  <li
                    key={`${deposit.transactionHash}:${deposit.observedAt}`}
                    className="flex flex-col justify-between gap-1 rounded-lg bg-slate-900/60 px-3 py-2 sm:flex-row"
                  >
                    <span>
                      ${deposit.amountUsdc} ·{" "}
                      <span className={statusClasses(deposit.finality)}>
                        {deposit.finality ? deposit.finality.toLowerCase() : ""}
                      </span>
                      {deposit.reason ? ` · ${deposit.reason}` : ""}
                    </span>
                    <a
                      className="font-mono text-sky-400 underline"
                      href={explorerTxUrl(VAULT_CHAIN_ID, deposit.transactionHash) ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {deposit.transactionHash.slice(0, 10)}…
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {activeTab === "withdraw" && (
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-800/30 p-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-200">Withdraw unreserved USDC</h2>
            <p className="mt-1 text-xs text-slate-400">
              {isVerified
                ? `Verified live maximum: $${accountData?.availableUsdc ?? "0.000000"} USDC.`
                : "This direct vault action remains available even if Leg’s private database is unavailable; the vault enforces the maximum."}
            </p>
          </div>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <input
              aria-label="USDC withdrawal amount"
              inputMode="decimal"
              placeholder="Amount in USDC"
              value={withdrawAmount}
              onChange={event => setWithdrawAmount(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none sm:w-80"
            />
            <button
              type="button"
              onClick={() => void handleWithdraw()}
              disabled={transactionBusy || !isConnected}
              className="w-full rounded-xl bg-emerald-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 sm:w-auto"
            >
              {transactionBusy ? "Transaction pending…" : "Withdraw USDC"}
            </button>
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div className="overflow-x-auto">
          {!isVerified || !accountData ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Verify the connected wallet to view its private Leg usage history.
            </p>
          ) : (
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="border-b border-slate-700 bg-slate-800/80 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Correlation ID</th>
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Max Charge</th>
                  <th className="px-4 py-3">Customer Charge</th>
                  <th className="px-4 py-3">Breakdown / Corrections</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {accountData.usageHistory.length ? (
                  accountData.usageHistory.map(item => (
                    <tr key={item.authorizationId} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">
                        {item.correlationId}
                        {item.createdAt && (
                          <span className="mt-1 block font-sans text-slate-500">
                            {new Date(item.createdAt).toLocaleString()}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 capitalize">{item.serviceType ? item.serviceType.toLowerCase() : ""}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClasses(item.status)}`}>
                          {item.status ? item.status.toLowerCase() : ""}
                        </span>
                        {item.rejectionReason && (
                          <span className="mt-1 block max-w-48 text-xs text-rose-300">
                            {item.rejectionReason}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">${item.maximumChargeUsdc}</td>
                      <td className="px-4 py-3 font-semibold text-slate-100">${item.customerChargeUsdc}</td>
                      <td className="min-w-64 px-4 py-3 text-xs text-slate-400">
                        {item.components ? (
                          <span>
                            0G ${item.components.zeroG} · FMP ${item.components.fmp} · Leg $
                            {item.components.legService}
                          </span>
                        ) : (
                          <span>No usage recorded</span>
                        )}
                        {item.corrections.map(correction => (
                          <span key={correction.id} className="mt-1 block text-violet-300">
                            Correction: {correction.reason} · ${correction.totalUsdc}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No credit usage history yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
