import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const backendDirectory = path.join(repositoryRoot, "services", "backend");
const androidDirectory = path.join(repositoryRoot, "apps", "seller-android");
const npmCommand = "npm";
const gradleCommand = path.join(androidDirectory, "gradlew");

function platformArgs(command, args) {
  if (process.platform !== "win32") {
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

const groups = {
  backend: [
    [npmCommand, ["test", "--", "--run"], backendDirectory],
    [npmCommand, ["run", "test:types"], backendDirectory],
  ],
  android: [[gradleCommand, ["test"], androidDirectory]],
  auth: [
    [gradleCommand, ["verifyAuthPhase1Contract"], androidDirectory],
  ],
  localization: [
    [gradleCommand, ["verifyLocalizationContract"], androidDirectory],
  ],
  architecture: [
    [npmCommand, ["run", "verify:architecture"], backendDirectory],
  ],
};

const requestedGroup = process.argv[2];
const validGroups = [...Object.keys(groups), "all"];

if (!validGroups.includes(requestedGroup)) {
  console.error(`Usage: node verify.mjs <${validGroups.join("|")}>`);
  process.exit(2);
}

const selectedGroups =
  requestedGroup === "all" ? Object.keys(groups) : [requestedGroup];

for (const groupName of selectedGroups) {
  console.log(`\n[Orderak verification: ${groupName}]`);

  for (const [command, args, cwd] of groups[groupName]) {
    console.log(`> ${path.basename(command)} ${args.join(" ")}`);
    const { command: spawnCommand, args: spawnArgs } = platformArgs(command, args);
    const result = spawnSync(spawnCommand, spawnArgs, {
      cwd,
      stdio: "inherit",
      shell: false,
    });

    if (result.error) {
      console.error(result.error.message);
      process.exit(1);
    }

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

console.log("\nOrderak verification completed successfully.");
