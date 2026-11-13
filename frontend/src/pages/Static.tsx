import { Link } from "react-router";

import { Container } from "@/components/Layout";

export function PrivacyPage() {
  return (
    <Container className="max-w-3xl">
      <article className="space-y-4 text-slate-700">
        <h1 className="text-2xl font-semibold text-slate-900">Privacy notice</h1>
        <p>PaperAid Pro (“Silver”) stores only what is needed to provide the service.</p>
        <h2 className="pt-2 font-semibold text-slate-900">What we store</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your account: name, email address and sign-in provider (managed by Firebase Authentication).</li>
          <li>Your library, collections, notes, tags, documents, document history and research conversations.</li>
          <li>PDFs you upload or ask us to retrieve. These are stored in private Google Cloud Storage and served only to you.</li>
        </ul>
        <h2 className="pt-2 font-semibold text-slate-900">What is shared</h2>
        <p>
          Search queries are sent to public scholarly databases (OpenAlex, Crossref, PubMed, Semantic Scholar, arXiv) to find literature. When AI
          features are enabled, the question and the relevant excerpts from the selected papers are sent to the configured AI provider to generate an
          answer. Your uploads are never added to the public catalog.
        </p>
        <h2 className="pt-2 font-semibold text-slate-900">Your choices</h2>
        <p>You can delete documents, uploads and conversations at any time. To close your account and delete all of your data, contact the project maintainers.</p>
      </article>
    </Container>
  );
}

export function NotFoundPage() {
  return (
    <Container className="max-w-xl py-24 text-center">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-slate-600">The page you’re looking for doesn’t exist or you don’t have access to it.</p>
      <Link to="/" className="mt-6 inline-block font-medium text-brand-700">Go home</Link>
    </Container>
  );
}
