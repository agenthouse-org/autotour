import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDoctor } from "../src/cli.js";
import { compareSemver, packageVersionCheck, readProjectAutotourVersion } from "../src/doctor.js";

test("compares numeric versions and warns only when the project package is older", () => {
  assert.equal(compareSemver("0.3.0", "0.5.0"), -1);
  assert.equal(compareSemver("0.10.0", "0.5.0"), 1);
  assert.equal(compareSemver("0.5.0", "0.5.0"), 0);
  const older = packageVersionCheck({ cliVersion: "0.5.0", project: { version: "0.3.0", source: "installed" } });
  assert.equal(older.advisory, true);
  assert.equal(older.ok, true);
  assert.match(older.detail, /0\.3\.0 is older than this CLI 0\.5\.0/);
  const same = packageVersionCheck({ cliVersion: "0.5.0", project: { version: "0.5.0", source: "package" } });
  assert.equal(same.advisory, false);
});

test("doctor warns about an older installed package and still exits 0", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autotour-doctor-"));
  await mkdir(path.join(root, "node_modules/autotour"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "ao-files", dependencies: { autotour: "^0.3.0" } }));
  await writeFile(path.join(root, "node_modules/autotour/package.json"), JSON.stringify({ name: "autotour", version: "0.3.0" }));
  assert.deepEqual(await readProjectAutotourVersion(root), { version: "0.3.0", source: "installed" });
  const lines = [];
  const code = await runDoctor({ cwd: root, cliVersion: "0.5.0", log: line => lines.push(line) });
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /warn - Project autotour package \(0\.3\.0 is older than this CLI 0\.5\.0/);
});
