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

function runCli(root: string, args: string[]): { stdout: string } {
  const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const cli = path.join(process.cwd(), "src", "cli.ts");
  const result = spawnSync(tsx, [cli, "--root", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `pi-company ${args.join(" ")} failed`);
  return { stdout: result.stdout };
}

describe("cli", () => {
  it("writes and reads delivery OKF concepts", () => {
    const root = fixtureRoot();
    runCli(root, ["init", "--id", "cli-okf"]);
    runCli(root, ["spawn", "coder", "--manual", "--no-worktree"]);
    runCli(root, [
      "okf",
      "contract",
      "create",
      "cli-contract",
      "--title",
      "CLI contract",
      "--owner",
      "lead",
      "--scope",
      "Build a small browser game.",
      "--done",
      "playable",
    ]);
    runCli(root, [
      "okf",
      "role-bundle",
      "write",
      "cli-research",
      "--kind",
      "research_brief",
      "--actor",
      "researcher",
      "--title",
      "CLI research",
      "--contract",
      "cli-contract",
      "--summary",
      "Use targeted public suite maps.",
      "--guidance",
      "Query and consume before patching.",
    ]);
    const read = runCli(root, ["okf", "read", "contract", "cli-contract"]);
    const list = runCli(root, ["okf", "list", "--contract", "cli-contract"]);
    const query = runCli(root, ["okf", "query", "consume before patching", "--scope", "delivery", "--contract", "cli-contract"]);
    const validate = runCli(root, ["okf", "validate", "--contract", "cli-contract"]);
    const use = runCli(root, ["okf", "use", "coder", "--contract", "cli-contract", "--consume-as", "coder", "--manifest", "cli-use", "--output", "src/fix.ts"]);

    expect(fs.existsSync(path.join(root, ".pi-company", "okf", "delivery", "contracts", "cli-contract.md"))).toBe(true);
    expect(read.stdout).toContain("SprintContract");
    expect(read.stdout).toContain("Runtime authority boundary");
    expect(list.stdout).toContain("role-bundle/cli-research [active]");
    expect(query.stdout).toContain("Query and consume before patching.");
    expect(validate.stdout).toContain("OKF validation report");
    expect(use.stdout).toContain("Recorded ConsumptionManifest");
    expect(fs.existsSync(path.join(root, ".pi-company", "okf", "delivery", "consumption", "cli-use.md"))).toBe(true);
  });
});

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
