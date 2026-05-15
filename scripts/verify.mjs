import { spawn } from "node:child_process";
import process from "node:process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = ["lint", "typecheck", "test:unit", "build", "test:e2e"];

function runStep(step) {
  return new Promise((resolve) => {
    const child = spawn(npmCommand, ["run", step], {
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("exit", (code) => resolve(code ?? 1));
  });
}

for (const step of steps) {
  const code = await runStep(step);
  if (code !== 0) {
    process.exit(code);
  }
}
