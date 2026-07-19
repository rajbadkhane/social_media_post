import type { Language } from "./fetchArticles";

export const PLATFORMS = ["facebook", "instagram", "linkedin", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type SocialSuccessMode = "ANY_SUCCESS" | "ALL_SUCCESS";

export interface SocialConfig {
  articleApiEnglishUrl: string;
  articleApiHindiUrl: string;
  publicSiteUrl: string;
  autoPublishEnabled: boolean;
  autoPublishIntervalSeconds: number;
  autoPublishDailyLimit: number;
  socialSuccessMode: SocialSuccessMode;
  autoPublishSecret: string;
  cronSecret: string;
  dryRun: boolean;
  metaGraphApiVersion: string;
  linkedInApiVersion: string;
  publicPosterBaseUrl: string;
  tempPosterTtlSeconds: number;
  tempPosterCleanupMinutes: number;
  instagramProcessingTimeoutSeconds: number;
  retryFailedPlatforms: boolean;
  facebookPageId: string;
  facebookPageAccessToken: string;
  instagramAccountId: string;
  instagramAccessToken: string;
  linkedInAccessToken: string;
  xApiKey: string;
  xApiSecret: string;
  xAccessToken: string;
  xAccessTokenSecret: string;
  enabled: Record<Platform, boolean>;
}

function value(name: string): string { return (process.env[name] || "").trim(); }
function bool(name: string, fallback = false): boolean { const raw = value(name); return raw ? raw.toLowerCase() === "true" : fallback; }
function vercelBaseUrl(): string { const host = value("VERCEL_URL"); return host ? `https://${host}` : ""; }

export function getSocialConfig(): SocialConfig {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const english = value("ARTICLE_API_ENGLISH_URL") || "https://api.thecliffnews.in/api/articles?limit=100&language=ENGLISH";
  const hindi = value("ARTICLE_API_HINDI_URL") || "https://api.thecliffnews.in/api/articles?limit=100&language=HINDI";
  return {
    articleApiEnglishUrl: english,
    articleApiHindiUrl: hindi,
    publicSiteUrl: value("PUBLIC_SITE_URL") || value("PUBLIC_SITE_BASE_URL") || "https://www.thecliffnews.in",
    autoPublishEnabled: bool("AUTO_PUBLISH_ENABLED", false),
    autoPublishIntervalSeconds: Math.max(10, Number(value("AUTO_PUBLISH_INTERVAL_SECONDS") || "60")),
    autoPublishDailyLimit: Math.min(50, Math.max(1, Number(value("AUTO_PUBLISH_DAILY_LIMIT") || "50"))),
    socialSuccessMode: value("SOCIAL_SUCCESS_MODE") === "ALL_SUCCESS" ? "ALL_SUCCESS" : "ANY_SUCCESS",
    autoPublishSecret: value("AUTO_PUBLISH_SECRET"),
    cronSecret: value("CRON_SECRET"),
    dryRun: bool("SOCIAL_DRY_RUN", isDevelopment && !process.env.SOCIAL_DRY_RUN),
    metaGraphApiVersion: value("META_GRAPH_API_VERSION") || "v23.0",
    linkedInApiVersion: value("LINKEDIN_API_VERSION") || "202607",
    publicPosterBaseUrl: value("PUBLIC_POSTER_BASE_URL") || vercelBaseUrl(),
    tempPosterTtlSeconds: Math.max(60, Number(value("TEMP_POSTER_TTL_SECONDS") || "900")),
    tempPosterCleanupMinutes: Math.max(1, Number(value("TEMP_POSTER_CLEANUP_MINUTES") || "30")),
    instagramProcessingTimeoutSeconds: Math.min(300, Math.max(30, Number(value("INSTAGRAM_PROCESSING_TIMEOUT_SECONDS") || "300"))),
    retryFailedPlatforms: bool("RETRY_FAILED_PLATFORMS", false),
    facebookPageId: value("FACEBOOK_PAGE_ID"),
    facebookPageAccessToken: value("FACEBOOK_PAGE_ACCESS_TOKEN") || value("FACEBOOK_PAGE_TOKEN"),
    instagramAccountId: value("INSTAGRAM_ACCOUNT_ID"),
    instagramAccessToken: value("INSTAGRAM_ACCESS_TOKEN") || value("INSTAGRAM_TOKEN"),
    linkedInAccessToken: value("LINKEDIN_ACCESS_TOKEN") || value("LINKEDIN_TOKEN"),
    xApiKey: value("X_API_KEY"),
    xApiSecret: value("X_API_SECRET"),
    xAccessToken: value("X_ACCESS_TOKEN"),
    xAccessTokenSecret: value("X_ACCESS_TOKEN_SECRET"),
    enabled: {
      facebook: bool("ENABLE_FACEBOOK"),
      instagram: bool("ENABLE_INSTAGRAM"),
      linkedin: bool("ENABLE_LINKEDIN"),
      x: bool("ENABLE_X"),
    },
  };
}

export function platformCredentialsConfigured(platform: Platform, config = getSocialConfig()): boolean {
  if (platform === "facebook") return Boolean(config.facebookPageId && config.facebookPageAccessToken);
  if (platform === "instagram") return Boolean(config.instagramAccountId && config.instagramAccessToken);
  if (platform === "linkedin") return Boolean(config.linkedInAccessToken);
  return Boolean(config.xApiKey && config.xApiSecret && config.xAccessToken && config.xAccessTokenSecret);
}

export function platformEnabled(platform: Platform, config = getSocialConfig()): boolean {
  return config.enabled[platform];
}

export function enabledPlatforms(config = getSocialConfig()): Platform[] {
  return PLATFORMS.filter((platform) => platformEnabled(platform, config));
}

export function configurationIssues(config = getSocialConfig()): string[] {
  const issues: string[] = [];
  for (const platform of enabledPlatforms(config)) {
    if (!platformCredentialsConfigured(platform, config)) issues.push(`${platform} credentials are incomplete`);
  }
  if (enabledPlatforms(config).includes("instagram") && !config.dryRun && (!config.publicPosterBaseUrl || !/^https:\/\//i.test(config.publicPosterBaseUrl))) {
    issues.push("Instagram requires the PostMaker to be deployed on a publicly accessible HTTPS domain");
  }
  return issues;
}

export function languageName(language: Language): string { return language === "HINDI" ? "Hindi" : "English"; }
