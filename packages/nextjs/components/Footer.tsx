"use client";

import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Globe, Search, ShieldCheck, Cpu, Bot } from "lucide-react";

export function Footer() {
  return (
    <footer
      id="site-footer"
      className="border-t border-[#a3e635]/20 bg-[#07090d] text-[#9ca3af] shrink-0 relative overflow-hidden"
      role="contentinfo"
    >
      {/* Subtle background glow */}
      <div
        className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#a3e635]/10 via-transparent to-transparent opacity-60"
        aria-hidden="true"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12">
          {/* Col 1: Brand & Core Mission (5 cols) */}
          <div className="md:col-span-5 space-y-4">
            <Link
              id="footer-brand-link"
              href="/"
              className="inline-flex items-center gap-2.5 group"
            >
              <div className="h-8 w-8 rounded-lg bg-[#a3e635]/10 border border-[#a3e635]/40 flex items-center justify-center text-[#a3e635] shadow-[0_0_10px_rgba(163,230,53,0.2)] group-hover:border-[#a3e635] transition-colors">
                <Bot className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <span className="text-sm font-mono font-bold tracking-wider text-[#f3f4f6] uppercase">
                  Legendary Agent
                </span>
                <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#a3e635]/30 bg-[#a3e635]/10 text-[#a3e635]">
                  BOT Chain
                </span>
              </div>
            </Link>

            <p className="text-xs text-zinc-400 font-sans leading-relaxed max-w-sm">
              Legendary-investor financial advice with sub-second credit settlement on BOT Chain (~$0.002 gas).
              Decentralized inference powered by 0G Compute Network and automated tokenized equity routing via Uniswap.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border border-emerald-500/30 bg-emerald-950/30 text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Network Active · Chain ID 677
              </span>
              <span className="text-[11px] font-mono text-zinc-500">
                Sub-second blocks
              </span>
            </div>
          </div>

          {/* Col 2: Official Ecosystem Partner Feature (BOT Chain) (4 cols) */}
          <div className="md:col-span-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#a3e635]">
                Ecosystem Partner
              </span>
              <span className="h-px flex-1 bg-zinc-800" />
            </div>

            <div
              id="footer-ecosystem-partner-card"
              className="p-4 rounded-xl border border-[#a3e635]/30 bg-gradient-to-b from-[#0e1312] to-[#090c0b] shadow-[0_4px_20px_rgba(0,0,0,0.5)] space-y-3 group hover:border-[#a3e635]/60 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="relative h-11 w-11 rounded-lg overflow-hidden border border-[#a3e635]/40 bg-black shrink-0 shadow-[0_0_12px_rgba(163,230,53,0.25)]">
                  <Image
                    src="/botchain-logo.jpeg"
                    alt="BOT Chain Logo"
                    fill
                    sizes="44px"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-sm font-mono font-bold text-[#f3f4f6] truncate">
                      BOT Chain
                    </h4>
                    <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-[#a3e635]/15 text-[#a3e635] border border-[#a3e635]/30">
                      L1/L2
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 truncate">
                    High-speed execution chain
                  </p>
                </div>
              </div>

              {/* Verified Partner Links */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono text-xs">
                <a
                  id="footer-link-botchain-website"
                  href="https://botchain.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-1.5 px-3 py-2 rounded-lg border border-zinc-800 bg-[#07090c] hover:border-[#a3e635]/50 hover:bg-[#a3e635]/5 text-zinc-300 hover:text-[#a3e635] transition-all"
                >
                  <span className="flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-[#a3e635]" aria-hidden="true" />
                    <span>Website</span>
                  </span>
                  <ExternalLink className="h-3 w-3 opacity-60" aria-hidden="true" />
                </a>

                <a
                  id="footer-link-botchain-explorer"
                  href="https://scan.botchain.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-1.5 px-3 py-2 rounded-lg border border-zinc-800 bg-[#07090c] hover:border-[#a3e635]/50 hover:bg-[#a3e635]/5 text-zinc-300 hover:text-[#a3e635] transition-all"
                >
                  <span className="flex items-center gap-1.5">
                    <Search className="h-3.5 w-3.5 text-[#a3e635]" aria-hidden="true" />
                    <span>Explorer</span>
                  </span>
                  <ExternalLink className="h-3 w-3 opacity-60" aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>

          {/* Col 3: Navigation & Onchain Resources (3 cols) */}
          <div className="md:col-span-3 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-400">
                Navigation & Onchain
              </span>
              <span className="h-px flex-1 bg-zinc-800" />
            </div>

            <ul className="space-y-2 text-xs font-mono">
              <li>
                <Link
                  id="footer-nav-chat"
                  href="/home"
                  className="text-zinc-400 hover:text-[#a3e635] transition-colors flex items-center gap-1.5"
                >
                  <span>→ Advisor Workspace</span>
                </Link>
              </li>
              <li>
                <Link
                  id="footer-nav-trade"
                  href="/trade"
                  className="text-zinc-400 hover:text-[#a3e635] transition-colors flex items-center gap-1.5"
                >
                  <span>→ Tokenized Stock Trades</span>
                </Link>
              </li>
              <li>
                <Link
                  id="footer-nav-balances"
                  href="/balances"
                  className="text-zinc-400 hover:text-[#a3e635] transition-colors flex items-center gap-1.5"
                >
                  <span>→ Vault Balances</span>
                </Link>
              </li>
              <li>
                <a
                  id="footer-link-vault-contract"
                  href="https://scan.botchain.ai/address/0x33F96427BfE3ec9Db7424DB99759373D5cC9eDf8"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-[#a3e635] transition-colors flex items-center gap-1.5"
                >
                  <span>→ CustomerCreditVault</span>
                  <ExternalLink className="h-2.5 w-2.5 opacity-50" aria-hidden="true" />
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom divider & attribution bar */}
        <div className="mt-8 pt-6 border-t border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] font-mono text-zinc-500">
          <div className="flex items-center gap-2">
            <span>© 2026 leg-agent. Built on</span>
            <a
              href="https://botchain.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#a3e635] hover:underline"
            >
              BOT Chain
            </a>
            <span>&</span>
            <span className="text-zinc-400">0G Compute</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1 text-zinc-400">
              <ShieldCheck className="h-3.5 w-3.5 text-[#a3e635]" aria-hidden="true" />
              <span>EIP-712 Credit Security</span>
            </span>
            <span className="flex items-center gap-1 text-zinc-400">
              <Cpu className="h-3.5 w-3.5 text-[#a3e635]" aria-hidden="true" />
              <span>Decentralized Inference</span>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
