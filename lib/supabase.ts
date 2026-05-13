import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv, requireEnv } from "@/lib/env";

let adminClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

export function hasSupabaseServerEnv() {
  return Boolean(getEnv("SUPABASE_URL") && (getEnv("SUPABASE_SERVICE_ROLE_KEY") || getEnv("SUPABASE_ANON_KEY")));
}

export function hasSupabaseBrowserEnv() {
  return Boolean(getEnv("NEXT_PUBLIC_SUPABASE_URL") && getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
}

export function getSupabaseAdmin() {
  if (!adminClient) {
    const url = requireEnv("SUPABASE_URL");
    const key = getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? requireEnv("SUPABASE_ANON_KEY");
    adminClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  return adminClient;
}

export function getSupabaseBrowserClient() {
  if (!publicClient) {
    const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const key = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    publicClient = createClient(url, key);
  }

  return publicClient;
}

export function getPublicSupabaseConfig() {
  return {
    url: getEnv("NEXT_PUBLIC_SUPABASE_URL") ?? "",
    anonKey: getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? ""
  };
}
