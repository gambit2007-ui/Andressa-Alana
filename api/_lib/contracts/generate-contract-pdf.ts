import { readFile } from 'node:fs/promises';
import { buildContractSections, formatInstallmentStatus } from './content.js';
import { formatCurrency, formatDate } from './formatters.js';
import { ContractPdfWriter } from './pdf-writer.js';
import type { ContractPdfData } from './types.js';

const paymentMethodLabels: Record<string, string> = {
  pix: 'PIX',
  card: 'Cartão',
  transfer: 'Transferência bancária',
  cash: 'Dinheiro',
  other: 'Outro',
};

const paymentMethodLabel = (method: string | null | undefined): string => (
  method ? paymentMethodLabels[method] ?? method : 'Não informado'
);

const witnessSignatures = Promise.all([
  readFile(new URL('./assets/guilherme-geovane-sobral.png', import.meta.url)),
  readFile(new URL('./assets/robson-leandro-da-silva.png', import.meta.url)),
]);

export async function generateContractPdf(data: ContractPdfData): Promise<Uint8Array> {
  const pdf = await ContractPdfWriter.create();
  pdf.legalTitle({
    title: 'Instrumento Particular de Locação de Equipamento Móvel',
    subtitle: data.financial.purchaseOption ? 'Com opção de compra' : undefined,
    introduction: `Contrato nº ${data.contractNumber}, emitido em ${formatDate(data.issuedAt)}. Pelo presente instrumento particular, de um lado o LOCADOR e, de outro, o LOCATÁRIO, abaixo qualificados.`,
  });

  pdf.legalSubheading('LOCADOR');
  pdf.legalGrid([
    [['Nome / razão social', data.lessor.name], ['CPF / CNPJ', data.lessor.taxId ?? 'Não informado']],
    [['Endereço', data.lessor.address ?? 'Não informado']],
    [['Telefone', data.lessor.phone ?? 'Não informado'], ['E-mail', data.lessor.email ?? 'Não informado']],
  ]);

  pdf.legalSubheading('LOCATÁRIO');
  pdf.legalGrid([
    [['Nome completo', data.lessee.name]],
    [['Estado civil', 'Não informado'], ['Profissão', 'Não informado']],
    [['RG', data.lessee.rg ?? 'Não informado'], ['CPF / MF', data.lessee.taxId ?? 'Não informado']],
    [['Data de nascimento', formatDate(data.lessee.birthDate)], ['Telefone', data.lessee.phone ?? 'Não informado']],
    [['Endereço residencial', data.lessee.address ?? 'Não informado']],
    [['Endereço comercial', data.lessee.workAddress ?? 'Não informado']],
    [['E-mail', data.lessee.email ?? 'Não informado'], ['Referência', data.lessee.reference ?? 'Não informado']],
  ]);

  buildContractSections(data).forEach((section) => {
    pdf.legalSection(section.title);
    section.paragraphs.forEach((paragraph) => pdf.legalParagraph(paragraph));

    if (section.title === 'CAPÍTULO II - DO OBJETO') {
      pdf.legalSubheading('EQUIPAMENTO');
      pdf.legalGrid([
        [['Modelo', data.device.model], ['Cor', data.device.color]],
        [['Estado de conservação', data.device.condition], ['Capacidade', `${data.device.capacityGb} GB`]],
        [['Valor aproximado / indenização', formatCurrency(data.device.indemnityValue)], ['Saúde da bateria', `${data.device.batteryHealth}%`]],
        [['IMEI 1', data.device.imei1], ['IMEI 2', data.device.imei2 ?? 'Não informado']],
        [['Número de série', data.device.serialNumber], ['Apple Business / MDM', data.device.mdmStatus]],
        [['Acessórios', data.device.accessories.join(', ') || 'Nenhum informado']],
        [['Observações', data.device.notes ?? 'Nenhuma']],
      ]);
    }

    if (section.title === 'CAPÍTULO V - DO PREÇO E DA FORMA DE PAGAMENTO') {
      const summaryRows: Array<Array<[string, string]>> = [
        [['Caução paga no ato', formatCurrency(data.financial.depositAmount)], ['Mensalidade', formatCurrency(data.financial.monthlyAmount)]],
        [['Quantidade de mensalidades', String(data.financial.installmentCount)], ['Total das mensalidades', formatCurrency(data.financial.monthlyTotal)]],
        [['Valor total do contrato', formatCurrency(data.financial.totalContract)], ['Valor já recebido', formatCurrency(data.financial.amountReceived)]],
        [['Saldo restante', formatCurrency(data.financial.remainingBalance)], ['Forma de pagamento da caução', paymentMethodLabel(data.financial.depositPaymentMethod)]],
        [['Data de pagamento da caução', formatDate(data.financial.depositPaidAt)], ['Vigência', `${formatDate(data.startDate)} a ${formatDate(data.endDate)}`]],
      ];
      if (data.financial.purchaseOption) {
        summaryRows.push([['Valor da opção de compra', formatCurrency(data.financial.purchaseOptionAmount ?? 0)]]);
      }
      pdf.legalSubheading('QUADRO RESUMO');
      pdf.legalGrid(summaryRows);
      pdf.legalSubheading('MENSALIDADES');
      pdf.legalDataTable(
        ['Parcela', 'Vencimento', 'Valor', 'Status', 'Pagamento'],
        data.installments.map((item) => [
          String(item.number),
          formatDate(item.dueDate),
          formatCurrency(item.amount),
          formatInstallmentStatus(item.status),
          item.paidAt ? formatDate(item.paidAt) : 'Pendente',
        ]),
        [0.65, 1.2, 1.15, 1, 1.2],
      );
    }
  });

  const [guilhermeSignature, robsonSignature] = await witnessSignatures;
  await pdf.legalSignatures({
    lessor: data.lessor.name,
    lessee: data.lessee.name,
    venue: data.venue || '________________',
    witnesses: [
      { name: 'Guilherme Geovane Sobral', signature: guilhermeSignature },
      { name: 'Robson Leandro da Silva', signature: robsonSignature },
    ],
  });
  return pdf.save({
    title: `Contrato ${data.contractNumber}`,
    contractNumber: data.contractNumber,
    clientName: data.lessee.name,
  }, {
    style: 'legal',
    author: data.lessor.name,
  });
}
