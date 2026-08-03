import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const finiteValue = (value: number | null | undefined): number => Number.isFinite(Number(value)) ? Number(value) : 0;

export const formatCurrency = (value: number | null | undefined): string => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(finiteValue(value));

export const formatPercentage = (value: number | null | undefined): string => `${new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(finiteValue(value))}%`;

export const formatMonths = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(value))} meses`;
};

export const formatDate = (value: string | null | undefined): string => {
  if (!value) return '-';
  return format(parseISO(value), 'dd/MM/yyyy', { locale: ptBR });
};

export const formatMonthLabel = (month: string): string => format(parseISO(`${month}-01`), "MMMM 'de' yyyy", { locale: ptBR });

export const monthKey = (date = new Date()): string => format(date, 'yyyy-MM');

export const cleanCpf = (value: string): string => value.replace(/\D/g, '');

export const displayCpf = (value: string): string => {
  const digits = cleanCpf(value);
  if (digits.length !== 11) return value;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};
