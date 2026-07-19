import { enabledPlatforms, getSocialConfig, platformCredentialsConfigured, PLATFORMS, type Platform } from "./config";
import { publishFacebook } from "./publishFacebook";
import { publishInstagram } from "./publishInstagram";
import { publishLinkedIn } from "./publishLinkedIn";
import { publishX } from "./publishX";
import { redactSecrets } from "./http";

export { PLATFORMS };
export type { Platform };
export interface PlatformResult { enabled: boolean; status: "SUCCESS" | "FAILURE" | "DISABLED" | "DRY_RUN" | "SKIPPED"; postId?: string; postUrl?: string; error?: string; payload?: Record<string, unknown>; updatedAt: string }
export type Provider = (input: { poster: Buffer; temporaryImageUrl: string | null; caption: string }) => Promise<{ postId: string; postUrl?: string }>;
export interface ProviderSet { facebook: Provider; instagram: Provider; linkedin: Provider; x: Provider }
export interface PublishPlatformsInput {
  poster: Buffer;
  temporaryImageUrl: string | null;
  captions: Record<Platform, string>;
  previous: Partial<Record<Platform, PlatformResult>>;
  dryRun: boolean;
  onResult?: (platform: Platform, result: PlatformResult) => Promise<void>;
  providers?: ProviderSet;
  onlyPlatform?: Platform;
  instagramError?: string;
}

const providers: ProviderSet = {
  facebook: async ({ poster, caption }) => publishFacebook(poster, caption),
  instagram: async ({ temporaryImageUrl, caption }) => publishInstagram(temporaryImageUrl || "", caption),
  linkedin: async ({ poster, caption }) => publishLinkedIn(poster, caption),
  x: async ({ poster, caption }) => publishX(poster, caption),
};

function now(): string { return new Date().toISOString(); }
function dryPayload(platform: Platform, input: PublishPlatformsInput): Record<string, unknown> {
  if (platform === "facebook") return { source: "generated-poster.png", caption: input.captions.facebook };
  if (platform === "instagram") return { image_url: input.temporaryImageUrl, caption: input.captions.instagram, requires_public_https_url: !input.temporaryImageUrl };
  if (platform === "linkedin") return { author: "authenticated profile person urn resolved server-side", commentary: input.captions.linkedin, image: "generated-poster.png" };
  return { text: input.captions.x, media: { media_ids: ["generated-poster.png"] } };
}

export async function publishAll(input: PublishPlatformsInput): Promise<Record<Platform, PlatformResult>> {
  const config = getSocialConfig();
  const activeProviders = input.providers || providers;
  const results = {} as Record<Platform, PlatformResult>;
  for (const platform of PLATFORMS) {
    if (input.onlyPlatform && input.onlyPlatform !== platform) {
      results[platform] = { enabled: false, status: "SKIPPED", updatedAt: now() };
      continue;
    }
    const enabled = enabledPlatforms(config).includes(platform);
    if (!enabled) {
      results[platform] = { enabled: false, status: "DISABLED", updatedAt: now() };
      await input.onResult?.(platform, results[platform]);
      continue;
    }
    const previous = input.previous[platform];
    if (previous?.status === "SUCCESS") {
      results[platform] = { ...previous, enabled: true, status: "SUCCESS", updatedAt: now() };
      await input.onResult?.(platform, results[platform]);
      continue;
    }
    if (previous?.status === "FAILURE" && !config.retryFailedPlatforms) {
      results[platform] = { enabled: true, status: "FAILURE", error: "Previous platform failure was not retried", updatedAt: now() };
      await input.onResult?.(platform, results[platform]);
      continue;
    }
    if (!platformCredentialsConfigured(platform, config) && !input.dryRun) {
      results[platform] = { enabled: true, status: "FAILURE", error: `${platform} credentials are incomplete`, updatedAt: now() };
      await input.onResult?.(platform, results[platform]);
      continue;
    }
    if (input.dryRun) {
      results[platform] = { enabled: true, status: "DRY_RUN", payload: dryPayload(platform, input), updatedAt: now() };
      await input.onResult?.(platform, results[platform]);
      continue;
    }
    if (platform === "instagram" && input.instagramError) {
      results[platform] = { enabled: true, status: "FAILURE", error: input.instagramError, updatedAt: now() };
      await input.onResult?.(platform, results[platform]);
      continue;
    }
    try {
      const response = await activeProviders[platform]({ poster: input.poster, temporaryImageUrl: input.temporaryImageUrl, caption: input.captions[platform] });
      results[platform] = { enabled: true, status: "SUCCESS", postId: response.postId, postUrl: response.postUrl, updatedAt: now() };
    } catch (error) {
      results[platform] = { enabled: true, status: "FAILURE", error: redactSecrets(error instanceof Error ? error.message : `${platform} request failed`), updatedAt: now() };
    }
    await input.onResult?.(platform, results[platform]);
  }
  return results;
}

export function configuredPlatformCount(): number { return enabledPlatforms().length; }
