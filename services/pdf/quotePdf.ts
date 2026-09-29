import PDFDocument from "pdfkit";
import { formatMoney, toNumber } from "@/utils/money";

export interface QuotePdfData {
  business: {
    name: string;
    tradingName?: string | null;
    registrationNumber?: string | null;
    vatNumber?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    currencySymbol: string;
    paymentDetails?: string | null;
    termsAndConditions?: string | null;
  };
  logo?: Buffer | null;
  /** Diagonal watermark text, e.g. "DRAFT" for unapproved previews. */
  watermark?: string;
  quote: {
    quoteNumber: string;
    createdAt: Date;
    validUntil?: Date | null;
    notes?: string | null;
    subtotal: unknown;
    labourTotal: unknown;
    discount: unknown;
    vat: unknown;
    total: unknown;
    vatRate: unknown;
    pricesIncludeVat: boolean;
  };
  customer: { name?: string | null; phone: string; email?: string | null };
  vehicle?: {
    make?: string | null;
    model?: string | null;
    year?: number | null;
    variant?: string | null;
    engine?: string | null;
    engineSize?: string | null;
    registrationNumber?: string | null;
    vin?: string | null;
  } | null;
  items: {
    description: string;
    sku?: string | null;
    partNumber?: string | null;
    quantity: unknown;
    unitPrice: unknown;
    discount: unknown;
    total: unknown;
  }[];
  labour: { description: string; hours: unknown; unitPrice: unknown; total: unknown }[];
}

const COLORS = {
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  accent: "#ea580c",
  panel: "#f8fafc",
  headerBg: "#0f172a",
  zebra: "#f8fafc",
};

