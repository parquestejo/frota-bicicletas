import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readTree(url: URL) {
  const root = fileURLToPath(url);
  const files: string[] = [];
  const visit = (path: string) => {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(`${path}/${name}`);
    } else if (/\.(ts|tsx)$/.test(path)) files.push(readFileSync(path, "utf8"));
  };
  visit(root);
  return files.join("\n");
}

export const apiSource = readTree(new URL("../functions/api", import.meta.url));
export const pageSource = readTree(new URL("../src/pages", import.meta.url));
