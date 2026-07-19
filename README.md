# The Cliff News Poster Maker

This is a single Next.js poster editor with a lightweight automatic publisher. The manual editor in `public/poster.html` remains the public homepage and is not redesigned.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local`, add the platform credentials and a deployed `PUBLIC_POSTER_BASE_URL` for Instagram, then open `http://localhost:3000`. Keep `AUTO_PUBLISH_ENABLED=false` while testing. Use `SOCIAL_DRY_RUN=true` to fetch live articles, generate the real poster and captions, and skip all social API calls.

The publisher stores its only persistent state in `state.json`. It builds English/Hindi pairs from `sourceArticleId` and `translations`, selects the oldest eligible pair, posts one language per pair, alternates English/Hindi, and records each platform result so a retry cannot duplicate an already successful post. State writes are atomic and cycles use a local lock.

## Production

```bash
npm install
npm run build
npm run start
```

Keep `state.json` on persistent storage. Do not expose `.env.local` or the state file publicly. Configure the Meta Page/Instagram permissions, LinkedIn personal profile `w_member_social` token, X OAuth media/post permissions, and a public HTTPS deployment URL before enabling automatic publishing. Generated posters exist only in `runtime-posters/` during a cycle and are deleted afterward.

For a Hostinger VPS, build the app and run `pm2 start ecosystem.config.cjs`. The Next.js app serves the protected routes, while `scripts/auto-publisher.js` invokes `/api/social/run-cycle` at the configured interval. The browser never receives an access token or `AUTO_PUBLISH_SECRET`.
