import http from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export async function startPreview(directory, { port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid preview port");
  const root = await realpath(directory);
  if (!(await stat(path.join(root, "index.html"))).isFile()) throw new Error("Preview requires index.html");
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webm": "video/webm", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const server = http.createServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
      if (!/^127\.0\.0\.1:\d+$/.test(request.headers.host ?? "")) { response.writeHead(403).end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname.includes("\\") || pathname.split("/").some(part => part.startsWith("."))) { response.writeHead(403).end(); return; }
      let file = await realpath(path.join(root, pathname));
      const within = candidate => { const relative = path.relative(root, candidate); return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
      if (!within(file)) { response.writeHead(403).end(); return; }
      if ((await stat(file)).isDirectory()) file = await realpath(path.join(file, "index.html"));
      if (!within(file)) { response.writeHead(403).end(); return; }
      response.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : await readFile(file));
    } catch { if (!response.headersSent) response.writeHead(404); response.end("Not found"); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
