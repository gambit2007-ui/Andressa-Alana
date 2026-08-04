import type { ApiRequest, ApiResponse } from '../http-types';
import { DocumentServiceError, generateAndStoreContractDocument } from './document-service';

export async function handleContractDocumentRequest(
  request: ApiRequest,
  response: ApiResponse,
  documentType: 'rental_contract' | 'delivery_term',
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Metodo nao permitido.' });
    return;
  }

  const authorization = request.headers.authorization;
  const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!accessToken) {
    response.status(401).json({ error: 'Autenticacao obrigatoria.' });
    return;
  }

  const idParam = request.query.id;
  const contractId = Array.isArray(idParam) ? idParam[0] : idParam;
  const body = request.body as { reason?: unknown } | null;
  const reason = typeof body?.reason === 'string' ? body.reason : null;

  try {
    const result = await generateAndStoreContractDocument({
      contractId: contractId ?? '',
      documentType,
      accessToken,
      reason,
    });
    response.status(201).json(result);
  } catch (error) {
    if (error instanceof DocumentServiceError) {
      response.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    response.status(500).json({ error: 'Nao foi possivel gerar o documento.', code: 'unexpected_error' });
  }
}
