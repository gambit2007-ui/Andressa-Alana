import {
  PDFDocument,
  PageSizes,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { sanitizePdfText } from './formatters.js';

const NAVY = rgb(0.03, 0.08, 0.17);
const GOLD = rgb(0.74, 0.55, 0.22);
const SLATE = rgb(0.28, 0.34, 0.43);
const LIGHT = rgb(0.95, 0.96, 0.97);
const WHITE = rgb(1, 1, 1);
const INK = rgb(0.08, 0.09, 0.11);
const LINE = rgb(0.72, 0.75, 0.79);

export class ContractPdfWriter {
  readonly document: PDFDocument;
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  private page: PDFPage;
  private y: number;
  private readonly margin = 48;

  private constructor(document: PDFDocument, regular: PDFFont, bold: PDFFont) {
    this.document = document;
    this.regular = regular;
    this.bold = bold;
    this.page = document.addPage(PageSizes.A4);
    this.y = this.page.getHeight() - 82;
  }

  static async create(): Promise<ContractPdfWriter> {
    const document = await PDFDocument.create();
    const [regular, bold] = await Promise.all([
      document.embedFont(StandardFonts.Helvetica),
      document.embedFont(StandardFonts.HelveticaBold),
    ]);
    return new ContractPdfWriter(document, regular, bold);
  }

  get contentWidth(): number {
    return this.page.getWidth() - this.margin * 2;
  }

  addPage(): void {
    this.page = this.document.addPage(PageSizes.A4);
    this.y = this.page.getHeight() - 82;
  }

  ensureSpace(height: number): void {
    if (this.y - height < 58) this.addPage();
  }

  addCover(input: { brand: string; title: string; subtitle: string; details: string[] }): void {
    const { width, height } = this.page.getSize();
    this.page.drawRectangle({ x: 0, y: 0, width, height, color: NAVY });
    this.page.drawRectangle({ x: this.margin, y: height - 112, width: 88, height: 4, color: GOLD });
    this.page.drawText(sanitizePdfText(input.brand).toUpperCase(), {
      x: this.margin, y: height - 94, size: 12, font: this.bold, color: GOLD,
    });
    this.drawWrappedOnPage(input.title, this.margin, height - 224, width - this.margin * 2, 28, this.bold, WHITE, 34);
    this.drawWrappedOnPage(input.subtitle, this.margin, height - 322, width - this.margin * 2, 13, this.regular, rgb(0.73, 0.78, 0.85), 19);
    let detailY = 176;
    input.details.forEach((detail) => {
      this.page.drawText(sanitizePdfText(detail), {
        x: this.margin, y: detailY, size: 10, font: this.regular, color: rgb(0.75, 0.8, 0.87),
      });
      detailY -= 20;
    });
    this.addPage();
  }

  legalTitle(input: { title: string; subtitle?: string; introduction: string }): void {
    const titleLines = this.wrap(input.title.toUpperCase(), this.contentWidth, 12, this.bold);
    titleLines.forEach((line) => {
      const x = this.margin + (this.contentWidth - this.bold.widthOfTextAtSize(line, 12)) / 2;
      this.page.drawText(line, { x, y: this.y, size: 12, font: this.bold, color: INK });
      this.y -= 16;
    });
    if (input.subtitle) {
      const subtitle = sanitizePdfText(input.subtitle);
      const x = this.margin + (this.contentWidth - this.bold.widthOfTextAtSize(subtitle, 9.5)) / 2;
      this.page.drawText(subtitle, { x, y: this.y - 1, size: 9.5, font: this.bold, color: INK });
      this.y -= 17;
    }
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.margin + this.contentWidth, y: this.y },
      thickness: 1.2,
      color: NAVY,
    });
    this.y -= 16;
    this.legalParagraph(input.introduction);
  }

  legalSection(title: string): void {
    this.ensureSpace(34);
    this.y -= 3;
    const lines = this.wrap(title.toUpperCase(), this.contentWidth, 8.4, this.bold);
    lines.forEach((line) => {
      this.page.drawText(line, { x: this.margin, y: this.y, size: 8.4, font: this.bold, color: INK });
      this.y -= 10.5;
    });
    this.y -= 2;
  }

  legalSubheading(title: string): void {
    this.ensureSpace(24);
    this.page.drawText(sanitizePdfText(title).toUpperCase(), {
      x: this.margin,
      y: this.y,
      size: 7.4,
      font: this.bold,
      color: INK,
    });
    this.y -= 11;
  }

  legalParagraph(text: string): void {
    const lines = this.wrap(text, this.contentWidth, 7.65, this.regular);
    const height = lines.length * 9.35 + 3;
    this.ensureSpace(height);
    lines.forEach((line) => {
      this.page.drawText(line, { x: this.margin, y: this.y, size: 7.65, font: this.regular, color: INK });
      this.y -= 9.35;
    });
    this.y -= 3;
  }

  legalGrid(rows: Array<Array<[string, string]>>): void {
    rows.forEach((row) => {
      const columnWidth = this.contentWidth / row.length;
      const valueLines = row.map(([, value]) => this.wrap(value, columnWidth - 12, 7.4, this.regular).slice(0, 3));
      const height = Math.max(27, 15 + Math.max(...valueLines.map((lines) => lines.length)) * 8.8);
      this.ensureSpace(height + 1);
      row.forEach(([label], column) => {
        const x = this.margin + column * columnWidth;
        this.page.drawRectangle({
          x,
          y: this.y - height,
          width: columnWidth,
          height,
          borderColor: LINE,
          borderWidth: 0.45,
        });
        this.page.drawText(sanitizePdfText(label).toUpperCase(), {
          x: x + 6,
          y: this.y - 9,
          size: 5.8,
          font: this.bold,
          color: SLATE,
        });
        (valueLines[column] ?? []).forEach((line, lineIndex) => {
          this.page.drawText(line, {
            x: x + 6,
            y: this.y - 20 - lineIndex * 8.8,
            size: 7.4,
            font: this.regular,
            color: INK,
          });
        });
      });
      this.y -= height;
    });
    this.y -= 7;
  }

  legalDataTable(headers: string[], rows: string[][], widths: number[]): void {
    const total = widths.reduce((sum, value) => sum + value, 0);
    const normalized = widths.map((value) => (value / total) * this.contentWidth);
    const drawHeader = () => {
      this.page.drawRectangle({ x: this.margin, y: this.y - 15, width: this.contentWidth, height: 20, color: NAVY });
      let x = this.margin;
      headers.forEach((header, index) => {
        this.page.drawText(this.truncate(header.toUpperCase(), (normalized[index] ?? 0) - 8, 5.7, this.bold), {
          x: x + 4,
          y: this.y - 7,
          size: 5.7,
          font: this.bold,
          color: WHITE,
        });
        x += normalized[index] ?? 0;
      });
      this.y -= 20;
    };
    this.ensureSpace(44);
    drawHeader();
    rows.forEach((row, rowIndex) => {
      if (this.y - 18 < 58) {
        this.addPage();
        drawHeader();
      }
      this.page.drawRectangle({
        x: this.margin,
        y: this.y - 13,
        width: this.contentWidth,
        height: 18,
        color: rowIndex % 2 ? WHITE : LIGHT,
        borderColor: LINE,
        borderWidth: 0.25,
      });
      let x = this.margin;
      row.forEach((cell, index) => {
        this.page.drawText(this.truncate(cell, (normalized[index] ?? 0) - 8, 6.4, this.regular), {
          x: x + 4,
          y: this.y - 6,
          size: 6.4,
          font: this.regular,
          color: INK,
        });
        x += normalized[index] ?? 0;
      });
      this.y -= 18;
    });
    this.y -= 7;
  }

  section(title: string): void {
    this.ensureSpace(42);
    this.y -= 8;
    this.page.drawRectangle({ x: this.margin, y: this.y - 5, width: 4, height: 20, color: GOLD });
    this.page.drawText(sanitizePdfText(title), {
      x: this.margin + 12, y: this.y, size: 13, font: this.bold, color: NAVY,
    });
    this.y -= 28;
  }

  paragraph(text: string): void {
    const lines = this.wrap(text, this.contentWidth, 9.6, this.regular);
    const height = lines.length * 14 + 8;
    this.ensureSpace(height);
    for (const line of lines) {
      this.page.drawText(line, { x: this.margin, y: this.y, size: 9.6, font: this.regular, color: SLATE });
      this.y -= 14;
    }
    this.y -= 7;
  }

  keyValues(rows: Array<[string, string]>, columns = 2): void {
    const gap = 12;
    const width = (this.contentWidth - gap * (columns - 1)) / columns;
    for (let index = 0; index < rows.length; index += columns) {
      const group = rows.slice(index, index + columns);
      this.ensureSpace(52);
      group.forEach(([label, value], column) => {
        const x = this.margin + column * (width + gap);
        this.page.drawRectangle({ x, y: this.y - 37, width, height: 46, color: LIGHT, borderColor: rgb(0.88, 0.89, 0.91), borderWidth: 0.5 });
        this.page.drawText(sanitizePdfText(label).toUpperCase(), { x: x + 10, y: this.y - 6, size: 6.8, font: this.bold, color: GOLD });
        const valueLines = this.wrap(value, width - 20, 9, this.regular).slice(0, 2);
        valueLines.forEach((line, lineIndex) => this.page.drawText(line, {
          x: x + 10, y: this.y - 22 - lineIndex * 11, size: 9, font: this.regular, color: NAVY,
        }));
      });
      this.y -= 56;
    }
  }

  table(headers: string[], rows: string[][], widths: number[]): void {
    const total = widths.reduce((sum, value) => sum + value, 0);
    const normalized = widths.map((value) => (value / total) * this.contentWidth);
    const drawHeader = () => {
      this.page.drawRectangle({ x: this.margin, y: this.y - 18, width: this.contentWidth, height: 24, color: NAVY });
      let x = this.margin;
      headers.forEach((header, index) => {
        this.page.drawText(sanitizePdfText(header).toUpperCase(), { x: x + 5, y: this.y - 9, size: 6.5, font: this.bold, color: WHITE });
        x += normalized[index] ?? 0;
      });
      this.y -= 24;
    };
    this.ensureSpace(50);
    drawHeader();
    rows.forEach((row, rowIndex) => {
      if (this.y - 24 < 58) {
        this.addPage();
        drawHeader();
      }
      this.page.drawRectangle({ x: this.margin, y: this.y - 18, width: this.contentWidth, height: 24, color: rowIndex % 2 ? WHITE : LIGHT });
      let x = this.margin;
      row.forEach((cell, index) => {
        const maxWidth = (normalized[index] ?? 0) - 10;
        const display = this.truncate(cell, maxWidth, 7.7, this.regular);
        this.page.drawText(display, { x: x + 5, y: this.y - 9, size: 7.7, font: this.regular, color: SLATE });
        x += normalized[index] ?? 0;
      });
      this.y -= 24;
    });
    this.y -= 8;
  }

  async photos(photos: Array<{ caption: string; mimeType: string; bytes: Uint8Array }>): Promise<void> {
    const slots = photos.length > 0 ? photos.slice(0, 6) : [null, null, null, null];
    const gap = 12;
    const slotWidth = (this.contentWidth - gap) / 2;
    const slotHeight = 150;
    for (let index = 0; index < slots.length; index += 2) {
      this.ensureSpace(slotHeight + 18);
      const group = slots.slice(index, index + 2);
      for (let column = 0; column < group.length; column += 1) {
        const item = group[column];
        const x = this.margin + column * (slotWidth + gap);
        this.page.drawRectangle({ x, y: this.y - slotHeight, width: slotWidth, height: slotHeight, color: LIGHT, borderColor: rgb(0.84, 0.86, 0.89), borderWidth: 0.7 });
        if (item) {
          const image = await this.embedImage(item.mimeType, item.bytes).catch(() => null);
          if (image) this.drawImageFit(image, x + 6, this.y - slotHeight + 24, slotWidth - 12, slotHeight - 32);
          this.page.drawText(this.truncate(item.caption || 'Foto do aparelho', slotWidth - 16, 7, this.regular), {
            x: x + 8, y: this.y - slotHeight + 9, size: 7, font: this.regular, color: SLATE,
          });
        } else {
          this.page.drawText('Espaco reservado para foto do aparelho', {
            x: x + 18, y: this.y - slotHeight / 2, size: 8, font: this.regular, color: rgb(0.55, 0.59, 0.65),
          });
        }
      }
      this.y -= slotHeight + 14;
    }
  }

  signatures(input: { lessor: string; lessee: string; venue: string | null }): void {
    this.addPage();
    this.section('Assinaturas');
    this.paragraph(`E, por estarem de acordo, firmam o presente instrumento em ${sanitizePdfText(input.venue)}, na data indicada abaixo.`);
    this.y -= 30;
    const entries: Array<[string, string]> = [
      ['LOCADOR', input.lessor],
      ['LOCATÁRIO', input.lessee],
      ['TESTEMUNHA 1', 'Nome e CPF'],
      ['TESTEMUNHA 2', 'Nome e CPF'],
    ];
    entries.forEach(([role, name], index) => {
      if (index === 2) this.y -= 28;
      this.ensureSpace(76);
      this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.margin + this.contentWidth, y: this.y }, thickness: 0.7, color: SLATE });
      this.page.drawText(sanitizePdfText(name), { x: this.margin, y: this.y - 17, size: 9, font: this.bold, color: NAVY });
      this.page.drawText(role, { x: this.margin, y: this.y - 31, size: 7, font: this.regular, color: GOLD });
      this.y -= 62;
    });
    this.page.drawText('Data: ____/____/________', { x: this.margin, y: 74, size: 9, font: this.regular, color: SLATE });
  }

  async legalSignatures(input: {
    lessor: string;
    lessee: string;
    venue: string | null;
    witnesses: Array<{ name: string; signature: Uint8Array }>;
  }): Promise<void> {
    this.ensureSpace(225);
    this.y -= 5;
    this.page.drawText(`${sanitizePdfText(input.venue)}, ____/____/________.`, {
      x: this.margin,
      y: this.y,
      size: 8,
      font: this.regular,
      color: INK,
    });
    this.y -= 46;
    const gap = 28;
    const width = (this.contentWidth - gap) / 2;
    const witnessEntries = await Promise.all(input.witnesses.map(async (witness, index) => ({
      role: `TESTEMUNHA ${index + 1}`,
      name: witness.name,
      image: await this.document.embedPng(witness.signature),
    })));
    const drawPair = (entries: Array<{ role: string; name: string; image?: PDFImage }>, spacing: number) => {
      entries.forEach(({ role, name, image }, column) => {
        const x = this.margin + column * (width + gap);
        if (image) this.drawImageFit(image, x + 10, this.y + 4, width - 20, 42);
        this.page.drawLine({ start: { x, y: this.y }, end: { x: x + width, y: this.y }, thickness: 0.55, color: INK });
        this.page.drawText(this.truncate(name, width, 7.3, this.bold), { x, y: this.y - 12, size: 7.3, font: this.bold, color: INK });
        this.page.drawText(role, { x, y: this.y - 23, size: 6.3, font: this.regular, color: SLATE });
      });
      this.y -= spacing;
    };
    drawPair([
      { role: 'LOCADOR', name: input.lessor },
      { role: 'LOCATÁRIO', name: input.lessee },
    ], 92);
    drawPair(witnessEntries, 65);
  }

  async save(
    metadata: { title: string; contractNumber: string; clientName: string },
    options: { style?: 'brand' | 'legal'; author?: string } = {},
  ): Promise<Uint8Array> {
    this.document.setTitle(metadata.title);
    this.document.setSubject(`Contrato ${metadata.contractNumber}`);
    this.document.setAuthor(options.author || 'Vantage iPhones');
    const pages = this.document.getPages();
    pages.forEach((page, index) => {
      const { width } = page.getSize();
      page.drawLine({ start: { x: this.margin, y: 42 }, end: { x: width - this.margin, y: 42 }, thickness: 0.5, color: rgb(0.82, 0.84, 0.87) });
      const footer = options.style === 'legal'
        ? `${sanitizePdfText(metadata.contractNumber)}  |  ${sanitizePdfText(metadata.clientName)}`
        : `VANTAGE IPHONES  |  ${sanitizePdfText(metadata.contractNumber)}  |  ${sanitizePdfText(metadata.clientName)}`;
      page.drawText(footer, {
        x: this.margin, y: 27, size: 6.5, font: this.regular, color: SLATE,
      });
      page.drawText(`Página ${index + 1} de ${pages.length}`, {
        x: width - this.margin - 72, y: 27, size: 6.5, font: this.regular, color: SLATE,
      });
    });
    return this.document.save();
  }

  private drawWrappedOnPage(text: string, x: number, y: number, width: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, lineHeight: number): void {
    this.wrap(text, width, size, font).forEach((line, index) => {
      this.page.drawText(line, { x, y: y - index * lineHeight, size, font, color });
    });
  }

  private wrap(text: string, width: number, size: number, font: PDFFont): string[] {
    const words = sanitizePdfText(text).split(' ');
    const lines: string[] = [];
    let current = '';
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !current) current = candidate;
      else {
        lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);
    return lines;
  }

  private truncate(text: string, width: number, size: number, font: PDFFont): string {
    const value = sanitizePdfText(text);
    if (font.widthOfTextAtSize(value, size) <= width) return value;
    let shortened = value;
    while (shortened.length > 1 && font.widthOfTextAtSize(`${shortened}...`, size) > width) shortened = shortened.slice(0, -1);
    return `${shortened}...`;
  }

  private async embedImage(mimeType: string, bytes: Uint8Array): Promise<PDFImage> {
    return mimeType.includes('png') ? this.document.embedPng(bytes) : this.document.embedJpg(bytes);
  }

  private drawImageFit(image: PDFImage, x: number, y: number, width: number, height: number): void {
    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    this.page.drawImage(image, {
      x: x + (width - drawWidth) / 2,
      y: y + (height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
  }
}