const M = 40;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - M * 2;

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "-";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function qtyText(q: unknown): string {
  const n = toNumber(q as never);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export function buildQuotePdf(data: QuotePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: M,
      bufferPages: true,
      info: {
        Title: `Quotation ${data.quote.quoteNumber}`,
        Author: data.business.tradingName || data.business.name,
        Subject: "Vehicle parts & labour quotation",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      render(doc, data);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function render(doc: PDFKit.PDFDocument, data: QuotePdfData) {
  const sym = data.business.currencySymbol || "R";
  const money = (v: unknown) => formatMoney(v as never, sym);
  const displayName = data.business.tradingName || data.business.name;

  // ---- Top accent -------------------------------------------------------
  doc.rect(0, 0, PAGE_W, 10).fill(COLORS.ink);
  doc.rect(0, 10, PAGE_W, 3).fill(COLORS.accent);

  // ---- Header: logo/name left, quote meta right ---------------------------
  let y = 34;
  let logoDrawn = false;
  if (data.logo) {
    try {
      doc.image(data.logo, M, y, { fit: [150, 60] });
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }
  if (!logoDrawn) {
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(20).text(displayName, M, y + 6, { width: 280 });
  }

  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(26).text("QUOTATION", M, y, { width: CONTENT_W, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted);
  const metaX = PAGE_W - M - 190;
  const meta: [string, string][] = [
    ["Quote no.", data.quote.quoteNumber],
    ["Date", fmtDate(data.quote.createdAt)],
    ["Valid until", fmtDate(data.quote.validUntil)],
  ];
  let my = y + 36;
  for (const [k, v] of meta) {
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text(k, metaX, my, { width: 70 });
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10).text(v, metaX + 70, my - 1, { width: 120, align: "right" });
    my += 15;
  }

  // Business details
  y = Math.max(y + 68, my + 6);
  const bizLines = [
    logoDrawn ? displayName : null,
    data.business.tradingName && data.business.name !== data.business.tradingName ? data.business.name : null,
    data.business.address,
    [data.business.phone && `Tel: ${data.business.phone}`, data.business.email].filter(Boolean).join("   |   ") || null,
    [data.business.vatNumber && `VAT No: ${data.business.vatNumber}`, data.business.registrationNumber && `Reg No: ${data.business.registrationNumber}`]
      .filter(Boolean)
      .join("   |   ") || null,
  ].filter((l): l is string => !!l);
  doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9);
  bizLines.forEach((line, i) => {
    doc.font(i === 0 && logoDrawn ? "Helvetica-Bold" : "Helvetica").fillColor(i === 0 && logoDrawn ? COLORS.ink : COLORS.muted);
    doc.text(line, M, y, { width: 300 });
    y = doc.y + 1;
  });

  y += 12;
  doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(0.75).strokeColor(COLORS.line).stroke();
  y += 14;

  // ---- Customer / Vehicle panels --------------------------------------------
  const colW = (CONTENT_W - 16) / 2;
  const v = data.vehicle;
  const vehicleTitle = v ? [v.year, v.make, v.model].filter(Boolean).join(" ") : "";
  const customerRows: [string, string][] = [
    ["Name", data.customer.name || "-"],
    ["Phone", data.customer.phone ? `+${data.customer.phone.replace(/^\+/, "")}` : "-"],
    ["Email", data.customer.email || "-"],
  ];
  const vehicleRows: [string, string][] = v
    ? [
        ["Vehicle", vehicleTitle || "-"],
        ["Variant / Engine", [v.variant, v.engine ?? v.engineSize].filter(Boolean).join(" - ") || "-"],
        ["Registration", v.registrationNumber || "-"],
        ["VIN", v.vin || "-"],
      ]
    : [["Vehicle", "Not specified"]];

  const panelH = 22 + Math.max(customerRows.length, vehicleRows.length) * 16 + 10;
  const drawPanel = (x: number, title: string, rows: [string, string][]) => {
    doc.roundedRect(x, y, colW, panelH, 4).fillColor(COLORS.panel).fill();
    doc.fillColor(COLORS.accent).font("Helvetica-Bold").fontSize(8).text(title, x + 12, y + 10, { characterSpacing: 1 });
    let ry = y + 26;
    for (const [k, val] of rows) {
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(k, x + 12, ry, { width: 78 });
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(val, x + 92, ry - 0.5, { width: colW - 104, lineBreak: false, ellipsis: true });
      ry += 16;
    }
  };
  drawPanel(M, "CUSTOMER", customerRows);
  drawPanel(M + colW + 16, "VEHICLE", vehicleRows);
  y += panelH + 20;

  // ---- Tables -------------------------------------------------------------------
  type Col = { label: string; w: number; align: "left" | "right" | "center" };
  const drawTable = (title: string, cols: Col[], rows: string[][], subs: (string | null)[]) => {
    const need = 60;
    if (y + need > PAGE_H - 90) {
      doc.addPage();
      y = M;
    }
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(11).text(title, M, y);
    y += 18;

    const header = () => {
      doc.rect(M, y, CONTENT_W, 22).fill(COLORS.headerBg);
      let x = M;
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5);
      for (const c of cols) {
        doc.text(c.label.toUpperCase(), x + 8, y + 7, { width: c.w - 16, align: c.align, characterSpacing: 0.5 });
        x += c.w;
      }
      y += 22;
    };
    header();

    rows.forEach((row, i) => {
      doc.font("Helvetica").fontSize(9);
      const heights = row.map((cell, ci) =>
        doc.heightOfString(cell, { width: cols[ci].w - 16 }) + (ci === 0 && subs[i] ? 11 : 0),
      );
      const rowH = Math.max(...heights) + 14;
      if (y + rowH > PAGE_H - 80) {
        doc.addPage();
        y = M;
        header();
      }
      if (i % 2 === 1) doc.rect(M, y, CONTENT_W, rowH).fill(COLORS.zebra);
      let x = M;
      row.forEach((cell, ci) => {
        const bold = ci === row.length - 1;
        doc.fillColor(COLORS.ink).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
        doc.text(cell, x + 8, y + 7, { width: cols[ci].w - 16, align: cols[ci].align });
        if (ci === 0 && subs[i]) {
          doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.5).text(subs[i]!, x + 8, y + 7 + heights[0] - 11 + 1, { width: cols[ci].w - 16 });
        }
        x += cols[ci].w;
      });
      y += rowH;
      doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(0.5).strokeColor(COLORS.line).stroke();
    });
    y += 16;
  };

  if (data.items.length > 0) {
    drawTable(
      "Parts",
      [
        { label: "Description", w: 205, align: "left" },
        { label: "Part No", w: 100, align: "left" },
        { label: "Qty", w: 40, align: "center" },
        { label: "Unit Price", w: 80, align: "right" },
        { label: "Total", w: CONTENT_W - 425, align: "right" },
      ],
      data.items.map((it) => {
        const disc = toNumber(it.discount as never);
        return [
          it.description + (disc > 0 ? `\nDiscount: -${money(disc)}` : ""),
          it.partNumber || "-",
          qtyText(it.quantity),
          money(it.unitPrice),
          money(it.total),
        ];
      }),
      data.items.map((it) => (it.sku ? `SKU: ${it.sku}` : null)),
    );
  }

  if (data.labour.length > 0) {
    drawTable(
      "Labour",
      [
        { label: "Description", w: 285, align: "left" },
        { label: "Hours", w: 60, align: "center" },
        { label: "Rate", w: 80, align: "right" },
        { label: "Total", w: CONTENT_W - 425, align: "right" },
      ],
      data.labour.map((l) => [l.description, qtyText(l.hours), money(l.unitPrice), money(l.total)]),
      data.labour.map(() => null),
    );
  }

  // ---- Totals ---------------------------------------------------------------------
  const q = data.quote;
  const vatRateTxt = `${toNumber(q.vatRate as never)}%`;
  const totalsRows: [string, string, boolean?][] = [];
  if (data.items.length > 0) totalsRows.push(["Parts subtotal", money(q.subtotal)]);
  if (data.labour.length > 0) totalsRows.push(["Labour", money(q.labourTotal)]);
  if (toNumber(q.discount as never) > 0) totalsRows.push(["Discount", `-${money(q.discount)}`]);
  if (!q.pricesIncludeVat) totalsRows.push([`VAT (${vatRateTxt})`, money(q.vat)]);

  const boxW = 240;
  const boxX = PAGE_W - M - boxW;
  const totalsH = totalsRows.length * 20 + 44 + (q.pricesIncludeVat ? 16 : 0);
  if (y + totalsH > PAGE_H - 80) {
    doc.addPage();
    y = M;
  }
  let ty = y;
  for (const [k, val] of totalsRows) {
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9.5).text(k, boxX, ty, { width: 120 });
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9.5).text(val, boxX + 120, ty, { width: boxW - 8, align: "right" });
    ty += 20;
  }
  doc.roundedRect(boxX - 8, ty - 2, boxW + 8, 32, 4).fill(COLORS.ink);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11).text("TOTAL", boxX + 4, ty + 9, { width: 100 });
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(14).text(money(q.total), boxX, ty + 7, { width: boxW - 8, align: "right" });
  ty += 38;
  if (q.pricesIncludeVat) {
    doc.fillColor(COLORS.muted).font("Helvetica-Oblique").fontSize(8.5).text(`Total includes VAT of ${money(q.vat)} (${vatRateTxt})`, boxX - 8, ty, { width: boxW + 8, align: "right" });
    ty += 16;
  }
  y = ty + 14;

  // ---- Notes / payment / terms ----------------------------------------------------
  const textBlock = (title: string, body: string | null | undefined) => {
    if (!body?.trim()) return;
    doc.font("Helvetica").fontSize(8.5);
    const h = doc.heightOfString(body, { width: CONTENT_W }) + 24;
    if (y + h > PAGE_H - 70) {
      doc.addPage();
      y = M;
    }
    doc.fillColor(COLORS.accent).font("Helvetica-Bold").fontSize(8).text(title.toUpperCase(), M, y, { characterSpacing: 1 });
    y += 13;
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5).text(body.trim(), M, y, { width: CONTENT_W, lineGap: 1.5 });
    y = doc.y + 14;
  };
  textBlock("Notes", q.notes);
  textBlock("Payment details", data.business.paymentDetails);
  textBlock("Terms & conditions", data.business.termsAndConditions);

  // ---- Footer on every page -----------------------------------------------------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Reset margins so the footer text does not trigger an automatic page break.
    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(M, PAGE_H - 46).lineTo(PAGE_W - M, PAGE_H - 46).lineWidth(0.5).strokeColor(COLORS.line).stroke();
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8);
    doc.text(`${displayName}  |  Quotation ${q.quoteNumber}`, M, PAGE_H - 36, { width: CONTENT_W / 2, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, M + CONTENT_W / 2, PAGE_H - 36, { width: CONTENT_W / 2, align: "right", lineBreak: false });
    doc.page.margins.bottom = prevBottom;

    if (data.watermark) {
      doc.save();
      doc.rotate(-35, { origin: [PAGE_W / 2, PAGE_H / 2] });
      doc.fillColor("#94a3b8").fillOpacity(0.14).font("Helvetica-Bold").fontSize(120);
      doc.text(data.watermark, 0, PAGE_H / 2 - 60, { width: PAGE_W, align: "center", lineBreak: false });
      doc.restore();
    }
  }
}
