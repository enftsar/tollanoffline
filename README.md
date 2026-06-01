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
```

4. Deploy.

The included `vercel.json` routes the full app through `api/index.js`, which serves both the static UI and the JSON API.

## Important Production Note

Vercel serverless storage is temporary. For real tournaments, configure durable video storage such as Cloudflare R2, AWS S3, or Vercel Blob before accepting official submissions. The current local storage mode is suitable for development and visual demos, not long-term production evidence storage.

## Useful Commands

```bash
npm run check
npm run dev
```
