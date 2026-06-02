import { NextResponse } from "next/server";
import { proxyToBackend } from "@/lib/backend";
import {
  SYMBOL_CODES,
  SYMBOL_DICTIONARY,
  standardLegend,
  symbolBoqMapping,
  symbolPromptGuidance,
  symbolRendererShape
} from "@/lib/symbol-dictionary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const backend = await proxyToBackend("/symbols", { method: "GET" });
  if (backend) return NextResponse.json(backend.body, { status: backend.response.status });
  return NextResponse.json({
    ok: true,
    codes: SYMBOL_CODES,
    symbols: Object.values(SYMBOL_DICTIONARY).map((item) => ({
      ...item,
      prompt_guidance: symbolPromptGuidance(item.symbol),
      boq_mapping: symbolBoqMapping(item.symbol),
      renderer_shape: symbolRendererShape(item.symbol)
    })),
    legend: standardLegend()
  });
}
