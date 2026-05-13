"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getSupabaseBrowserClient, hasSupabaseBrowserEnv } from "@/lib/supabase";

export function RealtimeRefresher() {
  const router = useRouter();

  useEffect(() => {
    if (!hasSupabaseBrowserEnv()) return;

    let supabase;
    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      return;
    }

    const channel = supabase
      .channel("elec-nova-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "floors" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "designs" }, () => router.refresh())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
