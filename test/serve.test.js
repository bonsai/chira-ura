import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, "../cli/cli.js");

function startServer(port) {
  return new Promise((resolveReady, rejectReady) => {
    const proc = fork(cliPath, ["serve", "--port", String(port)], {
      stdio: ["pipe", "pipe", "pipe", "ipc"]
    });
    let stdout = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
      if (stdout.includes("bridge:") && stdout.includes("static:")) {
        resolveReady(proc);
      }
    });
    proc.stderr.on("data", (data) => {
      console.error(data.toString());
    });
    proc.on("error", rejectReady);
  });
}

test("chira serve: 静的ファイル配信と /state の共存", async () => {
  const port = 8798;
  const proc = await startServer(port);

  try {
    // 1. /state GET
    const stateRes = await fetch(`http://127.0.0.1:${port}/state`);
    assert.equal(stateRes.status, 200);
    assert.equal(stateRes.headers.get("content-type"), "application/json; charset=utf-8");
    const stateJson = await stateRes.json();
    assert.ok("box" in stateJson);

    // 2. /sidepanel/write.html GET
    const writeRes = await fetch(`http://127.0.0.1:${port}/sidepanel/write.html`);
    assert.equal(writeRes.status, 200);
    assert.equal(writeRes.headers.get("content-type"), "text/html; charset=utf-8");
    const writeHtml = await writeRes.text();
    assert.ok(writeHtml.includes("storage-shim.js"));
    assert.ok(writeHtml.includes("write.js"));

    // 3. /scripts/storage-shim.js GET
    const shimRes = await fetch(`http://127.0.0.1:${port}/scripts/storage-shim.js`);
    assert.equal(shimRes.status, 200);
    assert.equal(shimRes.headers.get("content-type"), "text/javascript; charset=utf-8");
    const shimJs = await shimRes.text();
    assert.ok(shimJs.includes("storage-shim"));

    // 4. /sidepanel/read.html GET
    const readRes = await fetch(`http://127.0.0.1:${port}/sidepanel/read.html`);
    assert.equal(readRes.status, 200);
    assert.equal(readRes.headers.get("content-type"), "text/html; charset=utf-8");

    // 5. パストラバーサル防御 (../cli/cli.js など)
    // Note: global fetch は URL 解決時に `..` を正規化してしまうため http.request で生パスを送る
    const traverseStatusCode = await new Promise((res, rej) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: "/../cli/cli.js",
        method: "GET"
      }, (r) => {
        res(r.statusCode);
      });
      req.on("error", rej);
      req.end();
    });
    assert.equal(traverseStatusCode, 403);

    // 6. 存在しないファイル 404
    const notFoundRes = await fetch(`http://127.0.0.1:${port}/nonexistent.html`);
    assert.equal(notFoundRes.status, 404);
  } finally {
    proc.kill();
  }
});
