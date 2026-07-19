import puppeteer, { type Browser } from "puppeteer";
import { downloadImageAsBase64 } from "./article/extractImage";

export interface PosterInput { headline: string; summary: string; imageUrl: string; category: string; seoHashtags: string[]; smoHashtags: string[]; captions: { facebook: string; instagram: string; linkedin: string; twitter: string }; language: string }
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> { if (browser?.connected) return browser; browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }); return browser; }
function templateUrl(): string { if (process.env.TEMPLATE_URL) return process.env.TEMPLATE_URL; if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/poster.html`; return "http://localhost:3000/poster.html"; }

export async function generatePoster(input: PosterInput): Promise<Buffer> {
  const page = await (await getBrowser()).newPage();
  try {
    await page.setViewport({ width: 2048, height: 1365, deviceScaleFactor: 1 });
    await page.goto(templateUrl(), { waitUntil: "networkidle0", timeout: 30000 });
    const imageDataUrl = await downloadImageAsBase64(input.imageUrl, 5, 8 * 1024 * 1024);
    await page.evaluate((data) => {
      const set = (id: string, value: string) => { const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null; if (!el) return; el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
      const image = document.getElementById("newsImage") as HTMLImageElement | null; if (image) { image.src = data.imageDataUrl; image.style.display = "block"; }
      document.getElementById("imagePlaceholder")?.setAttribute("style", "display:none");
      set("headlineInput", data.headline); set("summaryInput", data.summary); set("categoryInput", data.category); set("seoHashtagsInput", data.seo.join(", ")); set("smoHashtagsInput", data.smo.join(", ")); set("fbCaptionInput", data.captions.facebook); set("igCaptionInput", data.captions.instagram); set("liCaptionInput", data.captions.linkedin); set("twCaptionInput", data.captions.twitter); set("languageInput", data.language);
      document.getElementById("headlineInput")?.dispatchEvent(new Event("input", { bubbles: true }));
    }, { ...input, imageDataUrl, seo: input.seoHashtags, smo: input.smoHashtags });
    await page.waitForFunction(() => { const image = document.getElementById("newsImage") as HTMLImageElement | null; return Boolean(image?.complete && image.naturalWidth > 0); }, { timeout: 30000 });
    await page.evaluate(() => (document as any).fonts?.ready);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const poster = await page.$("#poster"); if (!poster) throw new Error("Poster element not found");
    return Buffer.from(await poster.screenshot({ type: "png" }));
  } finally { await page.close().catch(() => undefined); }
}
