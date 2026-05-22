// Multipart parser — small, focused; avoids pulling in busboy/multer for two fields.
// Used by /v1/bundles/generate and POST /v1/sessions.

export function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const buf = Buffer.concat(chunks);
        const ct = req.headers["content-type"] || "";
        const m = ct.match(/boundary=(?:"?)([^";]+)/);
        if (!m) return reject(new Error("no boundary in Content-Type"));
        const boundary = "--" + m[1];
        const parts = buf.toString("binary").split(boundary).slice(1, -1);
        const fields = {}, files = {};
        for (const part of parts) {
          const idx = part.indexOf("\r\n\r\n");
          if (idx < 0) continue;
          const headers = part.slice(0, idx);
          const body = Buffer.from(part.slice(idx + 4, -2), "binary");
          const nameMatch = headers.match(/name="([^"]+)"/);
          if (!nameMatch) continue;
          const name = nameMatch[1];
          const filenameMatch = headers.match(/filename="([^"]*)"/);
          if (filenameMatch && filenameMatch[1]) {
            files[name] = { filename: filenameMatch[1], buffer: body };
          } else {
            fields[name] = body.toString("utf8").trim();
          }
        }
        resolve({ fields, files });
      } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
