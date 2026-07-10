import express, { type Express } from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { PATHS } from "./paths.js";

/**
 * Register the server's media/file routes (3D models, podcast audio, uploads).
 *
 * These are API-side file endpoints, not the SPA — they must be available in
 * BOTH dev and production. In dev they're mounted *before* the Vite catch-all so
 * a GLB request doesn't fall through to index.html (which silently broke the
 * mobile 3D viewer against a `pnpm dev` server). In production `serveStatic`
 * calls this before the static bundle + SPA fallback.
 */
export function serveMedia(app: Express) {
  // Serve 3D models (.glb/.gltf) from the model library with HTTP range support
  // so the desktop and mobile three.js viewers can stream them. Only a bare
  // basename with an allowed extension is accepted (no traversal, no other types).
  const MODEL_EXT: Record<string, string> = {
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
  };
  app.get("/media/model/:file", (req, res) => {
    const file = req.params.file;
    // Reject anything that isn't a plain filename (path separators / traversal).
    if (file !== path.basename(file)) {
      res.status(400).end();
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const contentType = MODEL_EXT[ext];
    if (!contentType) {
      res.status(400).end();
      return;
    }
    const full = path.join(PATHS.models, file);
    if (!fs.existsSync(full)) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.sendFile(full);
  });
  // Serve generated podcast audio by jobId with HTTP range support (so the
  // browser/native <audio> can stream + seek). Files live where the podcast
  // engine writes them: ~/.omnecor/podcasts/<jobId>/. The jobId is a UUID, so a
  // strict UUID match both authorizes (unguessable) and prevents path traversal.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const podcastsRoot = path.join(os.homedir(), ".omnecor", "podcasts");
  app.get("/media/podcast/:jobId", (req, res) => {
    const { jobId } = req.params;
    if (!UUID_RE.test(jobId)) {
      res.status(400).end();
      return;
    }
    const dir = path.join(podcastsRoot, jobId);
    const candidate = ["podcast_master.wav", "podcast.wav"]
      .map((name) => path.join(dir, name))
      .find((p) => fs.existsSync(p));
    if (!candidate) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Accept-Ranges", "bytes");
    // sendFile honours Range requests and sets the appropriate 206 headers.
    res.sendFile(candidate);
  });
  app.get("/media/podcast/:jobId/segment/:index", (req, res) => {
    const { jobId, index } = req.params;
    if (!UUID_RE.test(jobId)) {
      res.status(400).end();
      return;
    }
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0) {
      res.status(400).end();
      return;
    }
    const dir = path.join(podcastsRoot, jobId);
    const file = path.join(dir, `segment_${idx}.wav`);
    if (!fs.existsSync(file)) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Accept-Ranges", "bytes");
    res.sendFile(file);
  });
  // Serve user-uploaded attachments from the on-disk uploads directory.
  // Harden the response: prevent MIME sniffing (so an attacker-controlled file
  // can't be re-interpreted as HTML/JS) and force downloads as attachments so
  // active content (HTML/SVG) is never rendered inline in the browser origin.
  const uploadsPath = path.join(process.cwd(), "uploads");
  app.use(
    "/uploads",
    (_req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      next();
    },
    express.static(uploadsPath)
  );
}

/**
 * Serve the built frontend bundle + SPA fallback (production only). Media routes
 * are registered first via {@link serveMedia} so file endpoints win over the
 * catch-all that returns index.html.
 */
export function serveStatic(app: Express) {
  serveMedia(app);

  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
