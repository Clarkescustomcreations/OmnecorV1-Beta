# Omnecor Deployment Guide

This package contains the latest Omnecor AI Workstation application ready for deployment.

## Package Contents

- **source/** - Complete source code
- **dist-files/** - Built frontend and server bundle

## Deployment Options

### Vercel (Recommended - Full Stack)
1. Extract source/ to GitHub repo
2. Connect to Vercel
3. Set environment variables
4. Deploy

### Railway (Full Stack)
1. Push source/ to GitHub
2. Connect repo to Railway
3. Add MySQL database
4. Deploy

### GitHub Pages (Frontend Only)
1. Copy dist-files/public/ to GitHub Pages repo
2. Enable GitHub Pages
3. Deploy

### Docker (Self-Hosted)
```bash
cd source/
docker build -t omnecor .
docker run -p 3000:3000 -e DATABASE_URL=... omnecor
```

### Local Development
```bash
cd source/
pnpm install
pnpm dev
```

## Environment Variables

- DATABASE_URL - MySQL connection string
- JWT_SECRET - Session signing secret
- VITE_APP_ID - OAuth application ID
- OAUTH_SERVER_URL - OAuth provider URL
- NODE_ENV - Set to production for builds

## Build & Deploy

```bash
cd source/
pnpm install
pnpm build
pnpm start
```

## Support

Original Repository: https://github.com/Clarkescustomcreations/OmnecorV1-Beta
