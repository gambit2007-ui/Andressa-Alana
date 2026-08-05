import { formatDate } from './formatters.js';
import { ContractPdfWriter } from './pdf-writer.js';
import type { ContractPdfData } from './types.js';

export async function generateDeliveryTermPdf(data: ContractPdfData): Promise<Uint8Array> {
  const pdf = await ContractPdfWriter.create();
  pdf.addCover({
    brand: 'Vantage iPhones',
    title: 'Termo de entrega do equipamento',
    subtitle: `${data.device.model} | ${data.device.serialNumber}`,
    details: [
      `Contrato: ${data.contractNumber}`,
      `Data de emissão: ${formatDate(data.issuedAt)}`,
      `Locatário: ${data.lessee.name}`,
    ],
  });

  pdf.section('Partes e equipamento');
  pdf.keyValues([
    ['Locador', data.lessor.name],
    ['Locatário', data.lessee.name],
    ['CPF do locatário', data.lessee.taxId ?? 'Não informado'],
    ['Contrato', data.contractNumber],
    ['Modelo', data.device.model],
    ['Cor e capacidade', `${data.device.color} | ${data.device.capacityGb} GB`],
    ['Número de série', data.device.serialNumber],
    ['IMEI 1 / IMEI 2', [data.device.imei1, data.device.imei2].filter(Boolean).join(' | ')],
    ['Saúde da bateria', `${data.device.batteryHealth}%`],
    ['Estado', data.device.condition],
    ['Acessórios', data.device.accessories.join(', ') || 'Nenhum informado'],
    ['Observações', data.device.notes ?? 'Nenhuma'],
  ]);

  pdf.section('Checklist de entrega');
  const checklistLabels: Record<string, string> = {
    screen: 'Tela', face_id: 'Face ID', cameras: 'Câmeras', microphones: 'Microfones',
    speakers: 'Alto-falantes', buttons: 'Botões', connectors: 'Conectores', housing: 'Carcaça',
    battery: 'Bateria', wifi: 'Wi-Fi', bluetooth: 'Bluetooth', mobile_data: 'Dados móveis',
    cable: 'Cabo', charger: 'Carregador', box: 'Caixa', case: 'Capinha', screen_protector: 'Película',
  };
  const rows = Object.entries(data.checklist)
    .filter(([key]) => key !== 'notes')
    .map(([key, value]) => [checklistLabels[key] ?? key.replaceAll('_', ' '), value === true ? 'Conferido' : 'Não conferido'] as [string, string]);
  pdf.keyValues(rows, 2);
  pdf.paragraph(`Observações: ${String(data.checklist.notes || 'Nenhuma')}`);

  pdf.section('Registro fotografico');
  await pdf.photos(data.photos);
  pdf.signatures({ lessor: data.lessor.name, lessee: data.lessee.name, venue: data.venue });

  return pdf.save({
    title: `Termo de entrega ${data.contractNumber}`,
    contractNumber: data.contractNumber,
    clientName: data.lessee.name,
  });
}
