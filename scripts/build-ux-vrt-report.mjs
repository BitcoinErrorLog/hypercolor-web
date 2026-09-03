import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const out = join(repo, "ux-vrt-report");
const assets = join(out, "assets");
const projects = ["chromium-mobile-pixel", "chromium-desktop-pixel"];
const scenesSource = readText(join(repo, "src/components/ux-catalog/scenes.ts"));
const UX_CATALOG_SCENES = [...scenesSource.matchAll(/\{\s*id: "([^"]+)", journey: "([^"]+)", surface: "([^"]+)", state: "([^"]+)"\s*\}/g)]
  .map((match) => ({ id: match[1], journey: match[2], surface: match[3], state: match[4] }));

function readText(path) {
  return existsSync(path) ? String(Buffer.from(readFileSync(path))) : "";
}

function gitSha(ref) {
  try {
    return execFileSync("git", ["rev-parse", "--short", ref], { cwd: repo, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function snapshotPath(project, sceneId) {
  return join(repo, "e2e/vrt-baselines", project, "ux-catalog.spec.ts", `${sceneId}.png`);
}

function esc(value) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

const rows = [];
for (const project of projects) {
  const dir = join(repo, "e2e/vrt-baselines", project, "ux-catalog.spec.ts");
  const present = existsSync(dir) ? new Set(readdirSync(dir)) : new Set();
  for (const scene of UX_CATALOG_SCENES) {
    const name = `${scene.id}.png`;
    const source = snapshotPath(project, scene.id);
    const asset = `${project}-${name}`;
    if (present.has(name)) copyFileSync(source, join(assets, asset));
    rows.push({ ...scene, project, asset, present: present.has(name) });
  }
}

const grouped = new Map();
for (const row of rows) {
  grouped.set(row.journey, [...(grouped.get(row.journey) ?? []), row]);
}
const body = [...grouped.entries()]
  .map(([journey, items]) => `
    <section>
      <h2>${esc(journey)}</h2>
      <div class="grid">
        ${items.map((row) => `
          <article>
            <h3>${esc(row.surface)} · ${esc(row.state)}</h3>
            <p>${esc(row.project)} · ${esc(row.id)}</p>
            ${row.present ? `<img src="assets/${esc(row.asset)}" alt="${esc(row.id)} baseline">` : "<strong>Missing baseline</strong>"}
          </article>
        `).join("")}
      </div>
    </section>
  `)
  .join("");

writeFileSync(join(out, "index.html"), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hypercolor Web UX VRT Report</title>
  <style>
    body { margin: 0; background: #0a0a0a; color: #f9fafb; font: 16px/1.5 system-ui, sans-serif; }
    main { max-width: 1200px; margin: 0 auto; padding: 32px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    article { border: 1px solid #1a1a1a; border-radius: 12px; background: #111111; padding: 12px; }
    img { display: block; width: 100%; height: auto; border-radius: 8px; border: 1px solid #1a1a1a; }
    p { color: #808692; }
  </style>
</head>
<body>
  <main>
    <h1>Hypercolor Web UX VRT Report</h1>
    <p>Baseline ${esc(gitSha("2a49455"))}; generated from the committed Wave 4b catalog baselines. ${rows.filter((row) => row.present).length} of ${rows.length} project-scene PNGs present.</p>
    ${body}
  </main>
</body>
</html>`);

console.log(`Wrote ${relative(repo, join(out, "index.html"))}`);
