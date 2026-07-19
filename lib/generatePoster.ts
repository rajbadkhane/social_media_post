import { readFile } from "node:fs/promises";
import path from "node:path";
import { create, type Font, type FontCollection } from "fontkit";
import sharp from "sharp";
import { downloadImageAsBase64 } from "./article/extractImage";

export interface PosterInput {
  headline: string;
  summary: string;
  imageUrl: string;
  category: string;
  seoHashtags: string[];
  smoHashtags: string[];
  captions: {
    facebook: string;
    instagram: string;
    linkedin: string;
    twitter: string;
  };
  language: string;
}

interface ColoredWord {
  word: string;
  color: string;
}

interface PosterResources {
  latinFont: Font;
  devanagariFont: Font;
  logo: Buffer;
  footer: Buffer;
}

const WIDTH = 2048;
const HEIGHT = 1365;
const MAX_HEADLINE_WIDTH = 1940;
const MAX_HEADLINE_LINES = 3;
const STARTING_FONT_SIZE = 86;
const MINIMUM_FONT_SIZE = 48;
const LAST_BASELINE = 1190;
const ASSET_DIRECTORY = path.join(process.cwd(), "assets", "poster");
const LATIN_FONT_PATH = path.join(
  process.cwd(),
  "node_modules",
  "@fontsource",
  "noto-sans",
  "files",
  "noto-sans-latin-900-normal.woff2",
);
const DEVANAGARI_FONT_PATH = path.join(
  process.cwd(),
  "node_modules",
  "@fontsource",
  "noto-sans-devanagari",
  "files",
  "noto-sans-devanagari-devanagari-900-normal.woff2",
);
let resourcesPromise: Promise<PosterResources> | undefined;

function asFont(value: Font | FontCollection, source: string): Font {
  if ("layout" in value) return value;
  throw new Error(`Poster font file is a collection and cannot be used directly: ${source}`);
}

async function removeCornerBackground(source: Buffer, tolerance = 40): Promise<Buffer> {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const background = [data[0], data[1], data[2]];
  if (background.some((channel) => channel < 180)) return source;

  const visited = new Uint8Array(width * height);
  const stack: number[] = [];

  const tryAdd = (x: number, y: number): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) return;
    visited[pixelIndex] = 1;

    const offset = pixelIndex * channels;
    const isBackground = background.every(
      (channel, index) => Math.abs(data[offset + index] - channel) <= tolerance,
    );
    if (!isBackground) return;

    data[offset + 3] = 0;
    stack.push(x, y);
  };

  tryAdd(0, 0);
  tryAdd(width - 1, 0);
  tryAdd(0, height - 1);
  tryAdd(width - 1, height - 1);

  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    if (x === undefined || y === undefined) break;
    tryAdd(x + 1, y);
    tryAdd(x - 1, y);
    tryAdd(x, y + 1);
    tryAdd(x, y - 1);
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

async function loadResources(): Promise<PosterResources> {
  const [latinFontBuffer, devanagariFontBuffer, logoSource, footer] = await Promise.all([
    readFile(LATIN_FONT_PATH),
    readFile(DEVANAGARI_FONT_PATH),
    readFile(path.join(ASSET_DIRECTORY, "logo.png")),
    readFile(path.join(ASSET_DIRECTORY, "footer.png")),
  ]);

  return {
    latinFont: asFont(create(latinFontBuffer), LATIN_FONT_PATH),
    devanagariFont: asFont(create(devanagariFontBuffer), DEVANAGARI_FONT_PATH),
    logo: await removeCornerBackground(logoSource),
    footer,
  };
}

function getResources(): Promise<PosterResources> {
  resourcesPromise ??= loadResources();
  return resourcesPromise;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const [, base64] = dataUrl.split(",", 2);
  if (!base64) throw new Error("Poster image data URL is malformed");
  return Buffer.from(base64, "base64");
}

function coloredWords(headline: string): ColoredWord[] {
  const words = headline.trim().split(/\s+/).filter(Boolean);
  const firstBreak = Math.max(1, Math.ceil(words.length * 0.28));
  const secondBreak = Math.max(firstBreak + 1, Math.ceil(words.length * 0.72));

  return words.map((word, index) => ({
    word,
    color: index < firstBreak ? "#ffd43b" : index < secondBreak ? "#ffffff" : "#35e7ff",
  }));
}

function usesDevanagari(value: string): boolean {
  return /[\u0900-\u097f]/u.test(value);
}

function fontSegments(value: string): Array<{ text: string; devanagari: boolean }> {
  const segments: Array<{ text: string; devanagari: boolean }> = [];
  for (const character of value) {
    const devanagari = usesDevanagari(character);
    const previous = segments.at(-1);
    if (previous?.devanagari === devanagari) previous.text += character;
    else segments.push({ text: character, devanagari });
  }
  return segments;
}

