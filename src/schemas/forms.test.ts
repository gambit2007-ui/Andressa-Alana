import { describe, expect, it } from 'vitest';
import { directDeviceSaleSchema } from './forms';

const validSale = {
  device_id: 'device-1',
  client_id: 'client-1',
  sale_amount: 4200,
  sold_at: '2026-08-05T19:30',
  payment_method: 'pix' as const,
  serial_confirmation: 'ABC123',
  apple_release_confirmed: true,
  notes: '',
};

describe('formulario de venda direta', () => {
  it('aceita uma venda quitada com os dados obrigatorios', () => {
    expect(directDeviceSaleSchema.safeParse(validSale).success).toBe(true);
  });

  it('rejeita venda sem valor positivo ou confirmacao de serie', () => {
    const result = directDeviceSaleSchema.safeParse({
      ...validSale,
      sale_amount: 0,
      serial_confirmation: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining(['sale_amount', 'serial_confirmation']),
      );
    }
  });
});
