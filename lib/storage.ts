import { STORAGE_BUCKET } from "@/lib/constants";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function uploadProjectFile(path: string, buffer: Buffer, contentType: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, buffer, {
    contentType,
    upsert: true
  });
  if (error) throw error;

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function fetchStorageBase64(path: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

export async function uploadRemoteImage(path: string, url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Remote image download failed: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return uploadProjectFile(path, buffer, response.headers.get("content-type") ?? "image/png");
}
