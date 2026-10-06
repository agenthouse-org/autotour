import http from "node:http";
import { readFile, open, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { applyReviewAction, openTourReview, reviewView } from "./workflow.js";
import { safePath } from "./files.js";

export async function startTourReview({ root, id, port = 0, ...dependencies }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid review port.");
  const review = await openTourReview({ root, id });
  const lockPath = await safePath(review.directory, "review.lock");
  const lock = await open(lockPath, "wx").catch(error => { if (error.code === "EEXIST") throw new Error("This tour is already open, or a previous process left review.lock. Close that process before removing a stale lock."); throw error; });
  await lock.writeFile(String(process.pid));
  const token = randomBytes(32).toString("hex");
  let busy = false;
  let origin;
  let mediaOrigin;
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".webm": "video/webm" };
  const respond = (response, status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
  const mediaServer = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (request.headers.host !== new URL(mediaOrigin).host || !["GET", "HEAD"].includes(request.method)) return respond(response, 403, { error: "Read-only media origin." });
      const url = new URL(request.url, mediaOrigin);
      if (!url.pathname.startsWith("/media/captures/")) throw new Error("Invalid media path.");
      const relative = decodeURIComponent(url.pathname.slice("/media/".length));
      if (relative.includes("\\") || relative.split("/").some(part => part.startsWith("."))) throw new Error("Invalid media path.");
      const file = await safePath(review.directory, relative);
      const extension = path.extname(file);
      if (!types[extension]) throw new Error("Unsupported media.");
      const bytes = await readFile(file);
      response.writeHead(200, { "Content-Type": types[extension] });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch { respond(response, 404, { error: "Unable to load this local resource." }); }
  });
  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (request.headers.host !== new URL(origin).host) return respond(response, 403, { error: "Invalid host." });
      const url = new URL(request.url, origin);
      if (request.method === "POST") {
        if (url.pathname !== "/api/action" || request.headers.origin !== origin || request.headers["x-autotour-token"] !== token || request.headers["content-type"] !== "application/json") return respond(response, 403, { error: "Review authorization failed." });
        if (busy) return respond(response, 409, { error: "Another review action is running. Wait for it to finish." });
        busy = true;
        try {
          let body = "";
          for await (const chunk of request) { body += chunk.toString(); if (Buffer.byteLength(body) > 128000) throw new Error("Request is too large."); }
          const result = await applyReviewAction(review, JSON.parse(body), dependencies);
          return respond(response, 200, { ...result, mediaOrigin });
        } catch (error) { return respond(response, 400, { error: error.message }); }
        finally { busy = false; }
      }
      if (!["GET", "HEAD"].includes(request.method)) return respond(response, 405, { error: "Method not supported." });
      if (url.pathname === "/api/state") return respond(response, 200, { ...await reviewView(review), busy, mediaOrigin });
      let bytes;
      let extension;
      if (["/", "/review.css", "/review-ui.js"].includes(url.pathname)) {
        const name = url.pathname === "/" ? "review.html" : url.pathname.slice(1);
        bytes = await readFile(new URL(name, import.meta.url));
        if (name === "review.html") bytes = Buffer.from(bytes.toString().replace("__TOKEN__", token));
        extension = path.extname(name);
        response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src ${mediaOrigin} data:; media-src ${mediaOrigin}; frame-src ${mediaOrigin}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
      } else return respond(response, 404, { error: "Not found." });
      response.writeHead(200, { "Content-Type": types[extension] });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch { if (!response.headersSent) respond(response, 404, { error: "Unable to load this local resource." }); else response.end(); }
  });
  try {
    await new Promise((resolve, reject) => { mediaServer.once("error", reject); mediaServer.listen(0, "127.0.0.1", resolve); });
    mediaOrigin = `http://127.0.0.1:${mediaServer.address().port}`;
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
  } catch (error) { mediaServer.close(); await lock.close(); await unlink(lockPath); throw error; }
  return { url: origin + "/", review, server, async close() {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await new Promise((resolve, reject) => mediaServer.close(error => error ? reject(error) : resolve()));
    await lock.close(); await unlink(lockPath);
  } };
}
