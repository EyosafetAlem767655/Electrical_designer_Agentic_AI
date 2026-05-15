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
      <fieldset className="grid gap-4 border-b border-[#c6a171]/14 pb-5">
        <legend className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-[#c9b9a6]/54">Project</legend>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["projectName", "Project name", "Nova Heights"],
            ["companyName", "Company/client name", "Client company"],
            ["architectName", "Architect full name", "Amanuel Tesfaye"],
            ["buildingAddress", "Building address", "Addis Ababa"]
          ].map(([name, label, placeholder]) => (
            <label key={name} className={name === "projectName" ? "block md:col-span-2" : "block"}>
              <span className="text-xs font-medium text-[#c9b9a6]/62">{label}</span>
              <input
                name={name}
                required={["projectName", "architectName"].includes(name)}
                placeholder={placeholder}
                className="mt-2 h-11 w-full rounded border border-[#c6a171]/20 bg-[#140f0c]/52 px-3 text-[#f7f2ea] outline-none transition placeholder:text-[#c9b9a6]/36 focus:border-[#d6b17d]/58"
              />
            </label>
          ))}
          <label className="block">
            <span className="text-xs font-medium text-[#c9b9a6]/62">Building purpose</span>
            <select name="buildingPurpose" className="mt-2 h-11 w-full rounded border border-[#c6a171]/20 bg-[#140f0c] px-3 text-[#f7f2ea] outline-none transition focus:border-[#d6b17d]/58">
              <option>Residential</option>
              <option>Commercial</option>
              <option>Mixed-use</option>
              <option>Industrial</option>
              <option>Healthcare</option>
              <option>Hospitality</option>
              <option>Education</option>
            </select>
          </label>
        </div>
      </fieldset>

      <label className="block">
        <span className="text-xs font-medium text-[#c9b9a6]/62">Admin notes</span>
        <textarea name="notes" className="mt-2 min-h-24 w-full rounded border border-[#c6a171]/20 bg-[#140f0c]/52 px-3 py-2 text-[#f7f2ea] outline-none transition placeholder:text-[#c9b9a6]/36 focus:border-[#d6b17d]/58" placeholder="Optional internal context for review" />
      </label>
      <p className="rounded border border-[#c6a171]/14 bg-white/[0.025] px-3 py-2 text-sm leading-5 text-[#efe4d4]/64">
        After creation, open the project and send the bot start link to the architect. The bot will ask for their full name and project name, then continue only if they match this record.
      </p>
      {error ? <p className="rounded border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
      <NeonButton type="submit" disabled={busy}>
        <Send className="h-4 w-4" />
        Create Project
      </NeonButton>
    </form>
  );
}
