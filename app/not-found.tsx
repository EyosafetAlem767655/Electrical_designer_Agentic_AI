import Link from "next/link";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { NeonButton } from "@/components/ui/NeonButton";

export default function NotFound() {
  return (
    <GlassPanel className="mx-auto max-w-2xl text-center">
      <h1 className="tech-font text-4xl font-semibold text-white">Record Not Found</h1>
      <p className="mt-3 text-cyan-50/65">The requested project or floor could not be found.</p>
      <Link href="/" className="mt-6 inline-block">
        <NeonButton>Return Home</NeonButton>
      </Link>
    </GlassPanel>
  );
}
