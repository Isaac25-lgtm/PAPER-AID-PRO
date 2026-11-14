import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, FolderPlus, LibraryBig, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { SectionGuide } from "@/components/Guidance";
import { Container } from "@/components/Layout";
import { PaperCard } from "@/components/papers";
import { Alert, Button, EmptyState, Input, Label, Modal, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { api, downloadFile, errorMessage } from "@/lib/api";
import type { Collection, ImportResult, LibraryItem, Paper } from "@/lib/types";

function NotesModal({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(item.notes ?? "");
  const [tags, setTags] = useState(item.tags.join(", "));
  const save = useMutation({
    mutationFn: () => api.patch(`/library/${item.paper.id}`, { notes, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title="Notes & tags">
      <p className="mb-3 font-serif text-sm font-semibold">{item.paper.title}</p>
      <Label htmlFor="notes">Notes</Label>
      <Textarea id="notes" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={20000} />
      <div className="mt-3">
        <Label htmlFor="tags">Tags (comma-separated)</Label>
        <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="rct, chapter-2" />
      </div>
      {save.error && <div className="mt-3"><Alert kind="error">{errorMessage(save.error)}</Alert></div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Modal>
  );
}

function AddPaperModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState("");
  const [fullText, setFullText] = useState(true);
  const importPaper = useMutation({
    mutationFn: () => api.post<Paper>("/papers/import", { identifier, add_to_library: true, fetch_full_text: fullText }),
    onSuccess: (paper) => {
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      navigate(`/papers/${paper.id}`);
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      if (identifier.trim()) form.append("identifier", identifier.trim());
      return api.upload<Paper>("/papers/upload", form);
    },
    onSuccess: (paper) => {
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      navigate(`/papers/${paper.id}`);
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="Add a paper">
      <form onSubmit={(e) => { e.preventDefault(); importPaper.mutate(); }} className="space-y-3">
        <div>
          <Label htmlFor="identifier">DOI, PubMed ID, PMC ID or arXiv ID</Label>
          <Input id="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="10.1038/nature14539 · PMID:31978945 · arXiv:1706.03762" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={fullText} onChange={(e) => setFullText(e.target.checked)} /> Also retrieve the open-access full text if available
        </label>
        <Button type="submit" loading={importPaper.isPending} disabled={!identifier.trim()}>Import from registry</Button>
      </form>
      <div className="my-4 border-t border-slate-200" />
      <p className="text-sm text-slate-700">Or upload a PDF. It stays private to you. If you enter an identifier above, its registry metadata is used for citations.</p>
      <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
        <FileUp className="h-4 w-4" /> {upload.isPending ? "Uploading and extracting text…" : "Choose PDF"}
        <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
      </label>
      {(importPaper.error || upload.error) && <div className="mt-3"><Alert kind="error">{errorMessage(importPaper.error ?? upload.error)}</Alert></div>}
    </Modal>
  );
}

function ImportFileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const run = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<ImportResult>("/library/import", form);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["library"] }),
  });
  return (
    <Modal open={open} onClose={onClose} title="Import references">
      <p className="text-sm text-slate-700">Upload a BibTeX (.bib) or RIS (.ris) file exported from Zotero, Mendeley, EndNote or similar. Entries with a DOI are matched to registry records.</p>
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
        <Upload className="h-4 w-4" /> {run.isPending ? "Importing…" : "Choose file"}
        <input type="file" accept=".bib,.ris,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && run.mutate(e.target.files[0])} />
      </label>
      {run.error && <div className="mt-3"><Alert kind="error">{errorMessage(run.error)}</Alert></div>}
      {run.data && (
        <div className="mt-3">
          <Alert kind={run.data.errors.length ? "warning" : "success"} title={`Imported ${run.data.imported}, skipped ${run.data.skipped} already in your library`}>
            {run.data.errors.length > 0 && <ul className="list-disc pl-4">{run.data.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          </Alert>
        </div>
      )}
    </Modal>
  );
}

function CollectionModal({ collection, onClose }: { collection: Collection | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(collection?.name ?? "");
  const save = useMutation({
    mutationFn: () => (collection ? api.patch(`/collections/${collection.id}`, { name }) : api.post("/collections", { name })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={collection ? "Rename collection" : "New collection"}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="e.g. Thesis chapter 2" aria-label="Collection name" />
        {save.error && <Alert kind="error">{errorMessage(save.error)}</Alert>}
        <Button type="submit" loading={save.isPending}>Save</Button>
      </form>
    </Modal>
  );
}

export default function LibraryPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const collectionId = params.get("collection");
  const tag = params.get("tag");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [collectionModal, setCollectionModal] = useState<Collection | null | "new">(null);

  const collections = useQuery({ queryKey: ["collections"], queryFn: () => api.get<Collection[]>("/collections") });
  const items = useQuery({
    queryKey: ["library", collectionId, tag],
    queryFn: () => api.get<LibraryItem[]>("/library", { collection_id: collectionId ?? undefined, tag: tag ?? undefined }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["library"] });
    void queryClient.invalidateQueries({ queryKey: ["collections"] });
  };
  const remove = useMutation({ mutationFn: (paperId: string) => api.delete(`/library/${paperId}`), onSuccess: refresh });
  const move = useMutation({
    mutationFn: ({ paperId, collection, add }: { paperId: string; collection: string; add: boolean }) =>
      add ? api.put(`/collections/${collection}/papers/${paperId}`) : api.delete(`/collections/${collection}/papers/${paperId}`),
    onSuccess: refresh,
  });
  const deleteCollection = useMutation({
    mutationFn: (id: string) => api.delete(`/collections/${id}`),
    onSuccess: () => {
      setParams({});
      refresh();
    },
  });
  const allTags = Array.from(new Set((items.data ?? []).flatMap((i) => i.tags))).sort();
  const current = collections.data?.find((c) => c.id === collectionId);

  return (
    <Container>
      <PageHeader
        title={current ? current.name : "My library"}
        subtitle={tag ? `Tagged “${tag}”` : "Papers you’ve saved, uploaded or imported."}
        actions={
          <>
            <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add paper</Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import .bib/.ris</Button>
            <Select
              className="w-40"
              value=""
              aria-label="Export"
              onChange={(e) => {
                const format = e.target.value;
                if (!format) return;
                const ext = format === "bibtex" ? "bib" : format === "ris" ? "ris" : "json";
                void downloadFile("/library/export", `paperaid-library.${ext}`, { format, collection_id: collectionId ?? undefined });
              }}
            >
              <option value="">Export…</option>
              <option value="bibtex">BibTeX</option>
              <option value="ris">RIS</option>
              <option value="csl-json">CSL-JSON</option>
            </Select>
          </>
        }
      />
      <SectionGuide section="library" />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-4">
          <nav aria-label="Collections" className="space-y-1">
            <button onClick={() => setParams({})} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${!collectionId && !tag ? "bg-brand-50 font-medium text-brand-800" : "text-slate-700 hover:bg-slate-100"}`}>
              <LibraryBig className="h-4 w-4" /> All papers
            </button>
            {collections.data?.map((c) => (
              <div key={c.id} className="group flex items-center">
                <button onClick={() => setParams({ collection: c.id })} className={`flex-1 truncate rounded-lg px-3 py-2 text-left text-sm ${collectionId === c.id ? "bg-brand-50 font-medium text-brand-800" : "text-slate-700 hover:bg-slate-100"}`}>
                  {c.name} <span className="text-slate-400">({c.paper_count})</span>
                </button>
                <button className="p-1 text-slate-400 opacity-100 hover:text-slate-700 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label={`Rename ${c.name}`} onClick={() => setCollectionModal(c)}><Pencil className="h-3.5 w-3.5" /></button>
                <button className="p-1 text-slate-400 opacity-100 hover:text-red-600 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label={`Delete ${c.name}`} onClick={() => window.confirm(`Delete collection “${c.name}”? Papers stay in your library.`) && deleteCollection.mutate(c.id)}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <button onClick={() => setCollectionModal("new")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-brand-700 hover:bg-brand-50">
              <FolderPlus className="h-4 w-4" /> New collection
            </button>
          </nav>
          {allTags.length > 0 && (
            <div>
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Tags</p>
              <div className="flex flex-wrap gap-1 px-3">
                {allTags.map((t) => (
                  <button key={t} onClick={() => setParams(tag === t ? {} : { tag: t })} className={`rounded-full px-2 py-0.5 text-xs ${tag === t ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700"}`}>{t}</button>
                ))}
              </div>
            </div>
          )}
        </aside>
        <section>
          {items.isLoading && <Spinner />}
          {items.error && <Alert kind="error">{errorMessage(items.error)}</Alert>}
          {items.data?.length === 0 && (
            <EmptyState icon={<LibraryBig className="h-8 w-8" />} title={collectionId || tag ? "Nothing here yet" : "Your library is empty"} action={<Link to="/discover" className="font-medium text-brand-700">Discover papers →</Link>}>
              Save papers from Discover, add one by DOI, upload a PDF, or import a reference file.
            </EmptyState>
          )}
          <div className="space-y-4">
            {items.data?.map((item) => (
              <div key={item.paper.id}>
                <PaperCard
                  paper={item.paper}
                  actions={
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(item)}><Pencil className="h-3.5 w-3.5" /> Notes{item.tags.length ? ` · ${item.tags.join(", ")}` : ""}</Button>
                      {collections.data && collections.data.length > 0 && (
                        <Select
                          className="w-48 py-1.5"
                          aria-label="Add to collection"
                          value=""
                          onChange={(e) => {
                            const value = e.target.value;
                            if (!value) return;
                            const add = !item.collection_ids.includes(value);
                            move.mutate({ paperId: item.paper.id, collection: value, add });
                          }}
                        >
                          <option value="">Collections…</option>
                          {collections.data.map((c) => (
                            <option key={c.id} value={c.id}>{item.collection_ids.includes(c.id) ? "✓ " : ""}{c.name}</option>
                          ))}
                        </Select>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(item.paper.id)} aria-label="Remove from library"><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
                      {item.paper.has_pdf && (
                        <Button size="sm" variant="ghost" onClick={() => void downloadFile(`/papers/${item.paper.id}/pdf`, `${item.paper.title.slice(0, 60)}.pdf`)}><Download className="h-3.5 w-3.5" /> PDF</Button>
                      )}
                    </>
                  }
                />
                {item.notes && <p className="mx-4 -mt-1 rounded-b-lg border border-t-0 border-slate-200 bg-amber-50 px-3 py-2 text-sm text-slate-700">{item.notes}</p>}
              </div>
            ))}
          </div>
        </section>
      </div>
      <AddPaperModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ImportFileModal open={importOpen} onClose={() => setImportOpen(false)} />
      {editing && <NotesModal item={editing} onClose={() => setEditing(null)} />}
      {collectionModal && <CollectionModal collection={collectionModal === "new" ? null : collectionModal} onClose={() => setCollectionModal(null)} />}
    </Container>
  );
}
