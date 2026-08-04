import type { ApiRequest, ApiResponse } from './_lib/http-types';
import { handleContractDocumentRequest } from './_lib/contracts/handler';

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  await handleContractDocumentRequest(request, response, 'delivery_term');
}
