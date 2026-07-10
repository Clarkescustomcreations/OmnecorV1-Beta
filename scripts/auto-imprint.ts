import fs from "fs/promises";
import path from "path";

/**
 * Pull the consistency-relevant Tailwind classes out of a component's className
 * attributes and render a registry entry. Deterministic — no model call needed.
 */
function buildImprintEntry(fileName: string, source: string): string {
  const classes = new Set<string>();
  const classRe = /className\s*=\s*["'`]([^"'`]+)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(source)) !== null) {
    for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  }

  const pick = (re: RegExp): string => {
    const hits = [...classes].filter((c) => re.test(c));
    return hits.length ? hits.join(" ") : "—";
  };

  const rows: [string, string][] = [
    ["Background", pick(/^(bg-|dark:bg-)/)],
    ["Border", pick(/^(border($|-)|dark:border-)/)],
    ["Border radius", pick(/^rounded(-|$)/)],
    ["Text", pick(/^(text-|font-)/)],
    ["Spacing", pick(/^(p-|px-|py-|pt-|pb-|pl-|pr-|gap-|space-)/)],
    ["Hover", pick(/^hover:/)],
    ["Shadow", pick(/^shadow(-|$)/)],
  ];

  const date = new Date().toISOString().slice(0, 10);
  const table = rows
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join("\n");

  return [
    `### ${fileName}`,
    ``,
    `Captured: ${date}`,
    ``,
    `| Property | Class |`,
    `| --- | --- |`,
    table,
  ].join("\n");
}

async function run() {
  const cwd = process.cwd();
  
  // Since we are running on changed files typically, but for simplicity here we scan the whole components directory
  // In a real workflow you might pass file paths as args
  const componentsDir = path.join(cwd, "client/src/components");
  const registryPath = path.join(cwd, "Context/UI-Registry.md");

  async function walk(dir: string, fileList: string[] = []) {
    const files = await fs.readdir(dir);
    for (const file of files) {
      const stat = await fs.stat(path.join(dir, file));
      if (stat.isDirectory()) {
        fileList = await walk(path.join(dir, file), fileList);
      } else if (file.endsWith(".tsx")) {
        fileList.push(path.join(dir, file));
      }
    }
    return fileList;
  }

  const files = await walk(componentsDir);
  
  let existing = "";
  try {
    existing = await fs.readFile(registryPath, "utf8");
  } catch {
    existing = "# UI Registry\n\nVisual patterns captured via /imprint.\n";
  }

  // Parse existing entries to see what we've already done? 
  // For simplicity, we just append new files that aren't mentioned, or we just rely on manual /imprint.
  // We'll append everything that isn't already present.
  let addedCount = 0;
  let newContent = existing.trimEnd();

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    if (!existing.includes(`### ${fileName}`)) {
      const source = await fs.readFile(filePath, "utf8");
      const entry = buildImprintEntry(fileName, source);
      newContent += `\n\n${entry}`;
      addedCount++;
    }
  }

  if (addedCount > 0) {
    await fs.writeFile(registryPath, newContent + "\n", "utf8");
    console.log(`Auto-imprinted ${addedCount} new components into UI-Registry.md`);
  } else {
    console.log("No new components to imprint.");
  }
}

run().catch(err => {
  console.error("Auto-imprint failed:", err);
  process.exit(1);
});
