import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type RentalAnalyticsReport = {
  rental_count: number;
  item_count: number;
  revenue: number;
  average_duration_minutes: number;
  busiest_weekday: string;
  stockout_days: number;
  stockout_minutes: number;
  paid_rental_count: number;
  free_rental_count: number;
  unclassified_rental_count: number;
  busiest_days: { local_date: string; rental_count: number; item_count: number; revenue: number }[];
  weekdays: { weekday_number: number; weekday: string; rental_count: number }[];
  kiosks: { id: string; name: string; rental_count: number; revenue: number }[];
  asset_types: { asset_type: string; item_count: number }[];
  stockouts: { id: string; kiosk_name: string; started_at: string; ended_at?: string; rented_count: number; out_of_service_count: number; cause: string; duration_minutes: number }[];
};

const yellow: [number, number, number] = [232, 163, 40];
const dark: [number, number, number] = [53, 54, 53];
const grey: [number, number, number] = [112, 112, 112];
const light: [number, number, number] = [246, 246, 244];
const money = (value: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(value || 0));
const date = (value: string) => new Intl.DateTimeFormat("pt-PT").format(new Date(`${value}T12:00:00`));
const dateTime = (value?: string) => value
  ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon" }).format(new Date(value))
  : "Em curso";
const duration = (raw: number) => {
  const minutes = Math.max(0, Math.round(Number(raw || 0)));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return `${hours} h${remainder ? ` ${remainder} min` : ""}`;
};
const assetNames: Record<string, string> = {
  electric: "Bicicletas elétricas", conventional: "Bicicletas convencionais",
  child: "Bicicletas infantis", helmet: "Capacetes", lock: "Cadeados", stroller: "Carrinhos de bebé",
};

