const fs = require("node:fs");
const sharp = require("sharp");

async function main() {
  const source = fs.readFileSync("public/poster.html", "utf8");
  const results = [];
  for (const name of ["LOGO_DATA_URL", "FOOTER_DATA_URL"]) {
    const match = source.match(new RegExp(`const ${name} = 'data:image/png;base64,([^']+)'`));
    if (!match) throw new Error(`${name} is missing`);
    const buffer = Buffer.from(match[1], "base64");
    if (process.argv.includes("--extract")) {
      fs.mkdirSync("assets/poster", { recursive: true });
      const filename = name === "LOGO_DATA_URL" ? "logo.png" : "footer.png";
      fs.writeFileSync(`assets/poster/${filename}`, buffer);
    }
    results.push({ name, bytes: buffer.length, metadata: await sharp(buffer).metadata() });
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
