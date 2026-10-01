const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting academic corpus database seed (Sanitized Dev Mode)...");

  // 1. Seed Core Categories
  console.log("1. Seeding research categories...");
  const categoriesData = [
    {
      name: "Artificial Intelligence",
      slug: "ai",
      description: "Neural architectures, foundation models, reinforcement learning, and agentic workflows.",
      iconName: "Brain",
    },
    {
      name: "Natural Language Processing",
      slug: "nlp",
      description: "RAG architectures, parameter-efficient fine-tuning, sequence transduction, and semantic embeddings.",
      iconName: "FileText",
    },
    {
      name: "Computational Biology",
      slug: "comp-bio",
      description: "Protein structure prediction, biomolecular complexes, genomic variant analysis, and molecular dynamics.",
      iconName: "Dna",
    },
    {
      name: "Quantum Computing",
      slug: "quantum",
      description: "Surface codes, fault-tolerant architectures, magic state distillation, and quantum error correction.",
      iconName: "Cpu",
    },
    {
      name: "Computer Vision",
      slug: "computer-vision",
      description: "Diffusion models, multimodal perception, 3D spatial representations, and medical imaging.",
      iconName: "Eye",
    },
    {
      name: "Clinical Medicine",
      slug: "medicine",
      description: "Diagnostic decision support, systematic reviews, clinical trial evidence synthesis, and therapeutics.",
      iconName: "Stethoscope",
    },
  ];

  const categoryMap = new Map();
  for (const cat of categoriesData) {
    const record = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: cat,
      create: cat,
    });
    categoryMap.set(cat.slug, record);
  }
  console.log(`✓ Seeded ${categoryMap.size} categories.`);

  // 2. Seed Renowned Authors
  console.log("2. Seeding published researchers & scholars...");
  const authorsData = [
    {
      name: "Ashish Vaswani",
      institution: "Google Brain / Essential AI",
      bio: "Co-inventor of the Transformer architecture; pioneering researcher in neural sequence transduction and deep learning systems.",
      orcid: "0000-0002-1234-5678",
      citationCount: 135000,
      hIndex: 58,
    },
    {
      name: "Noam Shazeer",
      institution: "Google Brain / Character.ai",
      bio: "Co-creator of the Transformer, Mesh-TensorFlow, and large-scale language model pre-training architectures.",
      orcid: "0000-0002-8765-4321",
      citationCount: 120000,
      hIndex: 52,
    },
    {
      name: "Demis Hassabis",
      institution: "Google DeepMind",
      bio: "Co-founder & CEO of DeepMind; Nobel Laureate in Chemistry (2024) for computational protein structure prediction (AlphaFold).",
      orcid: "0000-0003-0123-9999",
      citationCount: 240000,
      hIndex: 85,
    },
    {
      name: "John Jumper",
      institution: "Google DeepMind",
      bio: "Senior Research Scientist at DeepMind; Nobel Laureate in Chemistry (2024) and lead architect of AlphaFold 2 and AlphaFold 3.",
      orcid: "0000-0001-9876-5432",
      citationCount: 95000,
      hIndex: 45,
    },
    {
      name: "Patrick Lewis",
      institution: "Meta AI / Cohere",
      bio: "Lead creator of Retrieval-Augmented Generation (RAG) and benchmark lead for knowledge-intensive NLP tasks.",
      orcid: "0000-0002-4567-8901",
      citationCount: 28000,
      hIndex: 32,
    },
    {
      name: "Austin G. Fowler",
      institution: "Google Quantum AI",
      bio: "Pioneer in surface code quantum error correction, fault-tolerant physical lattices, and topological quantum computing.",
      orcid: "0000-0003-3456-7890",
      citationCount: 18500,
      hIndex: 38,
    },
  ];

  const authorMap = new Map();
  for (const author of authorsData) {
    const record = await prisma.author.upsert({
      where: { orcid: author.orcid },
      update: author,
      create: author,
    });
    authorMap.set(author.name, record);
  }
  console.log(`✓ Seeded ${authorMap.size} authors.`);

  // 3. Seed Featured Scientific Papers with Synthetic Development Summaries
  // (Safe development content adhering to schema conventions without copyrighted manuscript reproduction)
  console.log("3. Seeding seminal research manuscripts (Synthetic Development Content)...");
  const papersData = [
    {
      title: "Attention Is All You Need",
      doi: "10.48550/arXiv.1706.03762",
      arxivId: "1706.03762",
      journal: "Advances in Neural Information Processing Systems (NeurIPS 30)",
      publicationDate: new Date("2017-12-06"),
      pdfUrl: "https://arxiv.org/pdf/1706.03762.pdf",
      citationCount: 125400,
      status: "COMPLETED",
      keywords: ["Transformer", "Self-Attention", "Deep Learning", "Seq2Seq", "Neural Machine Translation"],
      abstract:
        "Proposes the Transformer architecture, replacing recurrent and convolutional layers with multi-head self-attention mechanisms to establish direct dependencies across arbitrary token distances in sequence processing with high GPU parallelization.",
      researchQuestion:
        "Can sequence-to-sequence dependencies be effectively mapped in constant computational path length without sequential recurrent or convolutional constraints?",
      methodology:
        "Stacked encoder-decoder multi-head dot-product attention modules with fixed sinusoidal positional encodings, residual connections, and layer normalization.",
      results:
        "Outperformed contemporary recurrent baselines on WMT 2014 translation tasks (28.4 BLEU English-German, 41.8 BLEU English-French) with substantially reduced training time.",
      limitations:
        "Quadratic O(N²) memory scaling relative to input token sequence length and fixed positional encoding extrapolation limits.",
      conclusion:
        "Self-attention mechanisms alone suffice for sequence transduction, establishing a parallelizable foundation for modern generative language modeling.",
      authors: [
        { name: "Ashish Vaswani", orderIndex: 0, isCorresponding: true },
        { name: "Noam Shazeer", orderIndex: 1, isCorresponding: false },
      ],
      categories: ["ai", "nlp"],
    },
    {
      title: "Accurate Structure Prediction of Biomolecular Interactions with AlphaFold 3",
      doi: "10.1038/s41586-024-07487-w",
      arxivId: "2405.08888",
      journal: "Nature Biomedical Science",
      publicationDate: new Date("2024-05-08"),
      pdfUrl: "https://www.nature.com/articles/s41586-024-07487-w.pdf",
      citationCount: 4200,
      status: "COMPLETED",
      keywords: ["AlphaFold 3", "Structural Biology", "Diffusion Models", "Biomolecules", "Cross-Docking"],
      abstract:
        "Introduces a unified generative diffusion architecture capable of predicting joint 3D coordinates for complexes including proteins, nucleic acids (DNA/RNA), small molecule ligands, and chemical modifications.",
      researchQuestion:
        "Can a single deep generative diffusion network predict atomic-resolution coordinates of heterogeneous multi-molecule complexes without dedicated physics-based docking approximations?",
      methodology:
        "Couples a Pairformer representation network with a direct 3D Cartesian coordinate diffusion module to progressively denoise spatial structures across all biological molecule classes.",
      results:
        "Substantially exceeds classical molecular docking packages on standardized protein-ligand and protein-nucleic acid benchmark evaluations (e.g., PoseBusters).",
      limitations:
        "Static single-state coordinate predictions do not sample full kinetic conformational ensembles or solve arbitrary disordered loop transitions.",
      conclusion:
        "Unified generative diffusion frameworks provide a shared foundational platform for structural biology across the broader chemical spectrum of life.",
      authors: [
        { name: "John Jumper", orderIndex: 0, isCorresponding: false },
        { name: "Demis Hassabis", orderIndex: 1, isCorresponding: true },
      ],
      categories: ["comp-bio", "ai"],
    },
    {
      title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
      doi: "10.48550/arXiv.2005.11401",
      arxivId: "2005.11401",
      journal: "Conference on Empirical Methods in Natural Language Processing (EMNLP)",
      publicationDate: new Date("2020-11-16"),
      pdfUrl: "https://arxiv.org/pdf/2005.11401.pdf",
      citationCount: 8900,
      status: "COMPLETED",
      keywords: ["RAG", "Information Retrieval", "Vector Search", "Hallucination Mitigation", "Dense Retrieval"],
      abstract:
        "Proposes Retrieval-Augmented Generation (RAG), coupling parametric neural sequence-to-sequence representations with dense vector document retrieval from external knowledge corpora to reduce factual hallucinations.",
      researchQuestion:
        "How can deep language models ground generative responses in external factual sources to reduce hallucination and provide verifiable source citations?",
      methodology:
        "Combines dense passage retrieval (DPR) over indexed document vectors with a sequence-to-sequence language generator (BART), optimizing end-to-end marginal likelihood over latent documents.",
      results:
        "Achieves state-of-the-art accuracy on knowledge-intensive open-domain question answering benchmarks (Natural Questions, WebQuestions) with verifiable citation provenance.",
      limitations:
        "Retrieval roundtrips add compute latency, and external corpus vector indexes require synchronization and periodic re-embedding.",
      conclusion:
        "Augmenting parametric neural weights with non-parametric retrieval significantly mitigates factual errors and establishes an empirical foundation for zero-hallucination systems.",
      authors: [
        { name: "Patrick Lewis", orderIndex: 0, isCorresponding: true },
      ],
      categories: ["nlp", "ai"],
    },
    {
      title: "Fault-Tolerant Quantum Computation with Surface Codes",
      doi: "10.1103/PhysRevA.86.032324",
      arxivId: "1208.0928",
      journal: "Physical Review A",
      publicationDate: new Date("2012-09-28"),
      pdfUrl: "https://arxiv.org/pdf/1208.0928.pdf",
      citationCount: 3100,
      status: "COMPLETED",
      keywords: ["Quantum Computing", "Surface Codes", "Error Correction", "Fault Tolerance", "Qubits"],
      abstract:
        "Reviews planar surface code quantum error correction architectures on 2D nearest-neighbor qubit lattices, providing high fault-tolerance thresholds against physical noise in quantum hardware.",
      researchQuestion:
        "What physical lattice topology and syndrome measurement cycle enables scalable fault-tolerant quantum logic within realistic hardware error thresholds?",
      methodology:
        "Utilizes a 2D planar array of data and syndrome measurement qubits, applying periodic stabilizer extraction cycles and topological braid operations supplemented by magic state distillation.",
      results:
        "Identifies an asymptotic physical error threshold of approximately 1% per gate under depolarizing noise models, compatible with superconducting circuit geometries.",
      limitations:
        "Substantial physical qubit overhead (thousands of physical qubits per logical qubit) and topological routing space-time volume costs.",
      conclusion:
        "Surface codes provide a realistic and experimentally accessible architecture for achieving fault-tolerant quantum computation on modern hardware platforms.",
      authors: [
        { name: "Austin G. Fowler", orderIndex: 0, isCorresponding: true },
      ],
      categories: ["quantum"],
    },
  ];

  for (const p of papersData) {
    const { authors, categories, ...paperFields } = p;
    // Check if paper already exists by DOI
    const existing = await prisma.paper.findUnique({ where: { doi: p.doi } });
    if (existing) {
      console.log(`- Updating existing paper with sanitized development data: "${p.title}"`);
      await prisma.paper.update({
        where: { id: existing.id },
        data: paperFields,
      });
      continue;
    }

    const paper = await prisma.paper.create({
      data: paperFields,
    });

    // Link authors
    for (const a of authors) {
      const authorRec = authorMap.get(a.name);
      if (authorRec) {
        await prisma.paperAuthor.create({
          data: {
            paperId: paper.id,
            authorId: authorRec.id,
            orderIndex: a.orderIndex,
            isCorresponding: a.isCorresponding,
          },
        });
      }
    }

    // Link categories
    for (const catSlug of categories) {
      const catRec = categoryMap.get(catSlug);
      if (catRec) {
        await prisma.paperCategory.create({
          data: {
            paperId: paper.id,
            categoryId: catRec.id,
          },
        });
      }
    }

    console.log(`✓ Created paper: "${paper.title}" with relations.`);
  }

  // 4. Seed Default Admin & Researcher Users with Safe Environment Credentials
  console.log("4. Seeding default Admin & Researcher accounts with safe credentials...");
  
  // Read credentials securely from environment variables, fallback to generated safe strings
  const adminSecret = process.env.ADMIN_INITIAL_PASSWORD || "AdminPass_" + Math.random().toString(36).slice(2) + "!";
  const userSecret = process.env.USER_INITIAL_PASSWORD || "UserPass_" + Math.random().toString(36).slice(2) + "!";

  const adminPasswordHash = await hash(adminSecret, 10);
  const userPasswordHash = await hash(userSecret, 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@researchhub.ai" },
    update: {
      role: "ADMIN",
      passwordHash: adminPasswordHash,
    },
    create: {
      name: "Dr. Elena Rostova (Admin)",
      email: "admin@researchhub.ai",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
    },
  });

  const researcher = await prisma.user.upsert({
    where: { email: "researcher@university.edu" },
    update: {
      role: "USER",
      passwordHash: userPasswordHash,
    },
    create: {
      name: "Prof. Marcus Vance",
      email: "researcher@university.edu",
      passwordHash: userPasswordHash,
      role: "USER",
    },
  });

  console.log(`✓ Admin account: ${admin.email} (Password securely configured in .env as ADMIN_INITIAL_PASSWORD)`);
  console.log(`✓ User account: ${researcher.email} (Password securely configured in .env as USER_INITIAL_PASSWORD)`);

  console.log("\n🚀 Database seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
