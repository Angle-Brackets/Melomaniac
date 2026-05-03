import { readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";

// Parse .env without any dependencies
const envVars = {};
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx > 0) envVars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
} catch {}

const teamId = envVars.APPLE_TEAM_ID ?? process.env.APPLE_TEAM_ID;
if (!teamId) {
  console.error("Error: APPLE_TEAM_ID not set. Add it to .env");
  process.exit(1);
}

const confPath = "src-tauri/tauri.conf.json";
const original = readFileSync(confPath, "utf8");
const conf = JSON.parse(original);
conf.bundle.iOS.developmentTeam = teamId;
writeFileSync(confPath, JSON.stringify(conf, null, 2));

try {
  const { status } = spawnSync("npx", ["tauri", "ios", "dev"], {
    stdio: "inherit",
    shell: true,
  });
  process.exit(status ?? 0);
} finally {
  writeFileSync(confPath, original);
}
