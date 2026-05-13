import { GlassPanel } from "@/components/ui/GlassPanel";
import { NewProjectForm } from "@/components/ui/NewProjectForm";

export default function NewProjectPage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <GlassPanel className="h-fit">
        <p className="mono-font text-sm uppercase text-cyan-100/62">Project Intake</p>
        <h1 className="tech-font mt-3 text-4xl font-semibold text-white">Create Assignment</h1>
        <p className="mt-4 text-cyan-50/66">
          Creating a project stores the admin metadata and, when a Telegram group ID is provided, messages the architect in that group to start DM verification with the bot.
        </p>
        <div className="mt-6 rounded border border-rose-300/25 bg-rose-500/8 p-3 text-sm text-rose-50/80">
          No admin authentication is enabled in this v1 prototype. Keep the deployment private until auth is added.
        </div>
      </GlassPanel>
      <GlassPanel>
        <NewProjectForm />
      </GlassPanel>
    </div>
  );
}
