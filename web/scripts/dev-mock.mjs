// `npm run dev:mock`: the dev server with the canned "mock" model, for trying the flow without a model.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const pkg = createRequire(import.meta.url).resolve("@react-router/dev/package.json");
const bin = path.join(path.dirname(pkg), "bin.cjs");
const child = spawn(process.execPath, [bin, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, VL_PROVIDER: "mock" },
});
child.on("exit", (code) => process.exit(code ?? 0));
