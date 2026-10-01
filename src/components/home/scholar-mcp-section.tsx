"use client";

import * as React from "react";
import Link from "next/link";
import { Cpu, Terminal, Copy, Check, ExternalLink, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ScholarMcpSection() {
  const [copied, setCopied] = React.useState(false);

  const mcpConfigJson = `{
  "mcpServers": {
    "research-hub": {
      "command": "npx",
      "args": ["-y", "@research-hub/mcp-server"],
      "env": {
        "RESEARCH_HUB_API_KEY": "rh_live_your_secret_key"
      }
    }
  }
}`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(mcpConfigJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="mcp" className="py-16 sm:py-24 relative overflow-hidden bg-slate-950 text-white">
      {/* Background Glow */}
      <div className="absolute top-0 right-1/4 -z-10 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Description */}
          <div className="lg:col-span-6 space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
              <Cpu className="h-3.5 w-3.5" />
              <span>Developer & Agent Infrastructure</span>
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight">
              Scholar API &amp; Model Context Protocol (MCP)
            </h2>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
              Bring our scientific literature catalog, structured text chunks, and evidence-grounded citations
              directly into your own applications, Claude Desktop, Cursor, and custom research agents.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 text-left text-xs">
              <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
                <span className="font-bold text-indigo-400 block text-sm">Paper Metadata API</span>
                <p className="text-slate-400">Query authors, abstracts, DOI, citation graphs, and arXiv IDs at scale.</p>
              </div>
              <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
                <span className="font-bold text-indigo-400 block text-sm">Full-Text Files API</span>
                <p className="text-slate-400">Extract clean text chunks, figures, tables, and mathematical formulas from PDFs.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 pt-4">
              <Button asChild className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
                <Link href="/pricing">Get API &amp; MCP Access</Link>
              </Button>
              <Button asChild variant="outline" className="border-slate-700 text-slate-200 hover:bg-slate-900">
                <Link href="/tools">View Protocol Docs</Link>
              </Button>
            </div>
          </div>

          {/* Right Column: Interactive Code Sandbox */}
          <div className="lg:col-span-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden text-xs">
              {/* Terminal Title Bar */}
              <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-indigo-400" />
                  <span className="font-mono text-slate-300 text-[11px]">claude_desktop_config.json</span>
                </div>
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy Config</span>
                    </>
                  )}
                </button>
              </div>

              {/* Code display */}
              <div className="p-4 font-mono text-slate-300 text-xs overflow-x-auto leading-relaxed bg-slate-900">
                <pre>{mcpConfigJson}</pre>
              </div>

              {/* Capability Footnote */}
              <div className="border-t border-slate-800 bg-slate-950/70 p-4 text-[11px] text-slate-400 flex items-center justify-between">
                <span>Compatible with Claude 3.5, Cursor, Antigravity, and LangChain</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <Zap className="h-3 w-3" /> 99.9% Uptime SLA
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
