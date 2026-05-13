import { GlassPanel } from "@/components/ui/GlassPanel";

export default function Loading() {
  return (
    <GlassPanel className="grid min-h-96 place-items-center">
      <p className="mono-font text-sm text-cyan-100/60">Loading command center...</p>
    </GlassPanel>
  );
}
