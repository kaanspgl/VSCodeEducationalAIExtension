const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Minimal, safe markdown (fenced code, inline code, bold, italics, headings, bulleted and numbered lists, paragraphs): everything is escaped first. */
export function md(src: string): string {
  const parts = String(src).split(/```[a-zA-Z]*\n?([\s\S]*?)```/g);
  return parts.map((p, i) => {
    if (i % 2 === 1) return `<pre><code>${esc(p.replace(/\n$/, ""))}</code></pre>`;
    let t = esc(p);
    t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,]|$)/g, "$1<i>$2</i>");
    let html = "", list = "";
    let para: string[] = [];
    const flush = () => { if (para.length) { html += `<p>${para.join("<br>")}</p>`; para = []; } };
    const endList = () => { if (list) { html += `</${list}>`; list = ""; } };
    for (const line of t.split("\n")) {
      const ul = /^\s*[-•*]\s+(.*)$/.exec(line);
      const ol = ul ? null : /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        flush();
        const tag = ul ? "ul" : "ol";
        if (list !== tag) { endList(); html += ol ? `<ol start="${Number(ol[1])}">` : "<ul>"; list = tag; }
        html += `<li>${ul ? ul[1] : ol![2]}</li>`;
        continue;
      }
      endList();
      const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
      if (h) { flush(); html += `<p class="mdh">${h[1]}</p>`; continue; }
      if (!line.trim()) flush(); else para.push(line);
    }
    flush();
    endList();
    return html;
  }).join("");
}
