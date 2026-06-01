# Tollan Offline Country Cup

Desktop-only tournament portal for Tollan Universe offline events. Players register, record their run, submit it for admin review, and track their recording status. Admins can review recordings, manage decisions, edit the bracket, lock the bracket, and publish winners.

## Local Development

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:4173
```

Admin access:

```text
http://127.0.0.1:4173?admin=1
```

Set credentials with environment variables before deployment:

```bash
ADMIN_USER=admin
ADMIN_PASSWORD=your-secure-password
```

## Vercel Deployment

1. Push this folder to a GitHub repository.
2. Import the repository in Vercel.
3. Add these Vercel Environment Variables:

```text
ADMIN_USER
ADMIN_PASSWORD
STORAGE_MODE
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
```

4. Deploy.

The included `vercel.json` routes the full app through `api/index.js`, which serves both the static UI and the JSON API.

## Cloudflare R2 Storage

Set:

```text
STORAGE_MODE=r2
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET=your-bucket-name
```

Create a Cloudflare R2 API token with object read/write access for the selected bucket. The app stores video files under `recordings/` and durable tournament data under `_tollan-data/`.

Add this CORS policy to the R2 bucket so browser uploads can PUT directly to R2:

```json
[
  {
    "AllowedOrigins": [
      "https://your-vercel-domain.vercel.app",
      "http://127.0.0.1:4173"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Production Note

Vercel serverless storage is temporary. For real tournaments, use `STORAGE_MODE=r2`; this stores both recordings and tournament JSON data in Cloudflare R2. Local storage mode is only for development and visual demos.

## Useful Commands

```bash
npm run check
npm run dev
```
