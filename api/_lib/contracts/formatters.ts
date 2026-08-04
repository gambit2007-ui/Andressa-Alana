export const formatCurrency = (value: number): string => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(value);

export const formatDate = (value: string | null | undefined): string => {
  if (!value) return 'Não informado';
  const normalized = value.includes('T') ? value.slice(0, 10) : value;
  const [year, month, day] = normalized.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
};

export const sanitizePdfText = (value: string | null | undefined): string => (
  value?.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim() || 'Não informado'
);

export const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
