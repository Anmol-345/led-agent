"use client";

import { useState } from "react";
import { AdvisorChat } from "@/components/advisor/AdvisorChat";
import { CheckupPanel } from "@/components/advisor/CheckupPanel";
import { BookOpen, Clock } from "lucide-react";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"chat" | "checkups">("chat");

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Top Bar Navigation */}
      <div className="border-b border-border bg-card/60 backdrop-blur-md px-6 py-3 shrink-0 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={`flex items-center space-x-2 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === "chat"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            <BookOpen className="h-4 w-4" />
            <span>Advisor Research</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("checkups")}
            className={`flex items-center space-x-2 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === "checkups"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            <Clock className="h-4 w-4" />
            <span>Portfolio Checkups</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex flex-1 flex-col min-h-0 overflow-y-auto">
        {activeTab === "chat" ? <AdvisorChat /> : <CheckupPanel />}
      </main>
    </div>
  );
}
