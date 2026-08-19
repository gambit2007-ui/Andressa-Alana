import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { CashTransaction } from '../types';
import type { ProfessionalFinanceSummary, ProfessionalMonthMetrics } from './professionalFinance';
import { formatCurrency, formatMonthLabel } from '../utils/formatters';

const navy = rgb(0.035, 0.12, 0.24);
const gold = rgb(0.79, 0.61, 0.26);
const slate = rgb(0.31, 0.38, 0.48);
const green = rgb(0.03, 0.55, 0.38);
const red = rgb(0.78, 0.12, 0.16);

const cleanPdfText = (value: string) => value.replace(/[\u2013\u2014]/g, '-');

const addReportHeader = (
  page: ReturnType<PDFDocument['addPage']>,
  bold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  regular: Awaited<ReturnType<PDFDocument['embedFont']>>,
  title: string,
  subtitle: string,
) => {
  page.drawRectangle({ x: 0, y: 770, width: 595, height: 72, color: navy });
  page.drawText('VANTAGE IPHONES', { x: 40, y: 810, size: 9, font: bold, color: gold });
  page.drawText(cleanPdfText(title), { x: 40, y: 785, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText(cleanPdfText(subtitle), { x: 40, y: 754, size: 9, font: regular, color: slate });
};

const drawMetric = (
  page: ReturnType<PDFDocument['addPage']>,
  bold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  regular: Awaited<ReturnType<PDFDocument['embedFont']>>,
  x: number,
  y: number,
  label: string,
  value: string,
  tone = navy,
) => {
  page.drawRectangle({ x, y, width: 160, height: 54, color: rgb(0.96, 0.97, 0.985), borderColor: rgb(0.86, 0.88, 0.92), borderWidth: 0.6 });
  page.drawText(cleanPdfText(label.toUpperCase()), { x: x + 12, y: y + 36, size: 6.5, font: bold, color: slate });
  page.drawText(cleanPdfText(value), { x: x + 12, y: y + 15, size: 12, font: bold, color: tone });
};

export async function createAnnualFinancialReport(summary: ProfessionalFinanceSummary): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  addReportHeader(page, bold, regular, `Relatorio financeiro ${summary.selectedYear}`, 'Caixa, resultado operacional e desempenho mensal');

  drawMetric(page, bold, regular, 40, 680, 'Caixa atual', formatCurrency(summary.currentCash), summary.currentCash >= 0 ? green : red);
  drawMetric(page, bold, regular, 217, 680, 'Receita operacional', formatCurrency(summary.annualRevenue), summary.annualRevenue >= 0 ? green : red);
  drawMetric(page, bold, regular, 394, 680, 'Resultado operacional', formatCurrency(summary.annualOperatingResult), summary.annualOperatingResult >= 0 ? green : red);
  drawMetric(page, bold, regular, 40, 610, 'Contas a receber', formatCurrency(summary.accountsReceivable), gold);
  drawMetric(page, bold, regular, 217, 610, 'Entradas de compra', formatCurrency(summary.annualPurchaseEntries));
  drawMetric(page, bold, regular, 394, 610, 'Valores em atraso', formatCurrency(summary.overdueReceivables), summary.overdueReceivables > 0 ? red : green);

  page.drawText('DESEMPENHO MENSAL', { x: 40, y: 570, size: 8, font: bold, color: gold });
  const headers = ['Mes', 'Entradas', 'Saidas', 'Resultado caixa', 'Resultado operacional'];
  const widths = [82, 105, 105, 122, 135];
  let cursorX = 40;
  headers.forEach((header, index) => {
    page.drawText(header, { x: cursorX, y: 546, size: 7, font: bold, color: slate });
    cursorX += widths[index]!;
  });
  page.drawLine({ start: { x: 40, y: 538 }, end: { x: 555, y: 538 }, thickness: 0.8, color: rgb(0.85, 0.87, 0.9) });

  summary.months.forEach((month, index) => {
    const y = 515 - index * 31;
    const values = [
      formatMonthLabel(month.month).replace(` de ${summary.selectedYear}`, ''),
      formatCurrency(month.cashEntries),
      formatCurrency(month.cashOutflows),
      formatCurrency(month.netCashFlow),
      formatCurrency(month.operationalResult),
    ];
    let x = 40;
    values.forEach((value, valueIndex) => {
      page.drawText(cleanPdfText(value), {
        x,
        y,
        size: valueIndex === 0 ? 7.5 : 7,
        font: valueIndex === 0 ? bold : regular,
        color: valueIndex === 4 ? (month.operationalResult >= 0 ? green : red) : navy,
      });
      x += widths[valueIndex]!;
    });
    page.drawLine({ start: { x: 40, y: y - 9 }, end: { x: 555, y: y - 9 }, thickness: 0.4, color: rgb(0.9, 0.91, 0.93) });
  });

  page.drawText('Entradas de compra integram a receita e o resultado. Aportes e compras de estoque sao movimentos patrimoniais.', { x: 40, y: 100, size: 7.5, font: regular, color: slate });
  page.drawText(`Gerado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`, { x: 40, y: 78, size: 7, font: regular, color: slate });
  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

export async function createMonthlyFinancialReport(month: ProfessionalMonthMetrics): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  addReportHeader(page, bold, regular, `Fechamento de ${formatMonthLabel(month.month)}`, 'Demonstrativo mensal gerencial');

  const metrics: Array<[string, number, typeof navy]> = [
    ['Saldo inicial', month.openingBalance, navy],
    ['Entradas de caixa', month.cashEntries, green],
    ['Saidas de caixa', month.cashOutflows, red],
    ['Saldo final', month.closingBalance, month.closingBalance >= 0 ? green : red],
    ['Receita operacional', month.operationalRevenue, green],
    ['Resultado operacional', month.operationalResult, month.operationalResult >= 0 ? green : red],
  ];
  metrics.forEach(([label, value, tone], index) => drawMetric(page, bold, regular, 40 + (index % 3) * 177, 680 - Math.floor(index / 3) * 70, label, formatCurrency(value), tone));

  page.drawText('COMPOSICAO DO MES', { x: 40, y: 570, size: 8, font: bold, color: gold });
  const rows: Array<[string, number, 'in' | 'out' | 'neutral']> = [
    ['Recebimentos de locacao', month.rentalIncome, 'in'],
    ['Entradas para compra futura', month.depositIncome, 'in'],
    ['Correcoes de entrada de compra', month.depositRefunds, 'out'],
    ['Vendas diretas', month.salesIncome, 'in'],
    ['Custo contabil dos aparelhos vendidos', month.salesCost, 'neutral'],
    ['Compras de estoque', month.inventoryPurchases, 'neutral'],
    ['Despesas operacionais', month.operatingExpenses, 'out'],
    ['Aportes', month.capitalAdded, 'neutral'],
    ['Retiradas', month.ownerWithdrawals, 'out'],
    ['Previsao de recebimentos', month.forecastReceivables, 'neutral'],
  ];
  rows.forEach(([label, value, direction], index) => {
    const y = 535 - index * 38;
    page.drawText(cleanPdfText(label), { x: 45, y, size: 9, font: regular, color: slate });
    page.drawText(formatCurrency(value), { x: 385, y, size: 9, font: bold, color: direction === 'in' ? green : direction === 'out' ? red : navy });
    page.drawLine({ start: { x: 40, y: y - 10 }, end: { x: 555, y: y - 10 }, thickness: 0.4, color: rgb(0.9, 0.91, 0.93) });
  });
  page.drawText('Caucoes ficam fora do lucro. O custo dos vendidos compoe a margem sem criar nova saida.', { x: 40, y: 150, size: 7.5, font: regular, color: slate });
  page.drawText(`Situacao: ${month.closingStatus === 'closed' ? 'Fechado' : month.closingStatus === 'reopened' ? 'Reaberto' : 'Em aberto'}`, { x: 40, y: 130, size: 8, font: bold, color: month.closingStatus === 'closed' ? green : gold });
  page.drawText(`Gerado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`, { x: 40, y: 100, size: 7, font: regular, color: slate });
  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

const csvValue = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export function createCashTransactionsCsv(transactions: CashTransaction[]): Blob {
  const rows = [
    ['Data', 'Tipo', 'Categoria', 'Descricao', 'Valor', 'Status'],
    ...transactions.map((transaction) => [
      transaction.occurred_on,
      transaction.direction === 'in' ? 'Entrada' : 'Saida',
      transaction.kind,
      transaction.description,
      transaction.amount.toFixed(2).replace('.', ','),
      transaction.status === 'confirmed' ? 'Confirmado' : 'Estornado',
    ]),
  ];
  const content = `\uFEFF${rows.map((row) => row.map(csvValue).join(';')).join('\r\n')}`;
  return new Blob([content], { type: 'text/csv;charset=utf-8' });
}

export function downloadFinancialFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
