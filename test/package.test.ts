import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const scannerPath = path.join(process.cwd(), "scripts", "privacy-scan.mjs");
const tempRoots = new Set<string>();

afterEach(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-privacy-"));
  tempRoots.add(root);
  return root;
}

function runScanner(cwd: string): { status: number | null; stderr: string } {
  const result = spawnSync("node", [scannerPath], { cwd, encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

describe("package manifest", () => {
  it("points Pi at compiled JavaScript extension files", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      pi?: { extensions?: string[] };
    };

    expect(packageJson.pi?.extensions).toEqual(["./dist/extensions/company.js"]);

    for (const extension of packageJson.pi?.extensions ?? []) {
      expect(extension).toMatch(/\.js$/);
      expect(path.extname(extension)).toBe(".js");
    }
  });
});

describe("privacy scan", () => {
  it("flags quoted JSON secret keys", () => {
    const root = fixtureRoot();
    fs.writeFileSync(
      path.join(root, "config.json"),
      '{ "api_key": "Xq92ZbMfL08aQwErTyUiOp34", "password": "Sup3rSecretValue12345" }\n', // privacy-scan: allow
      "utf8",
    );
    const { status, stderr } = runScanner(root);
    expect(status).toBe(1);
    expect(stderr).toContain("config.json");
    expect(stderr).toContain("literal secret assignment");
  });

  it("flags compound secret field names", () => {
    const root = fixtureRoot();
    fs.writeFileSync(
      path.join(root, "secrets.env"),
      [
        "client_secret=Xq92ZbMfL08aQwErTyUiOp34", // privacy-scan: allow
        "auth_token=Xq92ZbMfL08aQwErTyUiOp34", // privacy-scan: allow
        "jwt_secret=Xq92ZbMfL08aQwErTyUiOp34", // privacy-scan: allow
      ].join("\n") + "\n",
      "utf8",
    );
    const { status, stderr } = runScanner(root);
    expect(status).toBe(1);
    expect(stderr).toContain("client_secret");
    expect(stderr).toContain("auth_token");
    expect(stderr).toContain("jwt_secret");
  });

  it("does not flag placeholders or environment-variable references", () => {
    const root = fixtureRoot();
    fs.writeFileSync(
      path.join(root, "example.env"),
      [
        "api_key=process.env.API_KEY",
        "secret: ${SECRET}",
        'password = "your-password-here"',
        "token: <YOUR_TOKEN>",
      ].join("\n") + "\n",
      "utf8",
    );
    const { status } = runScanner(root);
    expect(status).toBe(0);
  });
});
