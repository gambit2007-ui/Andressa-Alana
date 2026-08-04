import type { ContractDocumentType } from '../types';

const initialDocumentTypes: ContractDocumentType[] = ['rental_contract', 'delivery_term'];

export async function generateInitialContractDocuments<T>(
  contractId: string,
  generate: (contractId: string, type: ContractDocumentType) => Promise<T>,
): Promise<{ contractId: string; documentsOk: boolean; results: PromiseSettledResult<T>[] }> {
  const results = await Promise.allSettled(
    initialDocumentTypes.map((type) => generate(contractId, type)),
  );
  return { contractId, documentsOk: results.every((result) => result.status === 'fulfilled'), results };
}
