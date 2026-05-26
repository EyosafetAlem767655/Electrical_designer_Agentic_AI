import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { planBoqItems, planSymbolLegend, type PlanSpec } from "@/lib/plan-schema";
import { standardLegend } from "@/lib/symbol-dictionary";
import type { BoqItem, Floor, Project, SymbolLegendItem } from "@/types";

type RenderInput = {
  sourceImageUrl: string;
  project: Pick<Project, "project_name" | "building_purpose" | "special_requirements">;
  floor: Pick<Floor, "floor_name" | "floor_number" | "architect_answers">;
  version: number;
  spec: PlanSpec;
};

export type RenderedSchematic = {
  buffer: Buffer;
  debugBuffer: Buffer;
  planSpec: PlanSpec;
  symbolLegend: SymbolLegendItem[];
  boqItems: BoqItem[];
};

function parseDataUrl(value: string) {
  const match = value.match(/^data:.*?;base64,(.*)$/);
  return match ? Buffer.from(match[1], "base64") : null;
}

async function imageBufferFromSource(source: string) {
  const dataUrl = parseDataUrl(source);
  if (dataUrl) return dataUrl;
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Could not load floor-plan image for deterministic render: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return Buffer.from(source, "base64");
}

function pythonCommands() {
  const configured = process.env.PYTHON_RENDERER_COMMAND?.trim();
  if (configured) return [configured];
  return process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
}

function runPythonCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with exit ${code}: ${stderr.trim()}`));
    });
  });
}

async function runPythonRenderer(args: string[]) {
  const errors: string[] = [];
  for (const command of pythonCommands()) {
    try {
      await runPythonCommand(command, args);
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`Python plan renderer could not start. Tried ${pythonCommands().join(", ")}. Errors: ${errors.join(" | ")}`);
}

export function programmaticLegend(): SymbolLegendItem[] {
  return standardLegend();
}

export function programmaticBoq(spec?: PlanSpec): BoqItem[] {
  return spec ? planBoqItems(spec) : [];
}

export async function renderProgrammaticElectricalSchematic(input: RenderInput): Promise<RenderedSchematic> {
  const tempDir = await mkdtemp(join(tmpdir(), "elec-plan-render-"));
  const basePath = join(tempDir, "base-plan.png");
  const specPath = join(tempDir, "plan-spec.json");
  const pngPath = join(tempDir, "revised_plan.png");
  const debugPath = join(tempDir, "debug_overlay.png");
  try {
    await writeFile(basePath, await imageBufferFromSource(input.sourceImageUrl));
    await writeFile(
      specPath,
      JSON.stringify(
        {
          spec: input.spec,
          meta: {
            project_name: input.project.project_name,
            floor_name: input.floor.floor_name,
            version: input.version
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await runPythonRenderer(["scripts/render_plan.py", specPath, basePath, pngPath, debugPath]);
    return {
      buffer: await readFile(pngPath),
      debugBuffer: await readFile(debugPath),
      planSpec: input.spec,
      symbolLegend: planSymbolLegend(input.spec),
      boqItems: planBoqItems(input.spec)
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