async function imageData(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

function periodLabel(from: string, to: string) {
  if (!from && !to) return "Todo o histórico disponível";
  if (from && to) return `${date(from)} a ${date(to)}`;
  if (from) return `Desde ${date(from)}`;
  return `Até ${date(to)}`;
}

function filename(from: string, to: string) {
  const start = from || "inicio", end = to || new Date().toISOString().slice(0, 10);
  return `Relatorio_Alugueres_${start}_a_${end}.pdf`;
}

function horizontalBars(doc: jsPDF, title: string, rows: { label: string; value: number }[], x: number, y: number, width: number) {
  doc.setTextColor(...dark).setFontSize(12).setFont("helvetica", "bold").text(title, x, y);
  const visible = rows.slice(0, 8), max = Math.max(1, ...visible.map((row) => row.value));
  visible.forEach((row, index) => {
    const rowY = y + 9 + index * 9;
    doc.setFontSize(8).setFont("helvetica", "normal").setTextColor(...dark);
    doc.text(row.label.slice(0, 27), x, rowY);
    doc.setFillColor(232, 232, 229).roundedRect(x + 48, rowY - 4, width - 60, 4, 1, 1, "F");
    doc.setFillColor(...yellow).roundedRect(x + 48, rowY - 4, Math.max(1, (width - 60) * row.value / max), 4, 1, 1, "F");
    doc.setFont("helvetica", "bold").text(String(row.value), x + width, rowY, { align: "right" });
  });
}

export function createRentalAnalyticsPdf(report: RentalAnalyticsReport, from: string, to: string, logo?: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const generated = new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon" }).format(new Date());

  doc.setTextColor(...dark).setFont("helvetica", "bold").setFontSize(20).text("Relatório de alugueres", 14, 38);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...grey).text(`Período: ${periodLabel(from, to)}`, 14, 45);
  doc.text(`Emitido em ${generated}`, 196, 45, { align: "right" });

  const cards = [
    ["Alugueres", String(report.rental_count)], ["Itens alugados", String(report.item_count)],
    ["Receita Multibanco", money(report.revenue)], ["Duração média", duration(report.average_duration_minutes)],
    ["Dia com maior procura", report.busiest_weekday || "—"], ["Dias sem bicicletas", String(report.stockout_days)],
  ];
  cards.forEach(([label, value], index) => {
    const col = index % 3, row = Math.floor(index / 3), x = 14 + col * 62, y = 54 + row * 29;
    doc.setFillColor(...light).setDrawColor(225, 225, 221).roundedRect(x, y, 57, 23, 2, 2, "FD");
    doc.setFillColor(...yellow).rect(x, y, 2, 23, "F");
    doc.setTextColor(...grey).setFont("helvetica", "normal").setFontSize(8).text(label, x + 6, y + 7);
    doc.setTextColor(...dark).setFont("helvetica", "bold").setFontSize(value.length > 22 ? 10 : 14).text(value, x + 6, y + 17, { maxWidth: 48 });
  });

  autoTable(doc, {
    startY: 117,
    head: [["Modalidade", "Alugueres", "Leitura"]],
    body: [
      ["Pagos", report.paid_rental_count, "Valor superior a 0,00 €"],
      ["Gratuitos", report.free_rental_count, "Registados expressamente como gratuitos"],
      ["Histórico sem classificação", report.unclassified_rental_count, "Criados antes da recolha do valor"],
    ],
    theme: "grid", margin: { left: 14, right: 14, top: 28, bottom: 18 },
    headStyles: { fillColor: dark, textColor: 255 }, alternateRowStyles: { fillColor: light },
    styles: { font: "helvetica", fontSize: 9, cellPadding: 3 },
  });
  const demandY = ((doc as any).lastAutoTable?.finalY || 150) + 10;
  doc.setTextColor(...dark).setFont("helvetica", "bold").setFontSize(12).text("Dias com maior procura", 14, demandY);
  autoTable(doc, {
    startY: demandY + 4,
    head: [["Data", "Alugueres", "Itens", "Receita"]],
    body: report.busiest_days.slice(0, 10).map((day) => [date(day.local_date), day.rental_count, day.item_count, money(day.revenue)]),
    theme: "striped", margin: { left: 14, right: 14, top: 28, bottom: 18 },
    headStyles: { fillColor: yellow, textColor: dark }, alternateRowStyles: { fillColor: light },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.5 },
  });

  doc.addPage();
  horizontalBars(doc, "Procura por dia da semana", report.weekdays.map((item) => ({ label: item.weekday, value: item.rental_count })), 14, 38, 82);
  horizontalBars(doc, "Procura por quiosque", report.kiosks.map((item) => ({ label: item.name, value: item.rental_count })), 108, 38, 88);
  doc.setTextColor(...dark).setFont("helvetica", "bold").setFontSize(12).text("Distribuição operacional", 14, 127);
  autoTable(doc, {
    startY: 132,
    head: [["Área", "Alugueres/itens", "Receita"]],
    body: [
      ...report.kiosks.map((item) => [item.name, item.rental_count, money(item.revenue)]),
      ...report.asset_types.map((item) => [assetNames[item.asset_type] || item.asset_type, item.item_count, "—"]),
    ],
    theme: "striped", margin: { left: 14, right: 14, top: 28, bottom: 18 },
    headStyles: { fillColor: dark, textColor: 255 }, alternateRowStyles: { fillColor: light },
    styles: { font: "helvetica", fontSize: 9, cellPadding: 3 },
  });

  doc.addPage();
  doc.setTextColor(...dark).setFont("helvetica", "bold").setFontSize(16).text("Períodos sem bicicletas disponíveis", 14, 38);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...grey);
  doc.text(`Total no período: ${report.stockout_days} dia(s) e ${duration(report.stockout_minutes)} sem disponibilidade.`, 14, 45);
  autoTable(doc, {
    startY: 52,
    head: [["Quiosque", "Início", "Fim", "Duração", "Alugadas", "Fora serviço", "Causa"]],
    body: report.stockouts.length
      ? report.stockouts.map((item) => [item.kiosk_name, dateTime(item.started_at), dateTime(item.ended_at), duration(item.duration_minutes), item.rented_count, item.out_of_service_count, item.cause])
      : [["Sem ocorrências no período", "—", "—", "—", "—", "—", "—"]],
    theme: "grid", margin: { left: 10, right: 10, top: 28, bottom: 18 },
    headStyles: { fillColor: yellow, textColor: dark }, alternateRowStyles: { fillColor: light },
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2 },
  });
  const noteY = Math.min(273, ((doc as any).lastAutoTable?.finalY || 70) + 10);
  doc.setFont("helvetica", "italic").setFontSize(8).setTextColor(...grey);
  doc.text("Nota: os períodos sem disponibilidade são registados automaticamente desde a instalação desta funcionalidade.", 14, noteY, { maxWidth: 180 });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    if (logo) {
      try { doc.addImage(logo, "PNG", 14, 7, 39, 13, undefined, "FAST"); }
      catch { doc.setTextColor(...dark).setFont("helvetica", "bold").setFontSize(13).text("PARQUES TEJO", 14, 16); }
    } else {
      doc.setTextColor(...dark).setFont("helvetica", "bold").setFontSize(13).text("PARQUES TEJO", 14, 16);
    }
    doc.setDrawColor(...yellow).setLineWidth(1.2).line(14, 24, 196, 24);
    doc.setDrawColor(220, 220, 217).setLineWidth(0.3).line(14, 282, 196, 282);
    doc.setTextColor(...grey).setFont("helvetica", "normal").setFontSize(7.5);
    doc.text("Gestão da Frota de Bicicletas", 14, 288);
    doc.text(`Página ${page} de ${pages}`, 196, 288, { align: "right" });
  }
  return doc;
}

export async function exportRentalAnalyticsPdf(report: RentalAnalyticsReport, from: string, to: string) {
  const logo = await imageData("/parques-tejo-logo.png");
  createRentalAnalyticsPdf(report, from, to, logo).save(filename(from, to));
}
