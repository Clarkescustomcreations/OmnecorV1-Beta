import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
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
