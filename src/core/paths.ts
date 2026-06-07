import path from "node:path";
import type { CompanyPaths } from "./types.js";

export const COMPANY_DIR = ".pi-company";

export function resolveProjectRoot(cwd = process.cwd()): string {
  return path.resolve(cwd);
}

export function companyPaths(root = process.cwd()): CompanyPaths {
  const resolved = resolveProjectRoot(root);
  const dir = path.join(resolved, COMPANY_DIR);
  return {
    root: resolved,
    dir,
    events: path.join(dir, "events.jsonl"),
    state: path.join(dir, "state.json"),
    config: path.join(dir, "company.yaml"),
    roster: path.join(dir, "roster.yaml"),
    rolesDir: path.join(dir, "roles"),
    mailboxesDir: path.join(dir, "mailboxes"),
    issuesDir: path.join(dir, "issues"),
    prsDir: path.join(dir, "prs"),
    worktreesDir: path.join(dir, "worktrees"),
  };
}

export function mailboxPath(paths: CompanyPaths, agent: string): string {
  return path.join(paths.mailboxesDir, `${agent}.jsonl`);
}

export function issuePath(paths: CompanyPaths, issueId: string): string {
  return path.join(paths.issuesDir, `${issueId}.md`);
}

export function prPath(paths: CompanyPaths, prId: string): string {
  return path.join(paths.prsDir, `${prId}.md`);
}
