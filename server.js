const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { listPrayers, createPrayer, clearArea, deletePrayer, transcribe } = require("./lib/prayer-service");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/prayers") {
      await handleApi(request, response);
      return;
    }
    if (url.pathname === "/api/transcribe" && request.method === "POST") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await transcribe(body));
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, error.status || 500, { error: error.message || "Server error." });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nPort ${port} is already in use.\n\n` +
      `Fix options:\n` +
      `  1. Stop whatever is using port ${port}\n` +
      `  2. Use a different port:  PORT=3000 npm start\n` +
      `     (PowerShell:  $env:PORT=3000; npm start)\n`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(port, host, () => {
  console.log(`Tulsa Prayer Map running at http://${host}:${port}`);
});

async function handleApi(request, response) {
  if (request.method === "GET") {
    sendJson(response, 200, await listPrayers());
    return;
  }

  const body = await readJsonBody(request);

  if (request.method === "POST") {
    sendJson(response, 200, await createPrayer(body));
    return;
  }

  if (request.method === "DELETE") {
    if (body.prayerId) {
      sendJson(response, 200, await deletePrayer(body.areaId, body.prayerId, body.password));
      return;
    }
    sendJson(response, 200, await clearArea(body.areaId, body.password));
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
}

async function serveStatic(response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname === "/admin" ? "admin.html" : pathname.slice(1);
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 11_000_000) throw Object.assign(new Error("Request body too large."), { status: 413 });
  }
  return JSON.parse(body || "{}");
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}
