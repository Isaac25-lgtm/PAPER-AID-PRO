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
  category: "research" | "writing" | "citations";
  href: string;
  badge?: string;
  iconName: string;
}

export interface FAQItem {
  question: string;
  answer: string;
  category: "integrity" | "discovery" | "library";
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
    { title: "Catalog", href: "/papers" },
    { title: "Research", href: "/research" },
    { title: "AI Editor", href: "/editor" },
    { title: "History", href: "/history" },
  ] as NavItem[],

  userNavItems: [
    { title: "My Library", href: "/library" },
    { title: "AI Editor", href: "/editor" },
    { title: "Research", href: "/research" },
    { title: "History", href: "/history" },
    { title: "Admin Portal", href: "/admin" },
  ] as NavItem[],

  academicTools: [
    {
      id: "find-articles",
      title: "Literature Discovery",
      description: "Search scientific research papers, authors, preprints, and citation records across federated scholarly databases.",
      category: "research",
      href: "/discover",
      iconName: "Compass",
    },
    {
      id: "paper-catalog",
      title: "Indexed Paper Catalog",
      description: "Browse ingested manuscripts with extracted sections, evidence-grounded AI summaries, and original PDF access.",
      category: "research",
      href: "/papers",
      iconName: "FileText",
    },
    {
      id: "systematic-review",
      title: "Multi-Paper Research & Synthesis",
      description: "Literature synthesis and grounded Q&A across multiple papers with verifiable page and section evidence anchors.",
      category: "research",
      href: "/research",
      iconName: "SearchCheck",
    },
    {
      id: "ai-editor",
      title: "Academic AI Editor",
      description: "Compose research papers with autosave, verified passage citations linked to source chunks, and scholarly revision exports.",
      category: "writing",
      href: "/editor",
      iconName: "PenTool",
    },
    {
      id: "my-library",
      title: "My Library & Collections",
      description: "Organize saved papers into collections, import by DOI/PMID/PMCID, and manage private uploaded manuscripts.",
      category: "research",
      href: "/library",
      iconName: "BookOpenCheck",
    },
    {
      id: "citation-generator",
      title: "Citation Generator & Verifier",
      description: "Format citations in APA 7th, MLA 9th, Chicago, IEEE, and BibTeX, and verify references against authoritative registries.",
      category: "citations",
      href: "/tools/citation-generator",
      iconName: "Quote",
    },
  ] as AcademicTool[],

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
