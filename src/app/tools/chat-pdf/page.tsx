"use client";

import * as React from "react";
import Link from "next/link";
import {
  Upload,
  FileText,
  Send,
  Sparkles,
  Search,
  BookOpen,
  ArrowLeft,
  CheckCircle2,
  Bookmark,
  Share2,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SamplePaper {
  id: string;
  title: string;
  journal: string;
  pages: { pageNumber: number; text: string }[];
}

const samplePapers: SamplePaper[] = [
  {
    id: "transformer",
    title: "Attention Is All You Need (Vaswani et al.)",
    journal: "Advances in Neural Information Processing Systems (NeurIPS)",
    pages: [
      {
        pageNumber: 1,
        text: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose the Transformer, a model architecture eschewing recurrence and instead relying entirely on an attention mechanism to draw global dependencies between input and output.",
      },
      {
        pageNumber: 2,
        text: "An attention function can be described as mapping a query and a set of key-value pairs to an output, where the query, keys, values, and output are all vectors. The output is computed as a weighted sum of the values, where the weight assigned to each value is computed by a compatibility function of the query with the corresponding key.",
      },
      {
        pageNumber: 3,
        text: "We compute the attention function on a set of queries simultaneously, packed together into a matrix Q. Scaled Dot-Product Attention computes: Attention(Q, K, V) = softmax((Q K^T) / sqrt(d_k)) V. We compute the dot products of the query with all keys, divide each by sqrt(d_k), and apply a softmax function.",
      },
    ],
  },
  {
    id: "alphafold3",
    title: "Accurate Structure Prediction of Biomolecular Interactions with AlphaFold 3",
    journal: "Nature Biomedical Science",
    pages: [
      {
        pageNumber: 1,
        text: "The interaction of proteins with other molecules is fundamental to cellular function. Here we present AlphaFold 3, with a substantially updated diffusion-based architecture that is capable of predicting the joint 3D structure of complexes including proteins, nucleic acids, small molecules, ions, and chemical modifications.",
      },
      {
        pageNumber: 2,
        text: "Unlike AlphaFold 2, AlphaFold 3 does not utilize residue frames or internal torsion angles for structure building. Instead, a generative Diffusion Module acts directly on 3D Cartesian coordinates of all heavy atoms in the complex.",
      },
    ],
  },
];

interface ChatMessage {
  sender: "user" | "ai";
  text: string;
  pageCitation?: number;
  highlightSnippet?: string;
}

export default function ChatPdfPage() {
  const [selectedPaper, setSelectedPaper] = React.useState<SamplePaper>(
    samplePapers[0]
  );
  const [activePage, setActivePage] = React.useState<number>(1);
  const [queryInput, setQueryInput] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      sender: "ai",
      text: "Hello! I've indexed this paper. You can ask any question about the architecture, mathematical formulas, or experimental results, and I will anchor answers to the exact page.",
    },
    {
      sender: "user",
      text: "How does Scaled Dot-Product Attention compute weights?",
    },
    {
      sender: "ai",
      text: "Scaled Dot-Product Attention computes the dot products of the queries (Q) with all keys (K), scales them by 1/sqrt(d_k) to prevent vanishing gradients in large dimensions, and applies a softmax function to obtain weights over the values (V).",
      pageCitation: 3,
      highlightSnippet: "Attention(Q, K, V) = softmax((Q K^T) / sqrt(d_k)) V",
    },
  ]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryInput.trim()) return;

    const userText = queryInput.trim();
    setQueryInput("");

    setMessages((prev) => [...prev, { sender: "user", text: userText }]);

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          sender: "ai",
          text: `Based on Section 3 of "${selectedPaper.title}", the mechanism relies entirely on self-attention to process all tokens in parallel rather than sequentially, achieving O(1) sequential operations compared to O(n) in RNNs.`,
          pageCitation: 2,
          highlightSnippet: "mapping a query and a set of key-value pairs to an output",
        },
      ]);
    }, 600);
  };

  const currentPage =
    selectedPaper.pages.find((p) => p.pageNumber === activePage) ||
    selectedPaper.pages[0];

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/tools"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Tools Suite
          </Link>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            <FileText className="h-6 w-6 text-indigo-600" />
            PDF Chat &amp; Evidence Extractor
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Ask questions, test hypotheses, and verify citations across complex research papers.
          </p>
        </div>

        {/* Paper Switcher */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 font-medium">Select Paper:</span>
          {samplePapers.map((paper) => (
            <button
              key={paper.id}
              onClick={() => {
                setSelectedPaper(paper);
                setActivePage(1);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 font-semibold transition-all border",
                selectedPaper.id === paper.id
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              )}
            >
              {paper.id === "transformer" ? "Transformers" : "AlphaFold 3"}
            </button>
          ))}
        </div>
      </div>

      {/* Dual Pane Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Column: Interactive Document Viewer */}
        <div className="lg:col-span-7 flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-[580px]">
          {/* Document Top Bar */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/90 px-4 py-3 text-xs">
            <div className="flex items-center gap-2 truncate max-w-[70%]">
              <BookOpen className="h-4 w-4 text-indigo-600 shrink-0" />
              <span className="font-bold text-slate-900 truncate">
                {selectedPaper.title}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {selectedPaper.pages.map((p) => (
                <button
                  key={p.pageNumber}
                  onClick={() => setActivePage(p.pageNumber)}
                  className={cn(
                    "h-6 px-2 rounded text-xs font-semibold transition-all",
                    activePage === p.pageNumber
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-200/80 text-slate-700 hover:bg-slate-300"
                  )}
                >
                  Page {p.pageNumber}
                </button>
              ))}
            </div>
          </div>

          {/* Document Content View */}
          <div className="p-6 sm:p-8 flex-1 space-y-4 font-serif text-sm sm:text-base leading-relaxed text-slate-800 bg-slate-50/20 overflow-y-auto">
            <div className="text-[11px] font-sans font-bold uppercase tracking-wider text-slate-400">
              Page {activePage} of {selectedPaper.pages.length} • {selectedPaper.journal}
            </div>

            <p className="p-4 rounded-xl border border-slate-200/80 bg-white shadow-xs">
              {currentPage.text}
            </p>

            <div className="rounded-lg bg-indigo-50/70 border border-indigo-100 p-3 text-xs text-indigo-900 font-sans flex items-center justify-between">
              <span>Verified Page Anchors: OCR &amp; Vector Ingest Complete</span>
              <Badge variant="academic" className="text-[10px]">
                DOI Verified
              </Badge>
            </div>
          </div>
        </div>

        {/* Right Column: Grounded AI Assistant Chat */}
        <div className="lg:col-span-5 flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-[580px]">
          {/* Chat Header */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/90 px-4 py-3 text-xs">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              <span className="font-bold text-slate-900">AI Evidence Assistant</span>
            </div>
            <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Grounded Mode Active
            </span>
          </div>

          {/* Chat History */}
          <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[460px] text-xs sm:text-sm">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={cn(
                  "p-3.5 rounded-xl space-y-2 max-w-[90%] leading-relaxed",
                  msg.sender === "user"
                    ? "ml-auto bg-indigo-600 text-white font-medium shadow-xs"
                    : "bg-slate-100/80 text-slate-900 border border-slate-200/70"
                )}
              >
                <p>{msg.text}</p>
                {msg.pageCitation && (
                  <button
                    onClick={() => setActivePage(msg.pageCitation!)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 hover:bg-indigo-100 transition-colors"
                  >
                    <span>Anchor: Page {msg.pageCitation}</span>
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Chat Input */}
          <form
            onSubmit={handleSend}
            className="p-3 border-t border-slate-200 bg-white flex items-center gap-2"
          >
            <input
              type="text"
              placeholder="Ask a question about this paper..."
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              className="flex-1 text-xs sm:text-sm py-2 px-3 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <Button type="submit" size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white">
              <Send className="h-3.5 w-3.5" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
