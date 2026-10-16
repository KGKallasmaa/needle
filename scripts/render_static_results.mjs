import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withDashboard } from "./dashboard_page.mjs";
import { resultsFiles } from "./results_page.mjs";

const root = resolve(process.argv[2]);
const indexPath = join(root, "index.html");
const resultsTemplate = new URL("../dashboard/results.html", import.meta.url);
const MARKDOWN_LINK =
  '<link rel="alternate" type="text/markdown" href="results.md" title="NEEDLE results as Markdown">';
const RESULTS_LINK = ' <a href="results/">Results table</a>.';

const warn = (message) =>
  console.log(`::warning title=Static results::${message.replace(/%/g, "%25")}`);

const fillEmptyElement = (doc, id, inner) => {
  let found = 0;
  const filled = doc.replace(new RegExp(`<(div|span)\\b[^>]*\\bid="${id}"[^>]*>(?=</\\1>)`, "g"),
    (open) => {
      found++;
      return open + inner;
    });
  if (found !== 1) throw new Error(`expected one empty #${id}, found ${found}`);
  return filled;
};

const readSnapshot = (page) => page.evaluate(() => {
  const tableRow = (cells, tag) => {
    const tr = el("tr");
    tr.append(...cells.map((c) => el(tag, {}, c)));
    return tr;
  };
  const tableHtml = ([head, ...body]) => {
    const table = el("table");
    table.createTHead().append(tableRow(head, "th"));
    table.createTBody().append(...body.map((r) => tableRow(r, "td")));
    return table.outerHTML;
  };

  const html = { updated: document.getElementById("updated").innerHTML };
  const missing = [];
  for (const holder of document.querySelectorAll("[data-static]")) {
    const card = holder.closest(".lb-panel, .card");
    const rows = cardRows(card);
    if (!rows) {
      missing.push(holder.id);
      continue;
    }
    html[holder.id] = tableHtml(rows);
    const sub = card.querySelector(".sub[id]");
    if (sub?.textContent.trim()) html[sub.id] = sub.innerHTML;
  }

  return {
    html,
    missing,
    verticals: Object.fromEntries(VERTICALS),
    markdown: buildMarkdown(),
    summary: document.getElementById("card-standings")._summaryData?.() ?? null,
    lastRun: new Date(history[history.length - 1].ts).toISOString(),
    pricesAsOf: PRICES_ASOF,
    base: document.querySelector('meta[property="og:url"]').content,
  };
});

async function renderPdf(page, html) {
  await page.emulateMedia({ media: "print", colorScheme: "light" });
  await page.setContent(html, { waitUntil: "load" });
  return page.pdf({ format: "A4", landscape: true, printBackground: true,
                    margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" } });
}

const withLead = (markdown, lead) => markdown.replace("\n\n## ", `\n\n${lead}\n\n## `);

try {
  await withDashboard(root, {}, async (page) => {
    await page.waitForFunction(
      () => document.getElementById("updated").textContent.trim(), null, { timeout: 60000 });
    const snapshot = await readSnapshot(page);
    const results = snapshot.summary && resultsFiles(await readFile(resultsTemplate, "utf8"), snapshot);
    const pdf = results && await renderPdf(page, results.page);

    let doc = await readFile(indexPath, "utf8");
    const resultsLink = results ? RESULTS_LINK : "";
    for (const [id, inner] of Object.entries({ ...snapshot.html, "results-link": resultsLink })) {
      doc = fillEmptyElement(doc, id, inner);
    }
    doc = doc.replace(/<span class="vert" data-vert="([a-z_]+)"><\/span>/g, (_, key) =>
      `<span class="vert" data-vert="${key}">${snapshot.verticals[key] ?? key}</span>`);
    doc = doc.replace("</head>", `${MARKDOWN_LINK}\n</head>`);

    if (results) {
      await mkdir(join(root, "results"), { recursive: true });
      await writeFile(join(root, "results", "index.html"), results.page);
      await writeFile(join(root, "results.csv"), results.csv);
      await writeFile(join(root, "results.json"), results.json);
      await writeFile(join(root, "results.pdf"), pdf);
    }
    await writeFile(join(root, "results.md"),
      results ? withLead(snapshot.markdown, results.lead) : snapshot.markdown);
    await writeFile(indexPath, doc);
    for (const id of snapshot.missing) console.error(`no rows for #${id}, left empty`);
    if (!results) warn("no standings in the last 7 days, results/ not written");
    console.log(`filled ${Object.keys(snapshot.html).length} elements; wrote `
      + (results ? `results/ (${snapshot.summary.engines.length} engines), csv, json, pdf`
                 : "no results/ (no standings)")
      + " and results.md");
  });
} catch (e) {
  warn(`static results failed, index.html left as is: ${e.message.split("\n")[0]}`);
}
