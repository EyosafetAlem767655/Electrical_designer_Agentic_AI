import { jsPDF } from "jspdf";
import { describe, expect, it } from "vitest";
import { convertPdfToPngPages } from "@/lib/pdf-utils";

describe("PDF utilities", () => {
  it("converts the first PDF page to a PNG buffer in Node", async () => {
    const doc = new jsPDF();
    doc.text("Elec Nova Tech test floor plan", 20, 20);
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

    const pages = await convertPdfToPngPages(pdfBuffer);

    expect(pages).toHaveLength(1);
    expect(pages[0].subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});
