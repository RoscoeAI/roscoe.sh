#!/usr/bin/env node

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const summaryPath = resolve(process.cwd(), "coverage/coverage-summary.json");
const thresholdsPath = resolve(process.cwd(), ".coverage-thresholds.json");

if (!existsSync(summaryPath)) {
  console.error("Coverage summary not found. Run `npm run test:coverage` first.");
  process.exit(1);
}

if (!existsSync(thresholdsPath)) {
  console.error("Coverage thresholds file not found.");
  process.exit(1);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const thresholds = JSON.parse(readFileSync(thresholdsPath, "utf8"));
const total = summary.total;

const failures = [];

for (const key of ["lines", "statements", "functions", "branches"]) {
  const actual = total[key].pct;
  const minimum = thresholds[key];
  if (actual + Number.EPSILON < minimum) {
    failures.push(`${key}: ${actual.toFixed(2)}% < ${minimum.toFixed(2)}%`);
  }
}

if (failures.length > 0) {
  console.error("Coverage check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Coverage check passed.");
for (const key of ["lines", "statements", "functions", "branches"]) {
  console.log(`- ${key}: ${total[key].pct.toFixed(2)}% (threshold ${thresholds[key].toFixed(2)}%)`);
}
