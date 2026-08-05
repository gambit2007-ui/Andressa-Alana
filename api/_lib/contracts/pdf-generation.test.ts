import { describe, expect, it } from 'vitest';
import { generateContractPdf } from './generate-contract-pdf.js';
import { generateDeliveryTermPdf } from './generate-delivery-term-pdf.js';
import type { ContractPdfData } from './types.js';

const data: ContractPdfData = {
  contractId: '9c00f4dd-bbf9-4d50-b47e-ea7ec953351b', contractNumber: 'GR-2026-PDF',
  issuedAt: '2026-08-04', startDate: '2026-08-04', endDate: '2026-12-10',
  firstInstallmentDate: '2026-09-10', venue: 'Sao Paulo',
  lessor: { name: 'GR Solution', taxId: '12345678000100', phone: '11999999999', email: 'contato@example.com', address: 'Endereco do locador' },
  lessee: { name: 'Cliente de Teste', taxId: '52998224725', rg: '1234567', phone: '11988888888', email: 'cliente@example.com', address: 'Endereco do cliente' },
  device: {
    model: 'iPhone 16', capacityGb: 128, color: 'Preto', batteryHealth: 90,
    imei1: '123456789012345', imei2: null, serialNumber: 'SERIE123', condition: 'Excelente',
    indemnityValue: 3500, notes: null, mdmStatus: 'Ativo', accessories: ['Cabo'],
  },
  financial: {
    depositAmount: 480, monthlyAmount: 480, installmentCount: 4, monthlyTotal: 1920,
    totalContract: 2400, amountReceived: 480, remainingBalance: 1920,
    lateFeePercent: 2, dailyInterestPercent: 1.5, purchaseOption: true, purchaseOptionAmount: 2000,
  },
  installments: Array.from({ length: 4 }, (_, index) => ({
    number: index + 1, dueDate: `2026-${String(index + 9).padStart(2, '0')}-10`,
    amount: 480, status: 'pending', paidAmount: 0, paidAt: null,
  })),
  checklist: { screen: true, face_id: true, notes: 'Sem avarias.' }, photos: [],
};

const pdfHeader = (bytes: Uint8Array): string => new TextDecoder().decode(bytes.slice(0, 4));

describe('geracao real dos PDFs', () => {
  it('gera o contrato em memoria sem Chromium ou binarios externos', async () => {
    const bytes = await generateContractPdf(data);
    expect(pdfHeader(bytes)).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(10_000);
  });

  it('gera o termo de entrega separadamente', async () => {
    const bytes = await generateDeliveryTermPdf(data);
    expect(pdfHeader(bytes)).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(3_000);
  });
});