function measureToken(token: string, fontSize: number, resources: PosterResources): number {
  return fontSegments(token).reduce((width, segment) => {
    const font = segment.devanagari ? resources.devanagariFont : resources.latinFont;
    return width + (font.layout(segment.text).advanceWidth / font.unitsPerEm) * fontSize;
  }, 0);
}

function wrapWords(
  words: ColoredWord[],
  fontSize: number,
  resources: PosterResources,
): ColoredWord[][] {
  const lines: ColoredWord[][] = [];
  let currentLine: ColoredWord[] = [];
  let currentWidth = 0;

  for (const item of words) {
    const tokenWidth = measureToken(`${item.word} `, fontSize, resources);
    if (currentLine.length > 0 && currentWidth + tokenWidth > MAX_HEADLINE_WIDTH) {
      lines.push(currentLine);
      currentLine = [item];
      currentWidth = tokenWidth;
    } else {
      currentLine.push(item);
      currentWidth += tokenWidth;
    }
  }

  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
}

function fitHeadline(words: ColoredWord[], resources: PosterResources): {
  fontSize: number;
  lines: ColoredWord[][];
} {
  let fontSize = STARTING_FONT_SIZE;
  let lines = wrapWords(words, fontSize, resources);

  while (lines.length > MAX_HEADLINE_LINES && fontSize > MINIMUM_FONT_SIZE) {
    fontSize -= 2;
    lines = wrapWords(words, fontSize, resources);
  }

  return { fontSize, lines };
}

function wordPath(
  item: ColoredWord,
  x: number,
  baseline: number,
  fontSize: number,
  resources: PosterResources,
): string {
  let segmentX = x;
  return fontSegments(item.word)
    .map((segment) => {
      const font = segment.devanagari ? resources.devanagariFont : resources.latinFont;
      const run = font.layout(segment.text);
      const scale = fontSize / font.unitsPerEm;
      let penX = 0;
      let penY = 0;
      const paths = run.glyphs
        .map((glyph, index) => {
          const position = run.positions[index];
          const originX = segmentX + (penX + position.xOffset) * scale;
          const originY = baseline - (penY + position.yOffset) * scale;
          penX += position.xAdvance;
          penY += position.yAdvance;
          const pathData = glyph.path.toSVG();
          if (!pathData) return "";
          return `<path d="${pathData}" transform="translate(${originX.toFixed(3)} ${originY.toFixed(3)}) scale(${scale.toFixed(6)} ${(-scale).toFixed(6)})" fill="${item.color}" stroke="rgba(0,0,0,0.95)" stroke-width="8" stroke-linejoin="round" paint-order="stroke fill" vector-effect="non-scaling-stroke"/>`;
        })
        .join("");
      segmentX += (run.advanceWidth / font.unitsPerEm) * fontSize;
      return paths;
    })
    .join("");
}

function textOverlaySvg(input: PosterInput, resources: PosterResources): string {
  const words = coloredWords(input.headline);
  const { fontSize, lines } = fitHeadline(words, resources);
  const lineHeight = Math.round(fontSize * 1.3);
  const startY = LAST_BASELINE - (lines.length - 1) * lineHeight;

  const text = lines
    .map((line, row) => {
      let x = 52;
      return line
        .map((item) => {
          const element = wordPath(
            item,
            x,
            startY + row * lineHeight,
            fontSize,
            resources,
          );
          x += measureToken(`${item.word} `, fontSize, resources);
          return element;
        })
        .join("");
    })
    .join("");

  return `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="headline-shade" gradientUnits="userSpaceOnUse" x1="0" y1="940" x2="0" y2="1225">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.55" stop-color="#000000" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.62"/>
    </linearGradient>
  </defs>
  <rect x="0" y="910" width="${WIDTH}" height="315" fill="url(#headline-shade)"/>
  ${text}
</svg>`;
}

async function renderTextOverlay(input: PosterInput, resources: PosterResources): Promise<Buffer> {
  return sharp(Buffer.from(textOverlaySvg(input, resources), "utf8")).png().toBuffer();
}

export async function generatePoster(input: PosterInput): Promise<Buffer> {
  console.log("[Poster] Starting original-template generation", {
    language: input.language,
    imageUrl: input.imageUrl,
  });

  try {
    const [resources, imageDataUrl] = await Promise.all([
      getResources(),
      downloadImageAsBase64(input.imageUrl, 5, 8 * 1024 * 1024),
    ]);
    const background = await sharp(dataUrlToBuffer(imageDataUrl))
      .resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    const textOverlay = await renderTextOverlay(input, resources);

    const poster = await sharp(background)
      .composite([
        { input: textOverlay, top: 0, left: 0 },
        { input: resources.logo, top: 24, left: 24 },
        { input: resources.footer, top: 1225, left: 0 },
      ])
      .png()
      .toBuffer();

    console.log("[Poster] Generated original template", {
      bytes: poster.length,
      width: WIDTH,
      height: HEIGHT,
      language: input.language,
    });
    return poster;
  } catch (error) {
    console.error("[Poster] Generation failed", {
      language: input.language,
      imageUrl: input.imageUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Could not generate the social poster: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
