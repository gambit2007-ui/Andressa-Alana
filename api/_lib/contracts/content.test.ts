import { describe, expect, it } from 'vitest';
import { buildContractSections, calculateFinancialSummary, canGenerateForOrganization, formatInstallmentStatus, nextDocumentVersion } from './content.js';
import { formatCurrency } from './formatters.js';
import type { ContractPdfData } from './types.js';

const baseData: ContractPdfData = {
  contractId: '9c00f4dd-bbf9-4d50-b47e-ea7ec953351b',
  contractNumber: 'GR-2026-TESTE',
  issuedAt: '2026-08-04', startDate: '2026-08-04', endDate: '2026-12-10',
  firstInstallmentDate: '2026-09-10', venue: 'Sao Paulo',
  lessor: { name: 'GR Solution', taxId: null, phone: null, email: null, address: null },
  lessee: { name: 'Cliente', taxId: '52998224725', phone: null, email: null, address: null },
  device: {
    model: 'iPhone', capacityGb: 128, color: 'Preto', batteryHealth: 90,
    imei1: '123456789012345', imei2: null, serialNumber: 'SERIE', condition: 'Excelente',
    indemnityValue: 3500, notes: null, mdmStatus: 'Ativo', accessories: [],
  },
  financial: {
    depositAmount: 480, monthlyAmount: 480, installmentCount: 4, monthlyTotal: 1920,
    totalContract: 2400, amountReceived: 480, remainingBalance: 1920,
    lateFeePercent: 2, dailyInterestPercent: 1.5, purchaseOption: false, purchaseOptionAmount: null,
  },
  installments: Array.from({ length: 4 }, (_, index) => ({
    number: index + 1, dueDate: `2026-${String(index + 9).padStart(2, '0')}-10`,
    amount: 480, status: 'pending', paidAmount: 0, paidAt: null,
  })),
  checklist: {}, photos: [],
};

describe('conteudo contratual', () => {
  it('calcula caucao separada e saldo restante', () => {
    const summary = calculateFinancialSummary({
      depositAmount: 480, monthlyAmount: 480, installmentCount: 4,
      installments: baseData.installments, lateFeePercent: 2, dailyInterestPercent: 1.5,
      purchaseOption: false, purchaseOptionAmount: null,
    });
    expect(summary.totalContract).toBe(2400);
    expect(summary.monthlyTotal).toBe(1920);
    expect(summary.amountReceived).toBe(480);
    expect(summary.remainingBalance).toBe(1920);
    expect(baseData.installments).toHaveLength(4);
  });

  it('nao soma a caucao historica duas vezes como valor recebido', () => {
    const legacyInstallments = [
      { number: 1, dueDate: '2026-08-03', amount: 480, status: 'paid', paidAmount: 480, paidAt: '2026-08-03' },
      ...baseData.installments.map((item) => ({ ...item, number: item.number + 1 })),
    ];
    const summary = calculateFinancialSummary({
      depositAmount: 480,
      depositAsFirstInstallment: true,
      monthlyAmount: 480,
      installmentCount: 4,
      installments: legacyInstallments,
      lateFeePercent: 2,
      dailyInterestPercent: 1.5,
      purchaseOption: false,
      purchaseOptionAmount: null,
    });
    expect(summary.totalContract).toBe(2400);
    expect(summary.amountReceived).toBe(480);
    expect(summary.remainingBalance).toBe(1920);
  });

  it('soma uma mensalidade paga quando a caucao e separada', () => {
    const installments = baseData.installments.map((item, index) => index === 0
      ? { ...item, status: 'paid', paidAmount: 480, paidAt: '2026-09-10' }
      : item);
    const summary = calculateFinancialSummary({
      depositAmount: 480,
      depositAsFirstInstallment: false,
      monthlyAmount: 480,
      installmentCount: 4,
      installments,
      lateFeePercent: 2,
      dailyInterestPercent: 1.5,
      purchaseOption: false,
      purchaseOptionAmount: null,
    });
    expect(summary.amountReceived).toBe(960);
    expect(summary.remainingBalance).toBe(1440);
  });

  it('traduz os status das mensalidades para portugues', () => {
    expect(formatInstallmentStatus('paid')).toBe('Paga');
    expect(formatInstallmentStatus('pending')).toBe('Pendente');
    expect(formatInstallmentStatus('partial')).toBe('Parcial');
    expect(formatInstallmentStatus('overdue')).toBe('Atrasada');
    expect(formatInstallmentStatus('cancelled')).toBe('Cancelada');
    expect(formatInstallmentStatus('renegotiated')).toBe('Renegociada');
  });

  it('inclui a clausula de compra somente quando ativada', () => {
    const disabledText = buildContractSections(baseData).flatMap((section) => section.paragraphs).join(' ');
    expect(disabledText).not.toContain('opção de compra');
    const enabled = { ...baseData, financial: { ...baseData.financial, purchaseOption: true, purchaseOptionAmount: 2000 } };
    const enabledText = buildContractSections(enabled).flatMap((section) => section.paragraphs).join(' ');
    expect(enabledText).toContain('opção de compra');
    expect(enabledText).toMatch(/R\$\s*2\.000,00/);
  });

  it('implementa os 23 capitulos do modelo juridico', () => {
    const sections = buildContractSections(baseData);
    expect(sections).toHaveLength(23);
    expect(sections[0]?.title).toBe('CAPÍTULO I - DAS PARTES');
    expect(sections[22]?.title).toBe('CAPÍTULO XXIII - DO FORO');
    const text = sections.flatMap((section) => section.paragraphs).join(' ');
    expect(text).toContain('Termo de Vistoria');
    expect(text).toContain('vencimento antecipado');
    expect(text).toContain('Apple Business / MDM');
    expect(text).toContain('informações privadas do LOCATÁRIO');
  });

  it('nao promete devolucao automatica da caucao', () => {
    const text = buildContractSections(baseData).flatMap((section) => section.paragraphs).join(' ').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    expect(text).not.toContain('devolvida automaticamente');
    expect(text).not.toContain('devolucao da caucao');
  });

  it('incrementa a versao sem substituir as anteriores', () => {
    expect(nextDocumentVersion([])).toBe(1);
    expect(nextDocumentVersion([1, 2, 3])).toBe(4);
  });

  it('formata valores em real brasileiro', () => {
    expect(formatCurrency(2400)).toMatch(/R\$\s*2\.400,00/);
  });

  it('bloqueia acesso entre organizacoes e perfis sem permissao', () => {
    expect(canGenerateForOrganization({ profileOrganizationId: 'org-a', contractOrganizationId: 'org-b', role: 'admin' })).toBe(false);
    expect(canGenerateForOrganization({ profileOrganizationId: 'org-a', contractOrganizationId: 'org-a', role: 'viewer' })).toBe(false);
    expect(canGenerateForOrganization({ profileOrganizationId: 'org-a', contractOrganizationId: 'org-a', role: 'manager' })).toBe(true);
  });
});
