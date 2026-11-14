// citeproc-js runner. Reads one JSON request on stdin, writes one JSON response on stdout.
// Request: {style: string(xml), locale: string(xml), items: CSL-JSON[], clusters: [{items:[{id,locator,label,prefix,suffix}]}],
//           bibliography: bool, format: "html"|"text"}
"use strict";
const CSL = require("citeproc");
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const req = JSON.parse(raw);
    const items = new Map(req.items.map((it) => [String(it.id), it]));
    const sys = {
      retrieveLocale: () => req.locale,
      retrieveItem: (id) => items.get(String(id)),
    };
    const engine = new CSL.Engine(sys, req.style, "en-US", true);
    engine.setOutputFormat(req.format === "text" ? "text" : "html");
    const clusters = (req.clusters || []).map((cl, i) => ({
      citationID: "c" + i,
      citationItems: cl.items.map((it) => {
        const out = { id: String(it.id) };
        for (const k of ["locator", "label", "prefix", "suffix"]) if (it[k]) out[k] = it[k];
        return out;
      }),
      properties: { noteIndex: req.note ? i + 1 : 0 },
    }));
    const ids = req.items.map((it) => String(it.id));
    engine.updateItems(ids);
    let citations = [];
    if (clusters.length) {
      const rebuilt = engine.rebuildProcessorState(clusters, req.format === "text" ? "text" : "html");
      citations = rebuilt.map((r) => r[2]);
    }
    let bibliography = [];
    let bibliographyIds = [];
    if (req.bibliography) {
      const bib = engine.makeBibliography();
      if (bib) {
        bibliography = bib[1].map((s) => s.trim());
        bibliographyIds = (bib[0].entry_ids || []).map((ids) => String(ids[0]));
      }
    }
    process.stdout.write(JSON.stringify({ citations, bibliography, bibliography_ids: bibliographyIds }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
    process.exitCode = 1;
  }
});
