const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Minimal, safe markdown (fenced code, inline code, bold, italics, lists, paragraphs): everything is escaped first. */
export function md(src: string): string {
  const parts = String(src).split(/```[a-zA-Z]*\n?([\s\S]*?)```/g);
  return parts.map((p, i) => {
    if (i % 2 === 1) return `<pre><code>${esc(p.replace(/\n$/, ""))}</code></pre>`;
    let t = esc(p);
    t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,]|$)/g, "$1<i>$2</i>");
    let html = "", inList = false;
    let para: string[] = [];
    const flush = () => { if (para.length) { html += `<p>${para.join("<br>")}</p>`; para = []; } };
    for (const line of t.split("\n")) {
      const li = /^\s*[-•*]\s+(.*)$/.exec(line);
      if (li) { flush(); if (!inList) { html += "<ul>"; inList = true; } html += `<li>${li[1]}</li>`; continue; }
      if (inList) { html += "</ul>"; inList = false; }
      if (!line.trim()) flush(); else para.push(line);
    }
    flush();
    if (inList) html += "</ul>";
    return html;
  }).join("");
}
