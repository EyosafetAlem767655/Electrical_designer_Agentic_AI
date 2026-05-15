"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NeonButton } from "@/components/ui/NeonButton";

export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteProject() {
    const confirmed = window.confirm(`Are you sure you want to delete "${projectName}"? This will remove the project, floors, designs, conversations, files, bot sessions, and jobs from the database.`);
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Project deletion failed");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div>
      <NeonButton variant="ghost" disabled={busy} onClick={deleteProject}>
        <Trash2 className="h-4 w-4" />
        Delete Project
      </NeonButton>
      {error ? <p className="mt-2 text-xs leading-5 text-rose-100">{error}</p> : null}
    </div>
  );
}
