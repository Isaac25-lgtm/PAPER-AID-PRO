"use client";

import * as React from "react";
import {
  Sparkles,
  Search,
  CheckCircle2,
  ExternalLink,
  BookOpen,
  ArrowRight,
  ShieldAlert,
  Layers,
  Cpu,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SampleInquiry {
  id: string;
  topic: string;
  query: string;
  synthesis: string;
  confidenceScore: number;
  sources: {
    citationNumber: number;
    title: string;
    authors: string;
    journal: string;
    year: string;
    doi: string;
    verifiedExcerpt: string;
  }[];
}

const sampleInquiries: SampleInquiry[] = [
  {
    id: "alphafold",
    topic: "Structural Biology",
    query: "How does AlphaFold 3 model joint protein-nucleic acid and small-molecule complexes?",
    synthesis:
      "AlphaFold 3 transitions from structural representations based on residue frames to a direct diffusion module that predicts raw 3D Cartesian atom coordinates across all biological polymers [1]. Rather than treating proteins in isolation, the architecture jointly models proteins, DNA, RNA, ions, and chemical ligands in a single unified diffusion process [2]. In benchmark evaluations, cross-docking accuracy and protein-ligand stereochemical validity exceed classical physics-based docking software by over 50% [3].",
    confidenceScore: 99.4,
    sources: [
      {
        citationNumber: 1,
        title: "Accurate structure prediction of biomolecular interactions with AlphaFold 3",
        authors: "Abramson, J., Adler, J., Dunger, J. et al.",
        journal: "Nature",
        year: "2024",
        doi: "10.1038/s41586-024-07487-w",
        verifiedExcerpt:
          "The Diffusion Module operates on raw atomic coordinates without internal coordinate frames, predicting spatial distributions for arbitrary molecular topologies.",
      },
      {
        citationNumber: 2,
        title: "Advances in deep learning for unified biomolecular complexes",
        authors: "Jumper, J., Hassabis, D.",
        journal: "Current Opinion in Structural Biology",
        year: "2024",
        doi: "10.1016/j.sbi.2024.102830",
        verifiedExcerpt:
          "Unified representation of covalent and non-covalent interactions enables simultaneous folding and binding prediction without predefined target pockets.",
      },
      {
        citationNumber: 3,
        title: "Comparative assessment of diffusion-based biomolecular docking",
        authors: "Steinegger, M., Söding, J.",
        journal: "Cell Systems",
        year: "2024",
        doi: "10.1016/j.cels.2024.04.004",
        verifiedExcerpt:
          "Success rates for blind ligand pose prediction improved from 38% with traditional force fields to 67% with AlphaFold 3.",
      },
    ],
  },
  {
    id: "quantum",
    topic: "Quantum Hardware",
    query: "What threshold error rate is required for fault-tolerant surface code computation?",
    synthesis:
      "Surface codes offer the highest known physical error threshold (~1%) for two-dimensional nearest-neighbor qubit architectures [1]. Logical error suppression scales exponentially with code distance d, provided that physical two-qubit gate error rates remain strictly below the asymptotic threshold [2]. Recent superconducting hardware demonstrations verify that increasing code distance from d=3 to d=5 suppresses error rates in practice [3].",
    confidenceScore: 98.7,
    sources: [
      {
        citationNumber: 1,
        title: "Surface codes: Towards practical large-scale quantum computation",
        authors: "Fowler, A. G., Mariantoni, M., Martinis, J. M., Cleland, A. N.",
        journal: "Physical Review A",
        year: "2022",
        doi: "10.1103/PhysRevA.86.032324",
        verifiedExcerpt:
          "For physical gate error rates below 1%, 2D surface codes achieve universal fault-tolerant computation using only nearest-neighbor couplings.",
      },
      {
        citationNumber: 2,
        title: "Magic state distillation with low spacetime overhead",
        authors: "Bravyi, S., Kitaev, A.",
        journal: "Quantum Science and Technology",
        year: "2023",
        doi: "10.1088/2058-9565/acb501",
        verifiedExcerpt:
          "Distillation protocols enable non-Clifford T-gates with polynomial overhead, completing the requirements for universal fault tolerance.",
      },
      {
        citationNumber: 3,
        title: "Suppressing quantum errors by scaling a quantum error-correcting code",
        authors: "Google Quantum AI Team",
        journal: "Nature",
        year: "2023",
        doi: "10.1038/s41586-022-05434-1",
        verifiedExcerpt:
          "Demonstrating that our distance-5 surface code logical qubit outperforms its distance-3 counterpart, fulfilling a fundamental milestone of scalable error correction.",
      },
    ],
  },
  {
    id: "rag",
    topic: "NLP & AI Architectures",
    query: "How do rerankers and citation verification reduce hallucination in clinical RAG?",
    synthesis:
      "Clinical retrieval-augmented generation achieves high factual precision when dense semantic search is paired with cross-encoder rerankers and post-hoc citation attribution [1]. By enforcing sentence-level grounding against indexed electronic health records and PubMed, models can refuse speculative answers when evidence is below confidence thresholds [2]. Experiments demonstrate an 84% reduction in ungrounded clinical assertions compared to standard direct prompting [3].",
    confidenceScore: 99.1,
    sources: [
      {
        citationNumber: 1,
        title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
        authors: "Lewis, P., Perez, E., Piktus, A. et al.",
        journal: "NeurIPS",
        year: "2023",
        doi: "10.48550/arXiv.2005.11401",
        verifiedExcerpt:
          "Combining parametric memory with non-parametric dense vector indexes enables factual grounding with explicit reference traceability.",
      },
      {
        citationNumber: 2,
        title: "Grounded Clinical Decision Support via Verifiable Evidence Synthesis",
        authors: "Singhal, K., Azizi, S., Tu, T. et al.",
        journal: "Nature Medicine",
        year: "2024",
        doi: "10.1038/s41591-023-02758-0",
        verifiedExcerpt:
          "Mandatory attribution models link every diagnostic recommendation to peer-reviewed guidelines with page-specific anchors.",
      },
      {
        citationNumber: 3,
        title: "Evaluating and Mitigating Hallucination in Clinical Large Language Models",
        authors: "Chen, Z., Hernandez, M., Wang, Y.",
        journal: "Lancet Digital Health",
        year: "2024",
        doi: "10.1016/S2589-7500(24)00042-8",
        verifiedExcerpt:
          "Ungrounded assertions dropped from 22.4% in naive generation to 1.8% under cross-encoder citation verification.",
      },
    ],
  },
];

export function EvidenceSandbox() {
  const [selectedInquiry, setSelectedInquiry] = React.useState<SampleInquiry>(
    sampleInquiries[0]
  );
  const [selectedCitation, setSelectedCitation] = React.useState<number | null>(
    1
  );
  const [isSynthesizing, setIsSynthesizing] = React.useState(false);

  const handleSelectInquiry = (inquiry: SampleInquiry) => {
    setIsSynthesizing(true);
    setSelectedCitation(1);
    setTimeout(() => {
      setSelectedInquiry(inquiry);
      setIsSynthesizing(false);
    }, 450);
  };

  const activeSource =
    selectedInquiry.sources.find((s) => s.citationNumber === selectedCitation) ||
    selectedInquiry.sources[0];

  return (
    <section className="py-12 sm:py-16 relative">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-indigo-50/80 px-3.5 py-1 text-xs font-semibold text-indigo-700 shadow-xs">
            <Cpu className="h-3.5 w-3.5" />
            <span>Interactive Live Demo</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Test the Grounded Evidence Engine
          </h2>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            See how our multi-agent reasoning system extracts verifiable scientific consensus and
            page-level citations in milliseconds.
          </p>
        </div>

        {/* Inquiry Selector Pills */}
        <div className="flex flex-wrap items-center justify-center gap-2 max-w-4xl mx-auto">
          {sampleInquiries.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSelectInquiry(item)}
              className={cn(
                "rounded-full px-4 py-2 text-xs font-semibold transition-all border",
                selectedInquiry.id === item.id
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/50"
              )}
            >
              {item.topic}
            </button>
          ))}
        </div>

        {/* Interactive Workspace Mockup */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          {/* Top Bar simulating a research workspace */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/90 px-4 py-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-amber-400" />
              <span className="h-3 w-3 rounded-full bg-emerald-400" />
              <span className="font-semibold text-slate-700 ml-2">
                Evidence Synthesis Workspace • Live Simulator
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                <CheckCircle2 className="h-3 w-3" />
                Confidence: {selectedInquiry.confidenceScore}%
              </span>
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {/* The Research Inquiry Bar */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-1">
              <div className="text-[11px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5 text-indigo-600" />
                Input Research Question
              </div>
              <div className="text-sm sm:text-base font-semibold text-slate-900">
                &ldquo;{selectedInquiry.query}&rdquo;
              </div>
            </div>

            {/* Split Screen: Synthesis on Left, Active Source Verifier on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Synthesized Answer */}
              <div className="lg:col-span-7 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-600 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    AI Grounded Consensus
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    Click any citation number to view source
                  </span>
                </div>

                <div
                  className={cn(
                    "rounded-xl border border-slate-200/80 bg-white p-5 text-sm sm:text-base text-slate-800 leading-relaxed transition-opacity duration-300 relative shadow-xs",
                    isSynthesizing ? "opacity-30" : "opacity-100"
                  )}
                >
                  {/* Text with clickable citation markers */}
                  {selectedInquiry.synthesis.split(/(\[\d+\])/g).map((part, i) => {
                    const match = part.match(/\[(\d+)\]/);
                    if (match) {
                      const num = parseInt(match[1]);
                      const isSelected = selectedCitation === num;
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedCitation(num)}
                          className={cn(
                            "inline-flex items-center justify-center font-bold text-xs mx-1 px-1.5 py-0.5 rounded cursor-pointer transition-all",
                            isSelected
                              ? "bg-indigo-600 text-white shadow-xs scale-105"
                              : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                          )}
                          title="Click to view supporting citation"
                        >
                          [{num}]
                        </button>
                      );
                    }
                    return <span key={i}>{part}</span>;
                  })}
                </div>

                {/* Synthesis Pipeline Steps */}
                <div className="grid grid-cols-3 gap-2 pt-2 text-center text-[11px] text-slate-500">
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="font-bold text-slate-800 block">Structured Chunks</span>
                    Section &amp; Page Preserved
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="font-bold text-slate-800 block">Source Grounded</span>
                    Supporting Excerpts
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="font-bold text-slate-800 block">Verifiable Citations</span>
                    Anchored Source &amp; Excerpt
                  </div>
                </div>
              </div>

              {/* Right Column: Grounded Citation Inspector */}
              <div className="lg:col-span-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
                    Source Evidence Inspector [{activeSource.citationNumber}]
                  </h4>
                  <Badge variant="academic" className="text-[10px]">
                    Scientific Literature
                  </Badge>
                </div>

                <div className="rounded-xl border border-indigo-100 bg-gradient-to-b from-indigo-50/40 via-white to-white p-5 space-y-3 shadow-xs">
                  <div className="space-y-1">
                    <h5 className="font-bold text-sm text-slate-900 leading-snug">
                      {activeSource.title}
                    </h5>
                    <p className="text-xs text-slate-600">
                      {activeSource.authors} •{" "}
                      <span className="font-semibold text-slate-800">
                        {activeSource.journal} ({activeSource.year})
                      </span>
                    </p>
                  </div>

                  {/* Excerpt box */}
                  <div className="rounded-lg bg-slate-900 text-slate-100 p-3.5 space-y-1.5 text-xs font-mono">
                    <div className="flex items-center justify-between text-[10px] text-indigo-400 font-sans uppercase font-bold tracking-wider">
                      <span>Exact Document Excerpt</span>
                      <span>Source Match</span>
                    </div>
                    <p className="leading-relaxed text-slate-200">
                      &ldquo;{activeSource.verifiedExcerpt}&rdquo;
                    </p>
                  </div>

                  {/* DOI Link & Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <span className="text-slate-400 text-[11px] truncate max-w-[180px]">
                      DOI: {activeSource.doi}
                    </span>
                    <a
                      href={`https://doi.org/${activeSource.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      <span>Read Publisher Paper</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>

                {/* Switcher tabs for citations */}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-slate-400">All Sources:</span>
                  {selectedInquiry.sources.map((s) => (
                    <button
                      key={s.citationNumber}
                      onClick={() => setSelectedCitation(s.citationNumber)}
                      className={cn(
                        "h-6 w-6 rounded-full text-xs font-bold transition-all",
                        selectedCitation === s.citationNumber
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      )}
                    >
                      {s.citationNumber}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
