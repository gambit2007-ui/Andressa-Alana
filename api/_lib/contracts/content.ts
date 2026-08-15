import type { ContractFinancialSummary, ContractInstallment, ContractPdfData } from './types.js';
import { calculateContractPlan, roundMoney } from '../../../src/domain/contractPlan.js';
import { formatCurrency, formatDate } from './formatters.js';

export type ContractSection = { title: string; paragraphs: string[] };

const installmentStatusLabels: Record<string, string> = {
  pending: 'Pendente',
  partial: 'Parcial',
  overdue: 'Atrasada',
  paid: 'Paga',
  cancelled: 'Cancelada',
  renegotiated: 'Renegociada',
};

export function formatInstallmentStatus(status: string): string {
  return installmentStatusLabels[status.toLowerCase()] ?? status;
}

export function calculateFinancialSummary(input: {
  depositAmount: number;
  depositAsFirstInstallment?: boolean;
  depositPaidAt?: string | null;
  depositPaymentMethod?: string | null;
  monthlyAmount: number;
  installmentCount: number;
  installments: ContractInstallment[];
  lateFeePercent: number;
  dailyInterestPercent: number;
  purchaseOption: boolean;
  purchaseOptionAmount: number | null;
}): ContractFinancialSummary {
  const paidInstallments = roundMoney(input.installments.reduce((sum, item) => sum + item.paidAmount, 0));
  const legacyDepositPayment = input.depositAsFirstInstallment
    ? input.installments.find((item) => item.number === 1)?.paidAmount ?? 0
    : 0;
  const paidMonthlyInstallments = roundMoney(Math.max(0, paidInstallments - legacyDepositPayment));
  const plan = calculateContractPlan({
    monthlyInstallments: input.installmentCount,
    monthlyAmount: input.monthlyAmount,
    depositAmount: input.depositAmount,
    paidInstallmentsAmount: paidMonthlyInstallments,
  });
  return {
    depositAmount: plan.depositAmount,
    depositPaidAt: input.depositPaidAt ?? null,
    depositPaymentMethod: input.depositPaymentMethod ?? null,
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
  const optionParagraphs = data.financial.purchaseOption
    ? [
        `O LOCADOR concede ao LOCATÁRIO, de forma facultativa, opção de compra do EQUIPAMENTO pelo valor de ${formatCurrency(data.financial.purchaseOptionAmount ?? 0)}, quantia que não integra o total da locação e somente será exigível se a opção for exercida.`,
        'O exercício da opção depende da quitação integral das obrigações contratuais. Após o pagamento do preço de compra, o LOCADOR retirará o gerenciamento remoto e transferirá a propriedade do EQUIPAMENTO ao LOCATÁRIO.',
      ]
    : [];

  return [
    {
      title: 'CAPÍTULO I - DAS PARTES',
      paragraphs: [
        `Pelo presente Instrumento Particular de Contrato de Locação de Bem Móvel, de um lado ${data.lessor.name}, doravante denominado LOCADOR, e, de outro, ${data.lessee.name}, doravante denominado LOCATÁRIO, ambos qualificados neste instrumento, têm entre si justo e contratado o quanto segue.`,
        'Parágrafo primeiro. As partes declaram possuir plena capacidade civil e legitimidade para celebrar o presente contrato, inexistindo impedimento legal ou contratual para sua celebração.',
        'Parágrafo segundo. O LOCATÁRIO declara que as informações pessoais, cadastrais e financeiras fornecidas são verdadeiras, completas e atualizadas, comprometendo-se a comunicar alterações em até 5 (cinco) dias úteis.',
        'Parágrafo terceiro. A omissão ou falsidade de informações cadastrais constitui inadimplemento contratual grave e poderá ensejar o vencimento antecipado das obrigações assumidas.',
      ],
    },
    {
      title: 'CAPÍTULO II - DO OBJETO',
      paragraphs: [
        `Constitui objeto deste contrato a locação do equipamento ${data.device.model}, número de série ${data.device.serialNumber}, descrito no quadro abaixo e no Termo de Vistoria, que integra este instrumento para todos os efeitos legais.`,
        'Parágrafo primeiro. O EQUIPAMENTO será entregue com os acessórios descritos no Termo de Vistoria, que deverão ser restituídos nas mesmas condições, ressalvado o desgaste natural do uso regular.',
        'Parágrafo segundo. O Termo de Vistoria contém estado de conservação, características técnicas, IMEI, acessórios, registros fotográficos e demais informações pertinentes, prevalecendo em caso de divergência sobre a condição física constatada na entrega.',
      ],
    },
    {
      title: 'CAPÍTULO III - DAS DECLARAÇÕES DO LOCATÁRIO',
      paragraphs: [
        'O LOCATÁRIO declara que: I - recebeu o EQUIPAMENTO no estado descrito no Termo de Vistoria; II - realizou inspeção prévia e testou suas funcionalidades; III - recebeu orientações para o uso adequado; IV - reconhece que o EQUIPAMENTO atende às suas necessidades; V - possui capacidade financeira para cumprir as obrigações assumidas; VI - celebra este contrato por livre manifestação de vontade; e VII - reconhece que o inadimplemento autoriza as medidas judiciais e extrajudiciais cabíveis.',
        'Parágrafo primeiro. O LOCATÁRIO declara ter lido integralmente este instrumento, compreendido seu conteúdo e aceitado todas as condições.',
        'Parágrafo segundo. Eventual tolerância do LOCADOR não importará novação, renúncia ou alteração das condições pactuadas.',
      ],
    },
    {
      title: 'CAPÍTULO IV - DO PRAZO',
      paragraphs: [
        `A locação vigorará de ${formatDate(data.startDate)} a ${formatDate(data.endDate)}, correspondendo a ${data.financial.installmentCount} mensalidades, e terá início com a entrega do EQUIPAMENTO.`,
        'Parágrafo primeiro. Encerrado o prazo, o LOCATÁRIO devolverá imediatamente o EQUIPAMENTO, salvo renovação expressa e escrita.',
        'Parágrafo segundo. A permanência do EQUIPAMENTO com o LOCATÁRIO após o término não caracteriza renovação automática, permanecendo exigíveis os aluguéis proporcionais e as demais obrigações.',
        'Parágrafo terceiro. Eventual prorrogação não importará novação das garantias, que permanecerão válidas até a devolução e a quitação integral.',
      ],
    },
    {
      title: 'CAPÍTULO V - DO PREÇO E DA FORMA DE PAGAMENTO',
      paragraphs: [
        `O LOCATÁRIO pagará ${data.financial.installmentCount} mensalidades de ${formatCurrency(data.financial.monthlyAmount)}, com primeiro vencimento em ${formatDate(data.firstInstallmentDate)}, nas datas do quadro financeiro.`,
        `A caução de ${formatCurrency(data.financial.depositAmount)} é uma entrada contratual paga separadamente das mensalidades, não integra a numeração das parcelas e compõe o valor total contratado de ${formatCurrency(data.financial.totalContract)}.`,
        'Parágrafo primeiro. O pagamento ocorrerá até a data de vencimento, independentemente de aviso, cobrança ou emissão de boleto.',
        'Parágrafo segundo. Considera-se realizado o pagamento somente após a efetiva disponibilidade do valor ao LOCADOR. Tarifas e encargos da forma de pagamento escolhida correrão por conta do LOCATÁRIO.',
        ...optionParagraphs,
      ],
    },
    {
      title: 'CAPÍTULO VI - DA MORA',
      paragraphs: [
        `O inadimplemento de obrigação pecuniária acarretará, independentemente de constituição em mora: I - multa moratória de ${data.financial.lateFeePercent}%; II - juros de mora de ${data.financial.dailyInterestPercent}% ao dia, conforme pactuado; III - correção monetária pelo IPCA ou índice oficial substituto; e IV - reembolso das despesas comprovadas de cobrança.`,
        'Parágrafo primeiro. A mora independe de notificação ou interpelação. Pagamentos parciais não importam quitação, permanecendo exigível o saldo remanescente.',
      ],
    },
    {
      title: 'CAPÍTULO VII - DA IMPUTAÇÃO DOS PAGAMENTOS',
      paragraphs: [
        'Qualquer valor pago será imputado, nesta ordem: I - despesas de cobrança; II - honorários advocatícios; III - custas e despesas administrativas; IV - juros; V - multa; VI - atualização monetária; VII - aluguel vencido; e VIII - demais encargos.',
      ],
    },
    {
      title: 'CAPÍTULO VIII - DAS OBRIGAÇÕES DO LOCADOR',
      paragraphs: [
        'Constituem obrigações do LOCADOR: I - entregar o EQUIPAMENTO em condições adequadas de uso, conforme Termo de Vistoria; II - fornecer informações para sua utilização regular; III - respeitar os limites legais aplicáveis à proteção patrimonial; e IV - receber o EQUIPAMENTO e realizar vistoria final ao término da locação.',
      ],
    },
    {
      title: 'CAPÍTULO IX - DAS OBRIGAÇÕES DO LOCATÁRIO',
      paragraphs: [
        'Constituem obrigações do LOCATÁRIO: I - pagar pontualmente os valores contratados; II - utilizar o EQUIPAMENTO para sua finalidade; III - conservá-lo e guardá-lo adequadamente; IV - não permitir uso habitual por terceiros sem autorização; V - comunicar dano, defeito, perda, roubo ou furto; VI - manter seus dados atualizados; e VII - devolver o EQUIPAMENTO nos termos deste contrato.',
      ],
    },
    {
      title: 'CAPÍTULO X - DAS VEDAÇÕES',
      paragraphs: [
        'É vedado ao LOCATÁRIO: I - vender, emprestar, locar ou ceder o EQUIPAMENTO; II - oferecê-lo em garantia; III - desmontá-lo ou substituir peças; IV - alterar o IMEI; V - realizar jailbreak, root ou desbloqueios; VI - remover etiquetas patrimoniais; VII - remover, desativar ou burlar o gerenciamento remoto; e VIII - instalar programas destinados a ocultar sua localização.',
        'Parágrafo único. O descumprimento desta cláusula constitui falta contratual grave.',
      ],
    },
    {
      title: 'CAPÍTULO XI - DA GUARDA E CONSERVAÇÃO',
      paragraphs: [
        'O LOCATÁRIO responderá pela guarda integral do EQUIPAMENTO e pelos danos decorrentes de negligência, imprudência, imperícia, mau uso, armazenamento inadequado ou utilização contrária às recomendações do fabricante.',
        'Parágrafo único. O desgaste natural decorrente do uso normal não caracteriza inadimplemento.',
      ],
    },
    {
      title: 'CAPÍTULO XII - DA COMUNICAÇÃO OBRIGATÓRIA',
      paragraphs: [
        'O LOCATÁRIO comunicará ao LOCADOR, em até 24 (vinte e quatro) horas: perda, furto, roubo, apreensão judicial, defeitos relevantes, danos físicos e alterações de endereço, telefone ou e-mail. A ausência de comunicação caracteriza inadimplemento contratual.',
      ],
    },
    {
      title: 'CAPÍTULO XIII - DA IMPOSSIBILIDADE DE COMPENSAÇÃO',
      paragraphs: [
        'É vedado ao LOCATÁRIO suspender pagamentos, reter valores ou compensar créditos sem autorização expressa e escrita do LOCADOR. Alegações de defeitos ou controvérsias não autorizam a interrupção unilateral dos aluguéis, ressalvadas as hipóteses legais.',
      ],
    },
    {
      title: 'CAPÍTULO XIV - DA RESPONSABILIDADE PELO EQUIPAMENTO',
      paragraphs: [
        'A partir da entrega, o LOCATÁRIO assume responsabilidade pela guarda, conservação e restituição do EQUIPAMENTO, respondendo por perda, extravio, furto, roubo, destruição, avaria, inutilização, deterioração ou redução de valor, ressalvadas as excludentes previstas em lei.',
        'Parágrafo primeiro. A responsabilidade subsistirá até a devolução efetiva e a aprovação da vistoria final. O simples registro de boletim de ocorrência não exonera a obrigação de indenizar quando cabível.',
      ],
    },
    {
      title: 'CAPÍTULO XV - DA PERDA, FURTO, ROUBO OU EXTRAVIO',
      paragraphs: [
        'Ocorrendo perda, furto, roubo ou extravio, o LOCATÁRIO deverá: I - comunicar imediatamente o LOCADOR; II - registrar boletim de ocorrência, quando cabível; III - encaminhá-lo em até 48 (quarenta e oito) horas; e IV - adotar medidas razoáveis para recuperação.',
        'Parágrafo único. A ocorrência não suspende as obrigações, que permanecem exigíveis até a efetiva indenização ou solução do evento.',
      ],
    },
    {
      title: 'CAPÍTULO XVI - DOS DANOS AO EQUIPAMENTO',
      paragraphs: [
        'O LOCATÁRIO responderá pelos danos causados durante a locação, inclusive quebra de tela, líquidos, oxidação, danos à placa lógica, quedas, avarias incompatíveis com desgaste natural, substituição de componentes e danos aos acessórios.',
        'Parágrafo primeiro. O LOCADOR poderá promover o reparo ou exigir a indenização. Se o reparo não for tecnicamente recomendável ou economicamente viável, será devido o valor integral de reposição.',
      ],
    },
    {
      title: 'CAPÍTULO XVII - DA DEVOLUÇÃO DO EQUIPAMENTO',
      paragraphs: [
        'Encerrada a locação, o LOCATÁRIO devolverá o EQUIPAMENTO e seus acessórios em até 48 (quarenta e oito) horas. A devolução somente se conclui após conferência física, inspeção técnica, conferência dos acessórios e emissão do Termo de Devolução.',
        'Parágrafo primeiro. A entrega física não implica quitação automática. Danos ocultos relacionados ao período da locação poderão ser cobrados após a inspeção técnica.',
      ],
    },
    {
      title: 'CAPÍTULO XVIII - DA VISTORIA FINAL',
      paragraphs: [
        'Recebido o EQUIPAMENTO, o LOCADOR verificará funcionamento, integridade física, acessórios, componentes internos e estado geral de conservação.',
        'Parágrafo primeiro. Constatadas avarias, será elaborado Laudo de Vistoria Final, assegurado ao LOCATÁRIO o prazo de 5 (cinco) dias úteis para manifestação. O silêncio não impedirá a cobrança dos valores apurados.',
      ],
    },
    {
      title: 'CAPÍTULO XIX - DA INDENIZAÇÃO',
      paragraphs: [
        `Na hipótese de perda total, destruição, extravio, retenção indevida ou impossibilidade de devolução, o LOCATÁRIO indenizará o LOCADOR pelo valor de reposição, tendo como referência contratual ${formatCurrency(data.device.indemnityValue)}.`,
        'Parágrafo primeiro. O valor será apurado sucessivamente pelo preço oficial do fabricante, preço de revendedores autorizados, média de três estabelecimentos especializados ou laudo de assistência autorizada. Se o modelo não for mais fabricado, será considerado equipamento equivalente.',
      ],
    },
    {
      title: 'CAPÍTULO XX - DO VENCIMENTO ANTECIPADO',
      paragraphs: [
        'Vencer-se-ão antecipadamente as obrigações em caso de atraso superior a 10 (dez) dias, descumprimento contratual, uso indevido, informações falsas, alienação ou cessão não autorizada, alteração de IMEI, perda ou destruição, recusa de devolução, fraude, insolvência, recuperação judicial ou falência, quando aplicável.',
        'Parágrafo único. Nessas hipóteses, o LOCADOR poderá exigir os valores devidos e a devolução imediata do EQUIPAMENTO, sem prejuízo de perdas e danos e observada a legislação aplicável.',
      ],
    },
    {
      title: 'CAPÍTULO XXI - DA PROTEÇÃO PATRIMONIAL',
      paragraphs: [
        `O LOCATÁRIO declara ciência de que o EQUIPAMENTO está com Apple Business / MDM em situação "${data.device.mdmStatus}" e poderá possuir mecanismos destinados exclusivamente à proteção patrimonial, localização, rastreamento, identificação, gerenciamento e bloqueio operacional.`,
        'Parágrafo primeiro. Em caso de inadimplemento, perda, furto, roubo, retenção indevida ou fundada suspeita de uso irregular, o LOCADOR poderá adotar medidas tecnológicas compatíveis com a preservação de seu patrimônio, observada a legislação.',
        'Parágrafo segundo. Essas medidas não autorizam acesso a dados pessoais, arquivos, comunicações, fotografias, vídeos, documentos ou informações privadas do LOCATÁRIO.',
        'Parágrafo terceiro. O LOCATÁRIO não poderá remover, adulterar ou inutilizar sistemas de rastreamento, identificação ou gerenciamento instalados.',
      ],
    },
    {
      title: 'CAPÍTULO XXII - DAS DISPOSIÇÕES GERAIS',
      paragraphs: [
        'A tolerância quanto ao descumprimento constituirá mera liberalidade, sem renúncia, novação ou alteração. A nulidade de uma cláusula não prejudicará as demais. Este contrato obriga partes, herdeiros e sucessores, sendo vedada a cessão pelo LOCATÁRIO sem autorização escrita.',
        'O LOCADOR poderá ceder os créditos decorrentes deste contrato a terceiros, permanecendo inalteradas as condições pactuadas.',
      ],
    },
    {
      title: 'CAPÍTULO XXIII - DO FORO',
      paragraphs: [
        `Fica eleito o foro da Comarca de ${data.venue || 'domicílio do LOCADOR'}, com renúncia a qualquer outro, por mais privilegiado que seja, ressalvadas as regras legais de competência.`,
        'E, por estarem justos e contratados, firmam este instrumento em 3 (três) vias de igual teor e forma, juntamente com duas testemunhas, para que produza seus efeitos legais.',
      ],
    },
  ];
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
