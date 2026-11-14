import { useMutation } from "@tanstack/react-query";
import { Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { api, errorMessage } from "@/lib/api";
import type { Paper } from "@/lib/types";
import { Alert, Button, Input, Label, Select } from "./ui";

/** Source types for manual entry, with the fields each one needs (CSL types on the API side). */
export const MANUAL_TYPES = [
  { value: "book", label: "Book", fields: ["publisher", "place", "edition", "isbn"] },
  { value: "chapter", label: "Book chapter", fields: ["container_title", "editors", "publisher", "place", "pages"] },
  { value: "article-journal", label: "Journal article (no DOI)", fields: ["container_title", "volume", "issue", "pages", "url"] },
  { value: "article-newspaper", label: "Newspaper or magazine article", fields: ["container_title", "date", "pages", "url"] },
  { value: "report", label: "Report or policy document", fields: ["publisher", "place", "number", "url"] },
  { value: "thesis", label: "Thesis or dissertation", fields: ["publisher", "genre", "place", "url"] },
  { value: "paper-conference", label: "Conference paper", fields: ["container_title", "publisher", "place", "pages"] },
  { value: "webpage", label: "Web page", fields: ["container_title", "date", "url", "accessed"] },
  { value: "legal_case", label: "Court case", fields: ["authority", "number", "container_title", "volume", "pages"] },
  { value: "legislation", label: "Statute or legislation", fields: ["number", "authority", "url"] },
  { value: "dataset", label: "Dataset", fields: ["publisher", "url", "accessed"] },
  { value: "interview", label: "Interview", fields: ["interviewer", "date", "place"] },
  { value: "manuscript", label: "Unpublished manuscript or archive item", fields: ["archive", "archive_location", "genre"] },
] as const;

type TypeValue = (typeof MANUAL_TYPES)[number]["value"];
type Field = (typeof MANUAL_TYPES)[number]["fields"][number];
interface Person {
  family: string;
  given: string;
}

const FIELD_LABELS: Record<string, string> = {
  container_title: "Book / journal / website / newspaper title",
  publisher: "Publisher or institution",
  place: "Place of publication",
  edition: "Edition (e.g. 2)",
  isbn: "ISBN",
  volume: "Volume",
  issue: "Issue",
  pages: "Pages (e.g. 12–34)",
  url: "Link (https://…)",
  number: "Number (case, report or act number)",
  authority: "Court or issuing body",
  genre: "Kind (e.g. PhD thesis, policy brief)",
  accessed: "Date accessed",
  archive: "Archive or collection",
  archive_location: "Location in the archive",
};

/** Add (or correct) a source that has no DOI. It stays private to you and is labelled as user-supplied. */
export function ManualSourceForm({ onSaved }: { onSaved: (paper: Paper) => void }) {
  const [type, setType] = useState<TypeValue>("book");
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState<Person[]>([{ family: "", given: "" }]);
  const [editors, setEditors] = useState<Person[]>([]);
  const [interviewer, setInterviewer] = useState<Person[]>([]);
  const [year, setYear] = useState("");
  const [date, setDate] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [isbnNote, setIsbnNote] = useState<string | null>(null);
  const fields = MANUAL_TYPES.find((t) => t.value === type)?.fields ?? [];
  const has = (field: Field | "date" | "editors" | "interviewer") => (fields as readonly string[]).includes(field);
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const lookup = useMutation({
    mutationFn: () => api.get<{ title: string; authors: { family?: string; given?: string; literal?: string }[]; year: number | null; publisher?: string; place?: string; isbn: string }>(`/papers/lookup/isbn/${encodeURIComponent(values.isbn ?? "")}`),
    onSuccess: (found) => {
      setTitle(found.title);
      setAuthors(found.authors.length ? found.authors.map((a) => ({ family: a.family ?? a.literal ?? "", given: a.given ?? "" })) : [{ family: "", given: "" }]);
      if (found.year) setYear(String(found.year));
      setValues((current) => ({ ...current, publisher: found.publisher ?? current.publisher ?? "", place: found.place ?? current.place ?? "", isbn: found.isbn }));
      setIsbnNote("Filled in from Open Library. Please check every field before saving.");
    },
  });

  const people = (list: Person[]) =>
    list.filter((p) => p.family.trim() || p.given.trim()).map((p) => (p.given.trim() ? { family: p.family.trim(), given: p.given.trim() } : { literal: p.family.trim() }));
  const save = useMutation({
    mutationFn: () => {
      const [y, m, d] = (date || "").split("-").map((n) => Number(n));
      const body: Record<string, unknown> = {
        type,
        title: title.trim(),
        authors: people(authors),
        editors: has("editors") ? people(editors) : [],
        interviewer: has("interviewer") ? people(interviewer) : [],
        year: has("date") && y ? y : year ? Number(year) : null,
        month: has("date") && m ? m : null,
        day: has("date") && d ? d : null,
      };
      for (const field of fields) {
        if (field === "editors" || field === "interviewer" || field === "date") continue;
        const value = (values[field] ?? "").trim();
        if (value) body[field] = value;
      }
      return api.post<Paper>("/papers/manual", body);
    },
    onSuccess: onSaved,
  });

  const peopleEditor = (label: string, list: Person[], update: (next: Person[]) => void) => (
    <div>
      <Label>{label}</Label>
      <div className="space-y-2">
        {list.map((person, index) => (
          <div key={index} className="flex gap-2">
            <Input aria-label={`${label} ${index + 1} family name or organisation`} placeholder="Family name or organisation" value={person.family} onChange={(e) => update(list.map((p, i) => (i === index ? { ...p, family: e.target.value } : p)))} />
            <Input aria-label={`${label} ${index + 1} given names`} placeholder="Given names" value={person.given} onChange={(e) => update(list.map((p, i) => (i === index ? { ...p, given: e.target.value } : p)))} />
            <button type="button" className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600" aria-label="Remove" onClick={() => update(list.filter((_, i) => i !== index))}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={() => update([...list, { family: "", given: "" }])}>
          <Plus className="h-4 w-4" /> Add {label.toLowerCase().replace(/s$/, "")}
        </Button>
      </div>
    </div>
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) save.mutate();
      }}
    >
      <p className="text-sm text-slate-600">For sources without a DOI. The details you type are kept private and marked “user-supplied”, separate from registry-verified records.</p>
      <div>
        <Label htmlFor="manual-type">Type of source</Label>
        <Select id="manual-type" value={type} onChange={(e) => setType(e.target.value as TypeValue)}>
          {MANUAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
      </div>
      {has("isbn") && (
        <div>
          <Label htmlFor="manual-isbn">ISBN (optional; fills in the rest)</Label>
          <div className="flex gap-2">
            <Input id="manual-isbn" value={values.isbn ?? ""} onChange={(e) => set("isbn", e.target.value)} placeholder="978…" />
            <Button type="button" variant="secondary" loading={lookup.isPending} disabled={!(values.isbn ?? "").trim()} onClick={() => lookup.mutate()}>
              <Search className="h-4 w-4" /> Look up
            </Button>
          </div>
          {isbnNote && <p className="mt-1 text-xs text-amber-700">{isbnNote}</p>}
          {lookup.error && <p className="mt-1 text-xs text-red-700">{errorMessage(lookup.error)}</p>}
        </div>
      )}
      <div>
        <Label htmlFor="manual-title">Title</Label>
        <Input id="manual-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={1000} />
      </div>
      {peopleEditor(type === "legal_case" || type === "legislation" ? "Parties or authors (optional)" : "Authors", authors, setAuthors)}
      {has("editors") && peopleEditor("Editors", editors, setEditors)}
      {has("interviewer") && peopleEditor("Interviewers", interviewer, setInterviewer)}
      {has("date") ? (
        <div>
          <Label htmlFor="manual-date">Date</Label>
          <Input id="manual-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      ) : (
        <div>
          <Label htmlFor="manual-year">Year</Label>
          <Input id="manual-year" type="number" min={1000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields
          .filter((f) => !["isbn", "editors", "interviewer", "date"].includes(f))
          .map((field) => (
            <div key={field} className={field === "container_title" || field === "url" ? "sm:col-span-2" : ""}>
              <Label htmlFor={`manual-${field}`}>{FIELD_LABELS[field] ?? field}</Label>
              <Input id={`manual-${field}`} type={field === "accessed" ? "date" : "text"} value={values[field] ?? ""} onChange={(e) => set(field, e.target.value)} />
            </div>
          ))}
      </div>
      {save.error && <Alert kind="error">{errorMessage(save.error)}</Alert>}
      <Button type="submit" loading={save.isPending} disabled={!title.trim()}>Add to my library</Button>
    </form>
  );
}
