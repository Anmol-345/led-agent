"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AgentRosterEntry = {
  id: string;
  address: string;
  preset?: string;
};

type Ctx = {
  roster: AgentRosterEntry[];
  loading: boolean;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  selected: AgentRosterEntry | null;
  /** Primary env address when roster is empty (no agents.json yet). */
  fallbackAddress: string;
};

const AgentSwarmContext = createContext<Ctx | null>(null);

const LS_KEY = "scaffold_selected_agent_id";

async function loadRoster(): Promise<AgentRosterEntry[]> {
  try {
    const res = await fetch("/agents.json", { cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as unknown;
    const arr = Array.isArray(j) ? j : (j as { agents?: unknown }).agents;
    if (!Array.isArray(arr)) return [];
    const out: AgentRosterEntry[] = [];
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      const address = typeof o.address === "string" ? o.address.trim() : "";
      if (!id || !/^0x[a-fA-F0-9]{40}$/i.test(address)) continue;
      const preset = typeof o.preset === "string" ? o.preset : undefined;
      out.push({ id, address, preset });
    }
    return out;
  } catch {
    return [];
  }
}

export function AgentSwarmProvider({ children }: { children: ReactNode }) {
  const fallbackAddress = (process.env.NEXT_PUBLIC_AGENT_ADDRESS || "").trim();
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await loadRoster();
      if (cancelled) return;
      setRoster(r);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (roster.length === 0) {
      if (selectedId !== null) setSelectedIdState(null);
      return;
    }
    const saved =
      typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    const pick =
      roster.find((x) => x.id === saved) ??
      roster.find((x) => x.address.toLowerCase() === fallbackAddress.toLowerCase()) ??
      roster[0];
    if (pick && pick.id !== selectedId) {
      setSelectedIdState(pick.id);
    }
  }, [loading, roster, fallbackAddress, selectedId]);

  const setSelectedId = useCallback((id: string) => {
    setSelectedIdState(id);
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const selected = useMemo(
    () => roster.find((x) => x.id === selectedId) ?? null,
    [roster, selectedId],
  );

  const value = useMemo<Ctx>(
    () => ({
      roster,
      loading,
      selectedId,
      setSelectedId,
      selected,
      fallbackAddress,
    }),
    [roster, loading, selectedId, setSelectedId, selected, fallbackAddress],
  );

  return (
    <AgentSwarmContext.Provider value={value}>{children}</AgentSwarmContext.Provider>
  );
}

export function useAgentSwarm(): Ctx {
  const v = useContext(AgentSwarmContext);
  if (!v) {
    throw new Error("AgentSwarmProvider is required");
  }
  return v;
}

/** Address for balances / identity when a swarm row is selected or env fallback. */
export function useEffectiveAgentAddress(): string {
  const { roster, selected, fallbackAddress } = useAgentSwarm();
  if (selected?.address) return selected.address;
  if (roster.length === 1) return roster[0].address;
  return fallbackAddress;
}

export function SwarmAgentPicker({ className }: { className?: string }) {
  const { roster, loading, selectedId, setSelectedId } = useAgentSwarm();
  if (loading || roster.length <= 1) return null;
  return (
    <label className={"flex items-center gap-2 text-xs " + (className ?? "")}>
      <span className="text-muted-foreground shrink-0">Agent</span>
      <select
        className="h-8 max-w-[11rem] truncate rounded-md border border-input bg-background px-2 text-xs font-mono"
        value={selectedId ?? ""}
        onChange={(e) => setSelectedId(e.target.value)}
        aria-label="Select swarm agent wallet"
      >
        {roster.map((a) => (
          <option key={a.id} value={a.id}>
            {a.id}
            {a.preset ? " (" + a.preset + ")" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
