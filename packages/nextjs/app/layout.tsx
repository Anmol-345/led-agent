import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { WrongNetworkBanner } from "@/components/WrongNetworkBanner";

export const metadata: Metadata = {
  title: "leg-agent on BOT Chain",
  description:
    "Legendary-investor AI advice with sub-second credit settlement on BOT Chain (~$0.002 gas).",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans">
        <Providers>
          <div className="flex min-h-dvh flex-col">
          <a
            href="#site-main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Skip to main content
          </a>
          <WrongNetworkBanner />
          <Header />
          <div id="site-main" className="flex flex-1 flex-col min-h-0">
            {children}
          </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
