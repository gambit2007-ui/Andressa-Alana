import { buildContractSections, formatInstallmentStatus } from './content.js';
import { formatCurrency, formatDate } from './formatters.js';
import { ContractPdfWriter } from './pdf-writer.js';
import type { ContractPdfData } from './types.js';

export async function generateContractPdf(data: ContractPdfData): Promise<Uint8Array> {
  const pdf = await ContractPdfWriter.create();
  pdf.addCover({
    brand: 'Vantage iPhones',
    title: 'Contrato de locação de smartphone',
    subtitle: `${data.device.model} | ${data.lessee.name}`,
    details: [
      `Número do contrato: ${data.contractNumber}`,
      `Data de emissão: ${formatDate(data.issuedAt)}`,
      `Vigência: ${formatDate(data.startDate)} a ${formatDate(data.endDate)}`,
    ],
  });

  pdf.section('Qualificação das partes');
  pdf.keyValues([
    ['Locador', data.lessor.name],
    ['CPF/CNPJ do locador', data.lessor.taxId ?? 'Não informado'],
    ['Endereço do locador', data.lessor.address ?? 'Não informado'],
    ['Contato do locador', [data.lessor.phone, data.lessor.email].filter(Boolean).join(' | ')],
    ['Locatario', data.lessee.name],
    ['CPF do locatario', data.lessee.taxId ?? 'Nao informado'],
    ['RG / nascimento', [data.lessee.rg, formatDate(data.lessee.birthDate)].filter(Boolean).join(' | ')],
    ['Contato do locatario', [data.lessee.phone, data.lessee.secondaryPhone, data.lessee.email].filter(Boolean).join(' | ')],
    ['Endereço do locatário', data.lessee.address ?? 'Não informado'],
    ['Trabalho / referência', [data.lessee.workAddress, data.lessee.reference].filter(Boolean).join(' | ')],
  ]);

  pdf.section('Quadro técnico do aparelho');
  pdf.keyValues([
    ['Modelo', data.device.model],
    ['Capacidade e cor', `${data.device.capacityGb} GB | ${data.device.color}`],
    ['IMEI 1', data.device.imei1],
    ['IMEI 2', data.device.imei2 ?? 'Não informado'],
    ['Número de série', data.device.serialNumber],
    ['Bateria e condição', `${data.device.batteryHealth}% | ${data.device.condition}`],
    ['Valor de indenização', formatCurrency(data.device.indemnityValue)],
    ['Apple Business / MDM', data.device.mdmStatus],
    ['Acessórios', data.device.accessories.join(', ') || 'Nenhum informado'],
    ['Observações', data.device.notes ?? 'Nenhuma'],
  ]);

  pdf.section('Resumo financeiro');
  pdf.keyValues([
    ['Caução paga no ato', formatCurrency(data.financial.depositAmount)],
    ['Mensalidade', formatCurrency(data.financial.monthlyAmount)],
    ['Quantidade de mensalidades', String(data.financial.installmentCount)],
    ['Total das mensalidades', formatCurrency(data.financial.monthlyTotal)],
    ['Valor total do contrato', formatCurrency(data.financial.totalContract)],
    ['Valor já recebido', formatCurrency(data.financial.amountReceived)],
    ['Saldo restante', formatCurrency(data.financial.remainingBalance)],
    ['Multa e juros', `${data.financial.lateFeePercent}% | ${data.financial.dailyInterestPercent}% ao dia`],
  ]);

  pdf.section('Mensalidades');
  pdf.table(
    ['Parcela', 'Vencimento', 'Valor', 'Status', 'Pagamento'],
    data.installments.map((item) => [
      String(item.number), formatDate(item.dueDate), formatCurrency(item.amount), formatInstallmentStatus(item.status),
      item.paidAt ? formatDate(item.paidAt) : 'Pendente',
    ]),
    [0.7, 1.25, 1.2, 1, 1.25],
  );

  buildContractSections(data).forEach((section) => {
    pdf.section(section.title);
    section.paragraphs.forEach((paragraph) => pdf.paragraph(paragraph));
  });

  pdf.section('Checklist de entrega');
  const checklistLabels: Record<string, string> = {
    screen: 'Tela', face_id: 'Face ID', cameras: 'Câmeras', microphones: 'Microfones',
    speakers: 'Alto-falantes', buttons: 'Botões', connectors: 'Conectores', housing: 'Carcaça',
    battery: 'Bateria', wifi: 'Wi-Fi', bluetooth: 'Bluetooth', mobile_data: 'Dados móveis',
    cable: 'Cabo', charger: 'Carregador', box: 'Caixa', case: 'Capinha', screen_protector: 'Película',
  };
  const checklistRows = Object.entries(data.checklist)
    .filter(([key]) => key !== 'notes')
    .map(([key, value]) => [checklistLabels[key] ?? key.replaceAll('_', ' '), value === true ? 'Conferido' : 'Não conferido'] as [string, string]);
  pdf.keyValues(checklistRows, 2);
  pdf.paragraph(`Observações do checklist: ${String(data.checklist.notes || 'Nenhuma')}`);

  pdf.section('Fotos do aparelho');
  await pdf.photos(data.photos);

  pdf.signatures({ lessor: data.lessor.name, lessee: data.lessee.name, venue: data.venue });
  return pdf.save({
    title: `Contrato ${data.contractNumber}`,
    contractNumber: data.contractNumber,
    clientName: data.lessee.name,
  });
}
