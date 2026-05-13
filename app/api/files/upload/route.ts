import { NextResponse } from "next/server";
import { uploadProjectFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const projectId = String(formData.get("projectId") ?? "");
    const floorId = String(formData.get("floorId") ?? "");
    const fileType = String(formData.get("fileType") ?? "architectural_pdf");
    if (!(file instanceof File) || !projectId) {
      return NextResponse.json({ ok: false, error: "file and projectId are required" }, { status: 400 });
    }

    const extension = file.name.split(".").pop() ?? "bin";
    const path = `projects/${projectId}${floorId ? `/floors/${floorId}` : ""}/${Date.now()}-${fileType}.${extension}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const publicUrl = await uploadProjectFile(path, buffer, file.type || "application/octet-stream");
    return NextResponse.json({ ok: true, path, publicUrl });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }
}
