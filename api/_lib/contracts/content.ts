import type { ContractFinancialSummary, ContractInstallment, ContractPdfData } from './types';
import { calculateContractPlan, roundMoney } from '../../../src/domain/contractPlan';
import { formatCurrency } from './formatters';

export type ContractSection = { title: string; paragraphs: string[] };

export function calculateFinancialSummary(input: {
  depositAmount: number;
  monthlyAmount: number;
  installmentCount: number;
  installments: ContractInstallment[];
  lateFeePercent: number;
  dailyInterestPercent: number;
  purchaseOption: boolean;
  purchaseOptionAmount: number | null;
}): ContractFinancialSummary {
  const paidInstallments = roundMoney(input.installments.reduce((sum, item) => sum + item.paidAmount, 0));
  const plan = calculateContractPlan({
    monthlyInstallments: input.installmentCount,
    monthlyAmount: input.monthlyAmount,
    depositAmount: input.depositAmount,
    paidInstallmentsAmount: paidInstallments,
  });
  return {
    depositAmount: plan.depositAmount,
    monthlyAmount: roundMoney(input.monthlyAmount),
    installmentCount: input.installmentCount,
    monthlyTotal: plan.monthlyTotal,
    totalContract: plan.totalContract,
    amountReceived: plan.amountReceived,
    remainingBalance: plan.remainingBalance,
    lateFeePercent: input.lateFeePercent,
    dailyInterestPercent: input.dailyInterestPercent,
    purchaseOption: input.purchaseOption,
    purchaseOptionAmount: input.purchaseOption ? input.purchaseOptionAmount : null,
  };
}

export function buildContractSections(data: ContractPdfData): ContractSection[] {
  const sections: ContractSection[] = [
    {
      title: '1. Objeto e vigência',
      paragraphs: [
        `O LOCADOR entrega ao LOCATÁRIO, em caráter temporário, o aparelho ${data.device.model}, série ${data.device.serialNumber}, pelo período de ${data.financial.installmentCount} mensalidades, de ${data.startDate} até ${data.endDate}.`,
        'A propriedade do equipamento permanece com o LOCADOR durante toda a locação.',
      ],
    },
    {
      title: '2. Pagamentos, multa e juros',
      paragraphs: [
        `O LOCATÁRIO pagará ${data.financial.installmentCount} mensalidades de ${formatCurrency(data.financial.monthlyAmount)}, nos vencimentos indicados no quadro financeiro.`,
        `Em caso de atraso no pagamento de qualquer mensalidade, incidirá multa de ${data.financial.lateFeePercent}% sobre o valor vencido, acrescida de juros de mora de ${data.financial.dailyInterestPercent}% ao dia de atraso.`,
      ],
    },
    {
      title: '3. Cláusula da caução',
      paragraphs: [
        `O LOCATÁRIO declara que, no ato da locação, entregou ao LOCADOR a quantia de ${formatCurrency(data.financial.depositAmount)} a título de caução, como garantia adicional das obrigações assumidas neste contrato.`,
        'A caução é registrada separadamente das mensalidades e não integra a numeração das parcelas.',
      ],
    },
    {
      title: '4. Obrigações das partes',
      paragraphs: [
        'O LOCATÁRIO se obriga a conservar o aparelho, utilizá-lo de forma regular e devolvê-lo nas condições registradas no termo de entrega, ressalvado o desgaste natural.',
        'O LOCADOR se obriga a disponibilizar o equipamento identificado neste instrumento e manter registro dos pagamentos e ocorrências contratuais.',
      ],
    },
    {
      title: '5. Cláusula do gerenciamento remoto',
      paragraphs: [
        'O aparelho objeto deste contrato possui sistema de gerenciamento remoto MDM.',
        'Durante a vigência da locação, é proibido ao LOCATÁRIO remover, desativar, alterar, restaurar ou tentar burlar o sistema de gerenciamento.',
        'Em caso de inadimplência, descumprimento contratual, retenção indevida do aparelho ou risco ao patrimônio, o LOCADOR poderá bloquear remotamente o equipamento, solicitar sua devolução imediata e adotar as medidas legais cabíveis.',
      ],
    },
    {
      title: '6. Localização e proteção patrimonial',
      paragraphs: [
        'O LOCATÁRIO declara estar ciente de que o aparelho poderá utilizar recursos de localização e gerenciamento remoto exclusivamente para proteção do patrimônio, recuperação do equipamento e cumprimento das obrigações contratuais.',
      ],
    },
  ];

  if (data.financial.purchaseOption) {
    sections.push({
      title: '7. Cláusula da opção de compra',
      paragraphs: [
        'O LOCADOR concede ao LOCATÁRIO, de forma facultativa e sem obrigação de exercício, o direito de adquirir o aparelho objeto deste contrato durante ou ao término da locação.',
        'O exercício da opção de compra dependerá da inexistência de parcelas vencidas, multas, débitos ou quaisquer outras pendências contratuais.',
        'Após o pagamento integral do valor da opção de compra, o LOCADOR realizará a retirada do gerenciamento remoto MDM e transferirá definitivamente a propriedade do aparelho ao LOCATÁRIO.',
        'O não exercício da opção de compra não gera qualquer penalidade ao LOCATÁRIO.',
        `Valor da opção de compra: ${formatCurrency(data.financial.purchaseOptionAmount ?? 0)}.`,
      ],
    });
  }

  sections.push(
    {
      title: '8. Perda, roubo, furto ou dano',
      paragraphs: [
        `Em caso de perda, roubo, furto, dano total ou impossibilidade de devolução do aparelho, o LOCATÁRIO deverá indenizar o LOCADOR no valor de ${formatCurrency(data.device.indemnityValue)}, sem prejuízo das mensalidades, multas e demais valores pendentes.`,
      ],
    },
    {
      title: '9. Rescisão e recolhimento',
      paragraphs: [
        'O descumprimento das obrigações permite a rescisão do contrato, a exigência dos valores vencidos e a devolução imediata do equipamento, observada a legislação aplicável.',
      ],
    },
    {
      title: '10. Cobranca',
      paragraphs: [
        'Os pagamentos, acordos e eventuais estornos serão reconhecidos somente quando registrados nos controles financeiros do LOCADOR.',
      ],
    },
    {
      title: '11. Foro',
      paragraphs: [
        `Fica eleito o foro de ${data.venue || data.lessor.address || 'domicílio do LOCADOR'} para dirimir questões decorrentes deste contrato, respeitadas as normas de competência aplicáveis.`,
      ],
    },
  );

  return sections;
}

export function nextDocumentVersion(versions: number[]): number {
  return Math.max(0, ...versions) + 1;
}

export function canGenerateForOrganization(input: {
  profileOrganizationId: string;
  contractOrganizationId: string;
  role: string;
}): boolean {
  return input.profileOrganizationId === input.contractOrganizationId
    && ['admin', 'manager', 'operator'].includes(input.role);
}
