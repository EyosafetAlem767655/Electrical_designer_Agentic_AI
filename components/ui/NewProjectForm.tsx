"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Send } from "lucide-react";
import { NeonButton } from "@/components/ui/NeonButton";

export function NewProjectForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(result.error ?? "Project creation failed");
      return;
    }
    router.push(`/project/${result.project.id}`);
  }

  return (
    <form action={submit} className="grid gap-4">
      {[
        ["projectName", "Project name", "Nova Heights"],
        ["architectName", "Architect name", "Amanuel Tesfaye"],
        ["architectTelegramUsername", "Telegram username", "@architect"],
        ["companyName", "Company/client name", "Client company"],
        ["buildingAddress", "Building address", "Addis Ababa"],
        ["groupChatId", "Telegram group chat ID", "-1001234567890"]
      ].map(([name, label, placeholder]) => (
        <label key={name} className="block">
          <span className="mono-font text-xs text-cyan-100/62">{label}</span>
          <input
            name={name}
            required={["projectName", "architectName", "architectTelegramUsername"].includes(name)}
            placeholder={placeholder}
            className="mt-2 h-11 w-full rounded border border-cyan-300/18 bg-black/28 px-3 text-white outline-none transition placeholder:text-cyan-100/28 focus:border-cyan-200/60"
          />
        </label>
      ))}
      <label className="block">
        <span className="mono-font text-xs text-cyan-100/62">Building purpose</span>
        <select name="buildingPurpose" className="mt-2 h-11 w-full rounded border border-cyan-300/18 bg-[#071018] px-3 text-white outline-none transition focus:border-cyan-200/60">
          <option>Residential</option>
          <option>Commercial</option>
          <option>Mixed-use</option>
          <option>Industrial</option>
          <option>Healthcare</option>
          <option>Hospitality</option>
          <option>Education</option>
        </select>
      </label>
      <label className="block">
        <span className="mono-font text-xs text-cyan-100/62">Notes</span>
        <textarea name="notes" className="mt-2 min-h-24 w-full rounded border border-cyan-300/18 bg-black/28 px-3 py-2 text-white outline-none transition placeholder:text-cyan-100/28 focus:border-cyan-200/60" placeholder="Optional admin notes" />
      </label>
      {error ? <p className="rounded border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
      <NeonButton type="submit" disabled={busy}>
        <Send className="h-4 w-4" />
        Create Project + Message Architect
      </NeonButton>
    </form>
  );
}
