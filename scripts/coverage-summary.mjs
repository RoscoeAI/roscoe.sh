#!/usr/bin/env node

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const summaryPath = resolve(process.cwd(), "coverage/coverage-summary.json");

if (!existsSync(summaryPath)) {
  console.error("Coverage summary not found. Run `npm run test:coverage` first.");
  process.exit(1);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const total = summary.total;

function formatMetric(metric) {
  return `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total})`;
}

const files = Object.entries(summary)
  .filter(([key]) => key !== "total")
  .map(([file, metrics]) => ({
    file,
    metrics,
    lowestPct: Math.min(
      metrics.lines.pct,
      metrics.statements.pct,
      metrics.functions.pct,
      metrics.branches.pct,
    ),
  }))
  .sort((a, b) => a.lowestPct - b.lowestPct);

console.log("Coverage Totals");
console.log(`- Lines: ${formatMetric(total.lines)}`);
console.log(`- Statements: ${formatMetric(total.statements)}`);
console.log(`- Functions: ${formatMetric(total.functions)}`);
console.log(`- Branches: ${formatMetric(total.branches)}`);
console.log("");
console.log("Lowest Coverage Files");

for (const entry of files.slice(0, 12)) {
  const shortFile = entry.file.replace(`${process.cwd()}/`, "");
  console.log(
    `- ${shortFile}: lines ${entry.metrics.lines.pct.toFixed(2)}%, statements ${entry.metrics.statements.pct.toFixed(2)}%, functions ${entry.metrics.functions.pct.toFixed(2)}%, branches ${entry.metrics.branches.pct.toFixed(2)}%`,
  );
}
