import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const targets = ["app.js", ...readdirSync("lib").filter((name) => name.endsWith(".js")).map((name) => `lib/${name}`)];
for (const target of targets) {
  const result = spawnSync(process.execPath, ["--check", target], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}