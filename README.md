# Posh Choice Store Backend

Express + MongoDB API for the Posh Choice Store.

## Local development

1. Copy `.env.example` to `.env` and fill in the values (`MONGODB_URI` and `JWT_SECRET` are required; the server refuses to start without `JWT_SECRET`).
2. `npm install`
3. `npm run dev` (auto-restarts on changes) or `npm start`
4. `npm test` runs the order-pricing tests.

## One-off after upgrading

Run once against each database (local and production) to replace the old cart/wishlist indexes:

```
npm run sync-indexes
```

The old indexes stopped a second guest cart from being created and stopped two users from wishlisting the same product.

## Deploying to Vercel

The app is split so it runs both as a normal server and as a Vercel serverless function:

- `app.js` – the Express app (exported, no `listen`)
- `server.js` – local / Render entry point (`app.listen`)
- `api/index.js` + `vercel.json` – Vercel entry point; all paths are rewritten to the function

Steps:

1. In Vercel, **Add New → Project**, import the `posh-choice-backend` GitHub repo. Framework preset: **Other**. No build command.
2. Add every variable from `.env.example` under **Settings → Environment Variables** (set `BACKEND_URL` to the Vercel URL, e.g. `https://posh-choice-backend.vercel.app`).
3. In MongoDB Atlas → **Network Access**, allow `0.0.0.0/0` (Vercel has no fixed outbound IPs).
4. Deploy, then check `https://<your-backend>.vercel.app/` shows "Posh Choice Store Backend Running".
5. In the frontend's Vercel project set `VITE_API_BASE_URL=https://<your-backend>.vercel.app/api` and redeploy it.
6. Add the frontend's domains to `corsOptions.origin` in `app.js` if any are missing.

Serverless limits to be aware of:

- Request bodies are limited to ~4.5MB. The admin frontend compresses images before upload; payment proofs are limited to 4MB.
- Files cannot be written to disk; all uploads go to Cloudinary.
- `maxDuration` is 60s in `vercel.json`. Very large newsletter sends may need a higher limit (plan-dependent) or a background job.
- Rate limits are kept in memory per function instance, so they are best-effort on serverless.
