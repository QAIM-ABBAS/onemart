/**
 * Shared page probe used by the layout audit scripts (practices 1 & 2: read the
 * page as parent/child boxes).
 *
 * Runs inside the browser. Reports horizontal overflow (excluding boxes that
 * live inside a scroll/clip ancestor, e.g. a carousel track), the layout mode
 * of every container that arranges other boxes, and the measured column count
 * of each card grid.
 */
export const probe = () => {
  const sel = (el) =>
    el.tagName.toLowerCase() +
    (typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).slice(0, 5).join(".")
      : "");

  const clipped = (el) => {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") return true;
      n = n.parentElement;
    }
    return false;
  };

  const describe = (el) => {
    const cs = getComputedStyle(el);
    const out = [];
    if (cs.display.includes("flex")) {
      out.push(`flex:${cs.flexDirection}${cs.flexWrap === "wrap" ? ":wrap" : ""}`);
      out.push(`justify=${cs.justifyContent}`);
      if (cs.gap !== "normal") out.push(`gap=${cs.gap}`);
    } else if (cs.display.includes("grid")) {
      out.push("grid");
      out.push(`cols=${cs.gridTemplateColumns}`);
      if (cs.gap !== "normal") out.push(`gap=${cs.gap}`);
    } else {
      out.push(cs.display);
    }
    return out.join(" ");
  };

  const docW = document.documentElement.clientWidth;
  const overflows = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if ((r.right > docW + 1 || r.left < -1) && !clipped(el)) {
      overflows.push({ sel: sel(el), left: Math.round(r.left), right: Math.round(r.right) });
    }
  }

  const depthOf = (el) => {
    let d = 0;
    let n = el;
    while (n && n !== document.body) {
      d++;
      n = n.parentElement;
    }
    return d;
  };

  const containers = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (!(cs.display.includes("flex") || cs.display.includes("grid"))) continue;
    if (el.children.length === 0) continue;
    const d = depthOf(el);
    if (d > 9) continue;
    containers.push({ sel: sel(el), depth: d, layout: describe(el), kids: el.children.length });
  }

  // Card grids: how many columns do the repeating card rows actually get?
  const grids = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (!cs.display.includes("grid")) continue;
    const first = el.firstElementChild;
    if (!first) continue;
    const fr = first.getBoundingClientRect();
    if (fr.height < 60 || fr.width < 60) continue;
    const rects = [...el.children].map((c) => c.getBoundingClientRect());
    const rows = new Set(rects.map((r) => Math.round(r.top)));
    grids.push({
      sel: sel(el),
      cols: cs.gridTemplateColumns.split(" ").length,
      rows: rows.size,
      itemW: Math.round(fr.width),
      itemH: Math.round(fr.height),
      items: el.children.length,
    });
  }

  return {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: docW,
    overflows: overflows.slice(0, 15),
    overflowCount: overflows.length,
    containers,
    grids,
  };
};

/** Print one probe result in the shared report format. */
export function report(path, width, res) {
  const horizontal = res.scrollWidth > res.clientWidth + 1;
  console.log(
    `\n=== ${path} @ ${width}px ${horizontal ? "  X HORIZONTAL OVERFLOW" : "  ok"}` +
      ` (scrollW=${res.scrollWidth}, clientW=${res.clientWidth}, offscreen=${res.overflowCount})`,
  );
  if (res.overflows.length) {
    for (const o of res.overflows) console.log(`    !! ${o.sel}  [${o.left}..${o.right}]`);
  }
  if (res.grids.length) {
    console.log("  card grids:");
    for (const g of res.grids)
      console.log(
        `    ${g.sel.slice(0, 70)}  cols=${g.cols} rows=${g.rows} item=${g.itemW}x${g.itemH} n=${g.items}`,
      );
  }
  console.log("  containers:");
  for (const c of res.containers)
    console.log(`    ${"  ".repeat(Math.max(0, c.depth - 1))}${c.sel.slice(0, 74)}  ->  ${c.layout}`);
}
