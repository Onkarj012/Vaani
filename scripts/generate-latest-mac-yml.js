const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");

const projectRoot = join(__dirname, "..");
const makeDir = join(projectRoot, "out", "make");
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));

function walk(dir) {
  let entries = [];
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      entries = entries.concat(walk(fullPath));
    } else {
      entries.push(fullPath);
    }
  }
  return entries;
}

const zip = walk(makeDir)
  .filter((file) => file.endsWith(".zip") && !file.endsWith(".blockmap"))
  .sort((left, right) => statSync(right).size - statSync(left).size)[0];

if (!zip) {
  throw new Error(`No macOS zip artifact found under ${makeDir}`);
}

const data = readFileSync(zip);
const sha512 = createHash("sha512").update(data).digest("base64");
const size = statSync(zip).size;
const fileName = basename(zip);
const yml = [
  `version: ${packageJson.version}`,
  "files:",
  `  - url: ${fileName}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${fileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  ""
].join("\n");

const outputPath = join(dirname(zip), "latest-mac.yml");
writeFileSync(outputPath, yml, "utf8");
console.log(`Wrote ${outputPath}`);
