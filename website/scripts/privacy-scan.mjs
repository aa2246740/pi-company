#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const ignoredDirectories = new Set([
  ".cache",
  ".git",
  ".pi-company",
  ".vite",
  "coverage",
  "node_modules",
]);

const ignoredFilePatterns = [
  /\.DS_Store$/i,
  /\.log$/i,
  /\.tgz$/i,
  /\.tar\.gz$/i,
];

const suspiciousAssetNamePattern =
  /(?:qrcode|qr-code|payment|pay-code|wechat|weixin|alipay|donate|收款|支付).*\.(?:png|jpe?g|webp|gif|heic|pdf)$/i;

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".csv",
  ".env",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".lock",
  ".md",
  ".mjs",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".yaml",
  ".yml",
]);

const rules = [
  {
    name: "private key block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    name: "OpenAI-style API key",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: "GitHub token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    name: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    name: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    name: "Bearer token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi,
  },
  {
    name: "literal secret assignment",
    pattern:
      /\b(?:api[_-]?key|secret|access[_-]?token|refresh[_-]?token|password)\b\s*[:=]\s*["']?(?!\$|\$\{|<|your-|your_|example|placeholder|process\.env|PROVIDER_API_KEY|ENV_VAR)([A-Za-z0-9._~+/=-]{16,})/gi,
  },
  {
    name: "local user path",
    pattern: /\/Users\/(?!alice|bob|you|username|example)[A-Za-z0-9._-]+/g,
  },
  {
    name: "payment or QR copy",
    pattern: /(?:微信支付|收款码|付款码|支付宝收款|wechat pay qr|payment qr|donation qr)/gi,
  },
];

function shouldIgnoreFile(filePath) {
  if (filePath === "scripts/privacy-scan.mjs" || filePath.endsWith("/scripts/privacy-scan.mjs")) {
    return true;
  }

  return ignoredFilePatterns.some((pattern) => pattern.test(filePath));
}

function isProbablyText(filePath, buffer) {
  const extension = path.extname(filePath);
  if (textExtensions.has(extension)) {
    return true;
  }

  if (buffer.includes(0)) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8");
  const replacementCount = [...sample].filter((char) => char === "\uFFFD").length;
  return replacementCount <= Math.max(1, sample.length * 0.01);
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath);

    if (entry.isDirectory()) {
      yield* walk(absolutePath);
      continue;
    }

    if (!entry.isFile() || shouldIgnoreFile(relativePath)) {
      continue;
    }

    yield absolutePath;
  }
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function normalizeSnippet(value) {
  return value.replace(/\s+/g, " ").slice(0, 160);
}

const findings = [];

for (const filePath of walk(root)) {
  const relativePath = path.relative(root, filePath);

  if (suspiciousAssetNamePattern.test(relativePath)) {
    findings.push({
      file: relativePath,
      line: 1,
      rule: "suspicious payment/QR asset filename",
      snippet: relativePath,
    });
  }

  const buffer = fs.readFileSync(filePath);
  if (!isProbablyText(filePath, buffer)) {
    continue;
  }

  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
      const line = lineNumberAt(text, match.index);
      const lineText = lines[line - 1] ?? "";
      if (lineText.includes("privacy-scan: allow")) {
        continue;
      }

      findings.push({
        file: relativePath,
        line,
        rule: rule.name,
        snippet: normalizeSnippet(match[0]),
      });
    }
  }
}

if (findings.length > 0) {
  console.error("Privacy scan failed. Review these findings before publishing:");
  for (const finding of findings) {
    console.error(
      `- ${finding.file}:${finding.line} [${finding.rule}] ${finding.snippet}`,
    );
  }
  process.exit(1);
}

console.log("Privacy scan passed: no publish-candidate findings.");
