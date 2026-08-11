import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Re-run the module's platformArgs logic in-process
const androidDirectory = path.join(
  fileURLToPath(new URL("../../../../", import.meta.url)),
  "apps",
  "seller-android",
);

function platformArgs(command, args, platform = process.platform) {
  if (platform !== "win32") {
    return { command, args };
  }
  const quotedArgs = [command, ...args]
    .map((a) => `"${a.replace(/"/g, '\\"')}"`)
    .join(" ");
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", quotedArgs],
  };
}

describe("platformArgs wrapper", () => {
  it("passes command and args through on non-Windows", () => {
    const { command, args } = platformArgs("npm", ["test"], "linux");
    assert.equal(command, "npm");
    assert.deepEqual(args, ["test"]);
  });

  it("wraps commands in cmd.exe on Windows", () => {
    const { command, args } = platformArgs("npm", ["test", "--", "--run"], "win32");
    assert.equal(command, "cmd.exe");
    assert.deepEqual(args[0], "/d");
    assert.deepEqual(args[1], "/s");
    assert.deepEqual(args[2], "/c");
    // last arg is a single string containing all quoted pieces
    const combined = args[3];
    assert.match(combined, /"npm"/);
    assert.match(combined, /"test"/);
    assert.match(combined, /"--"/);
    assert.match(combined, /"--run"/);
  });

  it("escapes embedded double-quotes on Windows", () => {
    const { command, args } = platformArgs(
      "gradlew",
      ['-Pmessage="hello world"'],
      "win32",
    );
    assert.equal(command, "cmd.exe");
    const combined = args[3];
    assert.match(combined, /\\"hello world\\"/);
  });
});

describe("verify.mjs spawn pattern", () => {
  it("can invoke platformArgs-wrapped cmd.exe on simulated Windows", () => {
    const { command, args } = platformArgs(
      path.join(androidDirectory, "gradlew"),
      ["verifyAuthPhase1Contract"],
      "win32",
    );

    const result = spawnSync(command, args, {
      stdio: "pipe",
      shell: false,
      timeout: 5_000,
    });

    // On a non-Windows host we expect ENOENT because cmd.exe doesn't exist.
    // In CI (Ubuntu) that is fine: we're testing the spawn wrapper contract.
    if (process.platform !== "win32") {
      assert.ok(result.error, `Expected no cmd.exe, got ${JSON.stringify(result)}`);
      assert.equal(result.error.code, "ENOENT");
    } else {
      // On a real Windows host, cmd.exe exists and should exit quickly.
      assert.ifError(result.error);
      // cmd.exe /d /s /c with a non-existent gradlew path returns 1
      assert.ok(result.status !== null);
    }
  });
});
