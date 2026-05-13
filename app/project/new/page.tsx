import { GlassPanel } from "@/components/ui/GlassPanel";
import { NewProjectForm } from "@/components/ui/NewProjectForm";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <section className="border-b border-[#c6a171]/14 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c9b9a6]/54">Project Intake</p>
        <h1 className="mt-2 text-3xl font-semibold text-[#fffaf0]">Create Project Assignment</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#efe4d4]/66">
          Creating a project stores the admin metadata and, when a Telegram group ID is provided, messages the architect in that group to start DM verification with the bot.
        </p>
      </section>
      <div className="grid gap-5 lg:grid-cols-[310px_1fr]">
        <GlassPanel className="h-fit">
          <p className="text-lg font-semibold text-[#fffaf0]">Before You Submit</p>
          <div className="mt-4 space-y-3 text-sm leading-5 text-[#efe4d4]/64">
            <p>1. Confirm the architect Telegram username is correct.</p>
            <p>2. Use the group chat ID where the bot should announce the assignment.</p>
            <p>3. The architect will still verify by project name in DM.</p>
          </div>
          <div className="mt-5 rounded border border-[#b26457]/28 bg-[#7c3f35]/12 p-3 text-sm text-[#f6dfd9]/82">
            No admin authentication is enabled in this v1 prototype. Keep the deployment private until auth is added.
          </div>
        </GlassPanel>
        <GlassPanel>
          <NewProjectForm />
        </GlassPanel>
      </div>
    </div>
  );
}
