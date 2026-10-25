# Knotique Deployment Guide

This guide explains how to deploy Knotique to **Netlify** (Frontend) and connect it to a free persistent backend (like **Render** or **Railway**) so all features work 100% without data loss.

---

## Architecture Overview

| Component | Platform | Why |
|---|---|---|
| **Frontend** (`client/`) | **Netlify** | Fast global CDN, instant deployments from GitHub, custom domains & SSL |
| **Backend** (`server/`) | **Render / Railway / VPS** | Long-running Node.js process, automated daily backups (`knotique.db`), CSV uploads, background jobs |

> ⚠️ **Why Can't Express + SQLite run entirely on Netlify?**  
> Netlify is a static CDN & serverless platform. Serverless functions are stateless and destroy their temporary storage every few minutes. Running an SQLite database on Netlify serverless functions would cause your business data to be wiped on cold-starts. Hosting the backend on a dedicated service keeps all database records, backups, and file uploads safe.

---

## Step 1: Deploy Frontend to Netlify

The repository is now pre-configured for Netlify with [`netlify.toml`](./netlify.toml) and [`client/public/_redirects`](./client/public/_redirects).

1. Log in to [Netlify](https://app.netlify.com).
2. Click **Add new site** > **Import an existing project**.
3. Select **GitHub** and pick `knotiqueoffic-max/nsfb-9108`.
4. The build settings will be automatically detected from `netlify.toml`:
   - **Base directory:** `client`
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
5. Click **Deploy Knotique**.

---

## Step 2: Deploy Backend (Render.com - 100% Free)

1. Sign up / Log in to [Render.com](https://render.com).
2. Click **New +** > **Web Service**.
3. Connect your repository `knotiqueoffic-max/nsfb-9108`.
4. Configure the settings:
   - **Name:** `knotique-backend`
   - **Root Directory:** `server`
   - **Runtime:** `Node`
   - **Build Command:** `npm install && npm run migrate`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
5. Under **Environment Variables**, add:
   - `NODE_ENV` = `production`
   - `PORT` = `5000`
   - `JWT_SECRET` = (any long random string)
   - `CLIENT_URL` = `https://<YOUR-NETLIFY-SITE>.netlify.app`
6. Click **Create Web Service**.  
   Render will provide you with a public URL, for example:  
   `https://knotique-backend.onrender.com`

---

## Step 3: Connect Netlify to your Backend

You have two simple options:

### Option A: Set Environment Variable in Netlify (Recommended)
1. In your Netlify dashboard, go to **Site configuration** > **Environment variables**.
2. Add a new variable:
   - **Key:** `VITE_API_URL`
   - **Value:** `https://knotique-backend.onrender.com` (replace with your actual Render URL)
3. Go to **Deploys** and click **Trigger deploy** > **Deploy site**.

### Option B: Netlify Reverse-Proxy (`netlify.toml`)
Open [`netlify.toml`](./netlify.toml) and uncomment the proxy redirect:
```toml
[[redirects]]
  from = "/api/*"
  to = "https://knotique-backend.onrender.com/api/:splat"
  status = 200
  force = true
```
Commit and push. Netlify will now proxy all `/api/*` traffic automatically!

---

## Running Locally

To run the whole application locally on your machine:
```bash
npm run dev
```
This runs both the backend (`http://localhost:5000`) and the frontend (`http://localhost:5173`) concurrently.
