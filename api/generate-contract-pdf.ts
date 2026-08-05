import type { ApiRequest, ApiResponse } from './_lib/http-types.js';
import { handleContractDocumentRequest } from './_lib/contracts/handler.js';

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  await handleContractDocumentRequest(request, response, 'rental_contract');
}
