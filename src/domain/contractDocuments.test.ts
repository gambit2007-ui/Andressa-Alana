import { describe, expect, it, vi } from 'vitest';
import { generateInitialContractDocuments } from './contractDocuments';

describe('geracao posterior ao salvamento do contrato', () => {
  it('preserva o contrato quando um documento falha', async () => {
    const generate = vi.fn().mockResolvedValueOnce('contrato.pdf').mockRejectedValueOnce(new Error('falha no termo'));
    const result = await generateInitialContractDocuments('contrato-ja-salvo', generate);
    expect(result.contractId).toBe('contrato-ja-salvo');
    expect(result.documentsOk).toBe(false);
    expect(result.results.map((item) => item.status)).toEqual(['fulfilled', 'rejected']);
  });
});
