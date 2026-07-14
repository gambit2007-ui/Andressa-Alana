import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export const formatCurrency = (value: number): string => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(value);

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
