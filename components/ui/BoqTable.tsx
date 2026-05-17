"use client";

import { FileDown } from "lucide-react";
import { useState } from "react";
import { NeonButton } from "@/components/ui/NeonButton";
import type { BoqItem, Design, Floor } from "@/types";

function safeBoqItems(design?: Design | null): BoqItem[] {
  return Array.isArray(design?.boq_items) ? design.boq_items : [];
}

export function BoqTable({ projectId, floor, design }: { projectId: string; floor?: Floor | null; design?: Design | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = safeBoqItems(design);

  async function exportBoqPdf() {
    if (!floor || !design) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pdf/boq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, floorId: floor.id, designId: design.id })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "BOQ PDF export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${floor.floor_name.replace(/[^a-z0-9]+/gi, "-")}-boq.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "BOQ PDF export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass-panel rounded p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c6a171]/14 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-[#fffaf0]">Bill Of Quantity</h2>
          <p className="text-sm text-[#efe4d4]/54">Ethiopian/EBCS and IEC/EU procurement estimate for the current floor design.</p>
        </div>
        <NeonButton variant="secondary" disabled={!design || !items.length || busy} onClick={exportBoqPdf}>
          <FileDown className="h-4 w-4" />
          Export BOQ PDF
        </NeonButton>
      </div>
      {items.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#140f0c]/52 text-xs uppercase tracking-[0.08em] text-[#c9b9a6]/62">
              <tr>
                {["Category", "Item", "Specification", "Unit", "Qty", "Standard", "Notes"].map((heading) => (
                  <th key={heading} className="whitespace-nowrap px-4 py-3 font-semibold">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#c6a171]/12">
              {items.map((item, index) => (
                <tr key={`${item.category}-${item.item}-${index}`} className="bg-white/[0.018] text-[#efe4d4]/72">
                  <td className="px-4 py-3 align-top font-semibold text-[#fffaf0]">{item.category}</td>
                  <td className="px-4 py-3 align-top">{item.item}</td>
                  <td className="min-w-64 px-4 py-3 align-top">{item.specification}</td>
                  <td className="px-4 py-3 align-top">{item.unit}</td>
                  <td className="px-4 py-3 align-top font-semibold text-[#fffaf0]">{item.quantity}</td>
                  <td className="min-w-44 px-4 py-3 align-top">{item.standard}</td>
                  <td className="min-w-56 px-4 py-3 align-top">{item.notes ?? "Site verification required"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 py-5 text-sm text-[#efe4d4]/58">BOQ will appear here after the floor design is generated or revised.</p>
      )}
      {error ? <p className="mx-5 mb-5 rounded border border-rose-300/24 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
    </section>
  );
}
