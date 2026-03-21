import { resolve } from "path";
import { initProject } from "../../config/loader";

export function initCommand(opts: { projectDir: string }) {
  const root = resolve(opts.projectDir);
  const result = initProject(root);
  console.log(result);
}
