export interface NavItem {
  title: string;
  href: string;
  description?: string;
  badge?: string;
}

export interface AcademicTool {
  id: string;
  title: string;
  description: string;
  category: "research" | "writing" | "citations" | "analytics";
  href: string;
  badge?: string;
  iconName: string;
}

export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  creditsPerMonth: number;
  popular?: boolean;
  ctaText: string;
  features: string[];
  creditBreakdown: {
    searches: string;
    pdfChats: string;
    thesisGeneration: string;
    dataAnalysis: string;
  };
}

export interface FAQItem {
  question: string;
  answer: string;
  category: "integrity" | "features" | "pricing" | "api";
}

export const siteConfig = {
  name: "AI Research Hub",
  tagline: "Academic Literature Intelligence",
  description:
    "An academic platform for discovering, reading, understanding, and organizing scientific research with verifiable citations.",
  url: "https://research-hub.ai",

  navItems: [
    { title: "Home", href: "/" },
    { title: "Discover", href: "/discover" },
    { title: "Library", href: "/papers" },
    { title: "Research", href: "/research" },
    { title: "History", href: "/history" },
  ] as NavItem[],

  userNavItems: [
    { title: "Library", href: "/papers" },
    { title: "History", href: "/history" },
    { title: "Admin Portal", href: "/admin" },
  ] as NavItem[],

  academicTools: [
    // 1. Research & Review
    {
      id: "deep-reasoning",
      title: "Deep Reasoning",
      description: "Literature analysis with source-grounded academic evidence.",
      category: "research",
      href: "/conversations",
      badge: "Roadmap",
      iconName: "Brain",
    },
    {
      id: "chat-pdf",
      title: "PDF Chat & Evidence",
      description: "Ask deep research questions across multi-page papers with exact paragraph & page citations.",
      category: "research",
      href: "/papers",
      badge: "Roadmap",
      iconName: "FileText",
    },
    {
      id: "systematic-review",
      title: "Structured Synthesis",
      description: "Literature synthesis across multiple papers with verifiable evidence anchors.",
      category: "research",
      href: "/research",
      badge: "Beta",
      iconName: "SearchCheck",
    },
    {
      id: "find-articles",
      title: "Find Articles & Corpus",
      description: "Search scientific research papers, authors, preprints, and citation records.",
      category: "research",
      href: "/papers",
      iconName: "Compass",
    },

    // 2. Writing & Publishing
    {
      id: "thesis-to-manuscript",
      title: "Thesis to Manuscript",
      description: "Transform research dissertations into peer-reviewed journal formats with figures preserved.",
      category: "writing",
      href: "/papers",
      badge: "Roadmap",
      iconName: "BookOpenCheck",
    },
    {
      id: "ai-thesis",
      title: "AI Thesis & Proposal Studio",
      description: "Draft comprehensive research proposals, literature chapters, and methodology frameworks.",
      category: "writing",
      href: "/papers",
      badge: "Roadmap",
      iconName: "GraduationCap",
    },
    {
      id: "ai-editor",
      title: "Academic AI Editor",
      description: "Refine prose for high-impact journal standards with clarity and formal phrasing.",
      category: "writing",
      href: "/papers",
      badge: "Roadmap",
      iconName: "PenTool",
    },
    {
      id: "manuscript-reviewer",
      title: "Manuscript Reviewer",
      description: "Simulate rigorous double-blind peer review with feedback on methodology and claims.",
      category: "writing",
      href: "/papers",
      badge: "Roadmap",
      iconName: "CheckCircle2",
    },
    {
      id: "ai-humanizer",
      title: "Academic Paraphraser",
      description: "Ensure organic, scholarly flow while preserving nuanced scientific meaning.",
      category: "writing",
      href: "/papers",
      badge: "Roadmap",
      iconName: "Sparkles",
    },

    // 3. Citations & References
    {
      id: "citation-generator",
      title: "Citation Generator",
      description: "Formatting in APA 7th, MLA 9th, Chicago, IEEE, Harvard, and export to BibTeX.",
      category: "citations",
      href: "/papers",
      badge: "Roadmap",
      iconName: "Quote",
    },
    {
      id: "zotero-mendeley-sync",
      title: "Reference Manager Sync",
      description: "Integration with Zotero, Mendeley, and EndNote libraries.",
      category: "citations",
      href: "/saved",
      badge: "Roadmap",
      iconName: "FolderSync",
    },

    // 4. Data & Analytics
    {
      id: "data-analysis",
      title: "Smart Data Analysis",
      description: "Upload research datasets for automated hypothesis testing and publication charts.",
      category: "analytics",
      href: "/papers",
      badge: "Roadmap",
      iconName: "BarChart3",
    },
    {
      id: "form-builder",
      title: "Research Form Builder",
      description: "Design structured research surveys and collect academic data.",
      category: "analytics",
      href: "/papers",
      badge: "Roadmap",
      iconName: "ClipboardList",
    },
    {
      id: "scholar-mcp",
      title: "Scholar MCP Server",
      description: "Connect research literature directly into IDEs and agent workflows via MCP.",
      category: "analytics",
      href: "/papers",
      badge: "Roadmap",
      iconName: "Cpu",
    },
  ] as AcademicTool[],

  pricingPlans: [
    {
      id: "free",
      name: "Explorer",
      description: "Essential discovery for students and curious independent researchers.",
      monthlyPrice: 0,
      annualPrice: 0,
      creditsPerMonth: 100,
      ctaText: "Start Exploring Free",
      features: [
        "100 AI research credits / month",
        "Search scientific paper catalog",
        "Access original PDF manuscripts",
        "Grounded AI summaries & citations",
        "Personal My Library bookmarks",
        "Community support",
      ],
      creditBreakdown: {
        searches: "Catalog queries",
        pdfChats: "Manuscript analysis",
        thesisGeneration: "Not included",
        dataAnalysis: "Basic preview",
      },
    },
    {
      id: "scholar",
      name: "Scholar",
      description: "For active PhD candidates, graduate students, and independent academics.",
      monthlyPrice: 10,
      annualPrice: 8,
      creditsPerMonth: 500,
      ctaText: "Upgrade to Scholar",
      features: [
        "500 AI research credits / month",
        "Full literature search & discovery",
        "Evidence-grounded paper understanding",
        "Original PDF reading & extraction",
        "Advanced My Library collections",
        "Standard email support",
      ],
      creditBreakdown: {
        searches: "Catalog queries",
        pdfChats: "Expanded paper analysis",
        thesisGeneration: "Draft chapters (Roadmap)",
        dataAnalysis: "Standard datasets (Roadmap)",
      },
    },
    {
      id: "pro",
      name: "Pro Researcher",
      description: "The complete suite for professors, postdocs, and R&D research teams.",
      monthlyPrice: 25,
      annualPrice: 19,
      creditsPerMonth: 1500,
      popular: true,
      ctaText: "Get Pro Access",
      features: [
        "1,500 AI research credits / month",
        "Priority paper processing",
        "Full evidence provenance & chunk viewer",
        "Unlimited saved papers & library tags",
        "Priority compute queue",
        "24/7 Priority academic support",
      ],
      creditBreakdown: {
        searches: "Unlimited queries",
        pdfChats: "High-volume analysis",
        thesisGeneration: "Priority exports (Roadmap)",
        dataAnalysis: "Full analysis (Roadmap)",
      },
    },
    {
      id: "lab",
      name: "Lab & Institution",
      description: "High-volume compute, multi-seat licenses, and programmatic access.",
      monthlyPrice: 85,
      annualPrice: 68,
      creditsPerMonth: 12000,
      ctaText: "Empower Your Lab",
      features: [
        "12,000 AI research credits / month",
        "Multi-seat team workspace (up to 5 team members)",
        "Batch manuscript ingestion",
        "Centralized administrative billing",
        "Dedicated account manager & SLA guarantee",
      ],
      creditBreakdown: {
        searches: "Unlimited queries",
        pdfChats: "Parallel batch processing",
        thesisGeneration: "Custom exports (Roadmap)",
        dataAnalysis: "Institutional pipelines",
      },
    },
  ] as PricingPlan[],

  academicFaqs: [
    {
      question: "How does Evidence Grounding work in AI Research Hub?",
      answer:
        "Key AI-generated findings are linked to supporting manuscript excerpts, with page and section context where available. If sufficient supporting source evidence is not available, the system withholds or flags the unsupported finding rather than inventing evidence.",
      category: "integrity",
    },
    {
      question: "What types of scientific documents are indexed?",
      answer:
        "The platform supports peer-reviewed journal manuscripts, preprints, conference proceedings, and uploaded research documents. Manuscripts are stored securely and processed with deterministic page and section boundaries.",
      category: "discovery",
    },
    {
      question: "Can researchers browse papers without creating an account?",
      answer:
        "Yes! Literature discovery, keyword and semantic search, paper abstracts, original PDF reading links, and existing evidence-grounded summaries are completely free to explore without signing up.",
      category: "discovery",
    },
    {
      question: "How does hybrid semantic search work?",
      answer:
        "AI Research Hub combines exact keyword matching (titles, DOIs, authors) with pgvector cosine similarity across manuscript text chunks, helping you discover relevant papers even when your search terms differ from the author's phrasing.",
      category: "discovery",
    },
    {
      question: "What is the purpose of My Library?",
      answer:
        "My Library allows authenticated researchers to bookmark, organize, and quickly revisit relevant literature and evidence-grounded studies during their research workflow.",
      category: "library",
    },
    {
      question: "How are original PDF manuscripts handled?",
      answer:
        "Original PDFs are stored in dedicated cloud storage and can be streamed directly in your browser. Document text is extracted deterministically to preserve headings, page numbers, and exact quotes.",
      category: "library",
    },
  ] as FAQItem[],

  categories: [
    {
      id: "cs-ai",
      name: "Artificial Intelligence",
      slug: "ai",
      description: "Neural architectures, foundation models, reinforcement learning, and agentic workflows.",
      paperCount: 1420,
    },
    {
      id: "cs-cv",
      name: "Computer Vision",
      slug: "computer-vision",
      description: "Diffusion models, multimodal scene understanding, and medical image segmentation.",
      paperCount: 890,
    },
    {
      id: "cs-nlp",
      name: "Natural Language Processing",
      slug: "nlp",
      description: "RAG architectures, parameter-efficient fine-tuning, and semantic embeddings.",
      paperCount: 1150,
    },
    {
      id: "bio-gen",
      name: "Computational Biology",
      slug: "comp-bio",
      description: "Protein folding, genomic variant analysis, and molecular dynamics modeling.",
      paperCount: 670,
    },
    {
      id: "med-ai",
      name: "Clinical Medicine",
      slug: "medicine",
      description: "Diagnostic decision support, clinical trials synthesis, and patient outcome prediction.",
      paperCount: 540,
    },
    {
      id: "quantum",
      name: "Quantum Computing",
      slug: "quantum",
      description: "Quantum error correction, hybrid quantum-classical algorithms, and simulation.",
      paperCount: 380,
    },
  ],
};
