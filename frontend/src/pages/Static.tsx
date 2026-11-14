import type { ReactNode } from "react";
import { Link } from "react-router";

import { Container } from "@/components/Layout";

/** Version shown on the policies; must match the API's POLICY_VERSION (backend/app/policy.py). */
export const POLICY_VERSION = "2026-11-14";
const CONTACT = import.meta.env.VITE_PRIVACY_CONTACT_EMAIL as string | undefined;

function Contact() {
  return CONTACT ? <a className="text-brand-700 underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> : <span>the contact address published on this page (being finalised)</span>;
}

function Policy({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Container className="max-w-3xl">
      <article className="space-y-4 text-slate-700 [&_h2]:pt-3 [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500">Version {POLICY_VERSION}</p>
        {children}
      </article>
    </Container>
  );
}

export function TermsPage() {
  return (
    <Policy title="Terms of Service">
      <p>These terms govern your use of PaperAid Pro (“the service”). By creating an account and ticking “I agree”, you accept them.</p>
      <h2>Who can use it</h2>
      <p>You must be 18 or older. During the private test, access is by invitation only. Each account is for one person; keep your sign-in secure.</p>
      <h2>Acceptable use</h2>
      <ul>
        <li>Use PaperAid Pro for your own study, research and writing.</li>
        <li>Upload only material you have the right to use. Do not upload anything unlawful or anything that infringes someone else’s rights.</li>
        <li>Do not use the service to write work for others to submit as their own, to attack the service, or to scrape it.</li>
      </ul>
      <h2>Academic integrity</h2>
      <p>
        You are responsible for the work you submit. Follow your institution’s rules on the use of AI tools and on citation. Check every source
        and every AI-assisted statement before you rely on it.
      </p>
      <h2>AI output</h2>
      <p>
        AI features can be wrong. PaperAid Pro removes statements it cannot verify against the cited text, but it cannot guarantee that an answer
        is complete or correct. AI output is a starting point for your own reading, not a substitute for it.
      </p>
      <h2>Your content</h2>
      <p>
        You keep all rights to your documents, notes and uploads. You allow us to store and process them only to provide the service to you, as
        described in the <Link className="text-brand-700 underline" to="/privacy">Privacy Notice</Link>. Scholarly metadata in the shared catalog
        comes from public registries.
      </p>
      <h2>Availability and changes</h2>
      <p>
        The service is provided “as is” during testing, and features may change. We may suspend accounts that break these terms. If these terms
        change, you will be asked to review and accept them again before continuing.
      </p>
      <h2>Liability</h2>
      <p>To the extent the law allows, PaperAid Pro is not liable for indirect losses or for decisions you make based on content in the service.</p>
      <h2>Governing law and contact</h2>
      <p>These terms are governed by the laws of Uganda. Questions: <Contact />.</p>
    </Policy>
  );
}

export function PrivacyPage() {
  return (
    <Policy title="Privacy Notice">
      <p>This notice explains what PaperAid Pro (“Silver”) collects, why, who processes it, and the choices and rights you have.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your name, email address and sign-in method (managed by Firebase Authentication).</li>
        <li><strong>Your work:</strong> your library, collections, notes, tags, documents and their history, research questions and answers, and PDFs you upload or ask us to retrieve.</li>
        <li><strong>Consent records:</strong> what you agreed to, which version and when.</li>
        <li><strong>Technical logs:</strong> request time, an anonymised network address used only for abuse prevention (rate limits), and error details. We do not use advertising or tracking cookies.</li>
      </ul>
      <h2>Why we use it</h2>
      <p>Only to provide the service you ask for: storing your work, finding and formatting sources, answering questions about papers you choose, and keeping the service secure.</p>
      <h2>Who processes it</h2>
      <ul>
        <li><strong>Google Cloud and Firebase</strong> host the service, database, files and sign-in. Data is stored in the European Union (Netherlands).</li>
        <li><strong>Scholarly databases</strong> (OpenAlex, Crossref, Semantic Scholar, DOAJ, PubMed, Europe PMC, arXiv, CORE, Open Library) receive your search terms and identifiers only. They never receive your name, email or documents.</li>
        <li><strong>The AI provider</strong>, when AI features are switched on, receives your question and the excerpts of the papers you selected, solely to produce the answer. It is not allowed to use them for training.</li>
      </ul>
      <p>Because these providers operate internationally, your data may be processed outside your country, under their contractual data-protection safeguards.</p>
      <h2>How long we keep it</h2>
      <p>For as long as your account exists. When you delete something, it is removed; when you close your account, all of your data and your sign-in are deleted. Consent records are kept, without your name or email, as proof of what was agreed.</p>
      <h2>Your rights and choices</h2>
      <ul>
        <li><strong>Download your data</strong> at any time: Account → Download my data.</li>
        <li><strong>Close your account</strong> and delete everything: Account → Delete my account.</li>
        <li><strong>Correct</strong> your name in Account; <strong>withdraw</strong> optional consents (product emails, analytics) in Account.</li>
        <li>Ask us about, or object to, how your data is used: <Contact />. You may also complain to the data-protection authority in your country.</li>
      </ul>
      <h2>Security</h2>
      <p>Uploads are stored privately and sent only to you; connections are encrypted; access to your data inside PaperAid Pro is limited to your own account. If a breach affects your data, we will notify you and the relevant authorities as the law requires.</p>
      <p>See also the <Link className="text-brand-700 underline" to="/ai-notice">AI Use Notice</Link> and the <Link className="text-brand-700 underline" to="/terms">Terms of Service</Link>.</p>
    </Policy>
  );
}

export function AINoticePage() {
  return (
    <Policy title="AI Use Notice">
      <p>Some PaperAid Pro features use an AI model. This page explains when, what is sent and how answers are checked.</p>
      <h2>When AI is used</h2>
      <p>Only when you ask for it: questions about papers, paper summaries, overviews of search results, and writing help (rewrite or suggest the next sentence). Search, your library, citations and reference checking do not use AI.</p>
      <h2>What is sent</h2>
      <p>Your question or the text you selected, and excerpts from the papers you chose. Never your password, and never your other documents or uploads.</p>
      <h2>How answers are checked</h2>
      <ul>
        <li>Every statement must quote the passage it relies on, and the quote must really appear in that paper.</li>
        <li>Numbers must match the quoted text, including sign and unit.</li>
        <li>A second check confirms the passage supports the statement. Statements that fail are removed, and the answer tells you how many.</li>
      </ul>
      <p>Even so, AI can be wrong. Click a source marker to read the exact passage before you use an answer in your own work, and follow your institution’s rules on AI use.</p>
    </Policy>
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
