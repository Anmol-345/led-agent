"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Wallet, BadgeCheck, Info, Users, Bug, MessageSquare, Database, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { LocalFaucetButton } from "@/components/LocalFaucetButton";
import { SwarmAgentPicker } from "@/lib/agent-swarm";

const NAV_ITEMS = [
  { href: "/home", label: "Chat", icon: MessageSquare },
  { href: "/trade", label: "Trade", icon: TrendingUp },
  { href: "/balances", label: "Balances", icon: Wallet },
  { href: "/ens", label: "ENS", icon: BadgeCheck },
  { href: "/identity", label: "Identity", icon: Info },
  { href: "/swarm", label: "Swarm", icon: Users },
  { href: "/data", label: "Data", icon: Database },
  { href: "/debug", label: "Debug", icon: Bug },
];

export function Header() {
  const pathname = usePathname();
  const isDemoRoot = pathname === "/";

  if (isDemoRoot) {
    return (
      <header
        className="border-b border-[#a3e635]/20 bg-[#0a0b0d]/90 backdrop-blur-md px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-40 shrink-0 text-[#f3f4f6]"
        role="banner"
      >
        <Link href="/" className="flex items-center gap-3 shrink-0 group">
          <div className="h-8 w-8 rounded-lg bg-[#a3e635]/10 border border-[#a3e635]/40 flex items-center justify-center shadow-[0_0_12px_rgba(163,230,53,0.2)] group-hover:border-[#a3e635]">
            <Bot className="h-4 w-4 text-[#a3e635]" aria-hidden />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold tracking-widest text-[#a3e635] uppercase">
                Legendary Agent
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#a3e635]/30 bg-[#a3e635]/10 text-[#a3e635]">
                DEMO v1.0
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-mono hidden sm:block">
              AI Value Investing & Tokenized Stock Trading
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/home"
            className="text-xs font-mono text-zinc-400 hover:text-[#a3e635] px-2.5 py-1.5 rounded border border-zinc-800 hover:border-[#a3e635]/40 transition-colors hidden xs:inline-flex items-center gap-1.5"
          >
            <span>Full Workspace</span>
            <span aria-hidden>→</span>
          </Link>
          <LocalFaucetButton />
          <ConnectWalletButton />
        </div>
      </header>
    );
  }

  return (
    <header
      className="border-b border-border bg-card/80 backdrop-blur-md px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4 sticky top-0 z-40 shrink-0"
      role="banner"
    >
      <Link href="/home" className="flex items-center gap-3 shrink-0">
        <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center shadow-sm">
          <Bot className="h-4 w-4 text-primary-foreground" aria-hidden />
        </div>
        <div className="hidden sm:block">
          <p className="text-sm font-semibold tracking-tight leading-tight">leg-agent</p>
          <p className="text-xs text-muted-foreground leading-tight mt-0.5">Onchain AI Agent</p>
        </div>
      </Link>

      <nav className="flex items-center gap-1 overflow-x-auto scrollbar-thin" aria-label="Main navigation">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/home" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap",
                active
                  ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden md:inline">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-2 shrink-0">
        <LocalFaucetButton />
        <SwarmAgentPicker className="hidden sm:flex shrink-0" />
        <ConnectWalletButton />
      </div>
    </header>
  );
}
