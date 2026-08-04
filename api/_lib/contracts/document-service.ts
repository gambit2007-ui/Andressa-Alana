import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { calculateFinancialSummary, canGenerateForOrganization } from './content';
import { generateContractPdf } from './generate-contract-pdf';
import { generateDeliveryTermPdf } from './generate-delivery-term-pdf';
import type {
  ContractDocumentRow,
  ContractInstallment,
  ContractPdfData,
  ContractPhoto,
  DeliveryChecklist,
} from './types';

type DocumentType = 'rental_contract' | 'delivery_term';

type ProfileRow = {
  id: string;
  organization_id: string;
  role: 'admin' | 'manager' | 'operator' | 'finance' | 'viewer';
  active: boolean;
};

type ContractRow = {
  id: string;
  organization_id: string;
  contract_number: string;
  start_date: string;
  end_date: string;
  first_installment_date: string | null;
  term_months: number | string;
  monthly_amount: number | string;
  deposit_amount: number | string;
  late_fee_percent: number | string;
  daily_interest_percent: number | string;
  indemnity_value: number | string | null;
  purchase_option: boolean;
  purchase_option_amount: number | string | null;
  client: {
    id: string;
    full_name: string;
    cpf: string;
    rg: string | null;
    birth_date: string | null;
    phone: string;
    secondary_phone: string | null;
    email: string | null;
    address_line: string | null;
    address_number: string | null;
    address_complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    work_address: string | null;
    reference_name: string | null;
    reference_phone: string | null;
  };
  device: {
    id: string;
    model: string;
    capacity_gb: number;
    color: string;
    battery_health: number;
    imei_1: string;
    imei_2: string | null;
    serial_number: string;
    condition: string;
    indemnity_value: number | string | null;
    market_value: number | string;
    notes: string | null;
    mdm_enrolled: boolean;
    accessories: string[] | null;
  };
  organization: { id: string; name: string };
};

type InstallmentRow = {
  installment_number: number;
  due_date: string;
  original_amount: number | string;
  paid_amount: number | string;
  status: string;
  payments: Array<{ paid_at: string; status: string }> | null;
};

type SettingsRow = {
  legal_name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  default_venue: string | null;
};

const uuidSchema = z.string().uuid();
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

export class DocumentServiceError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = 'document_error') {
    super(message);
  }
}

function getAdminClient(): SupabaseClient {
  const env = envSchema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!env.success) throw new DocumentServiceError('Servico de documentos nao configurado.', 503, 'missing_server_env');
  return createClient(env.data.SUPABASE_URL, env.data.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticate(admin: SupabaseClient, token: string): Promise<ProfileRow> {
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new DocumentServiceError('Sessao invalida ou expirada.', 401, 'invalid_session');

  const { data, error } = await admin.from('profiles').select('id,organization_id,role,active')
    .eq('id', userData.user.id).eq('active', true).single();
  if (error || !data) throw new DocumentServiceError('Perfil ativo nao encontrado.', 403, 'profile_not_found');
  const profile = data as ProfileRow;
  if (!['admin', 'manager', 'operator'].includes(profile.role)) {
    throw new DocumentServiceError('Sem permissao para gerar documentos.', 403, 'forbidden');
  }
  return profile;
}

const money = (value: number | string | null | undefined): number => Number(value ?? 0);
const joinAddress = (...parts: Array<string | null | undefined>): string | null => {
  const value = parts.filter((part) => part?.trim()).join(', ');
  return value || null;
};

async function loadPhotos(admin: SupabaseClient, deviceId: string, organizationId: string): Promise<ContractPhoto[]> {
  const { data, error } = await admin.from('device_photos')
    .select('storage_path,caption')
    .eq('organization_id', organizationId)
    .eq('device_id', deviceId)
    .order('created_at')
    .limit(6);
  if (error) throw new DocumentServiceError('Nao foi possivel consultar as fotos.', 500, 'photo_query_failed');

  const photos = await Promise.all((data ?? []).map(async (row) => {
    const { data: file, error: downloadError } = await admin.storage.from('device-photos').download(String(row.storage_path));
    if (downloadError || !file) return null;
    return {
      caption: String(row.caption || 'Foto do aparelho'),
      mimeType: file.type || (String(row.storage_path).toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'),
      bytes: new Uint8Array(await file.arrayBuffer()),
    } satisfies ContractPhoto;
  }));
  return photos.filter((photo): photo is ContractPhoto => photo !== null);
}

async function assemblePdfData(admin: SupabaseClient, contractId: string, profile: ProfileRow): Promise<ContractPdfData> {
  const { data: contractData, error: contractError } = await admin.from('contracts').select(`
    *,
    client:rental_clients(*),
    device:devices(*),
    organization:organizations(id,name)
  `).eq('id', contractId).eq('organization_id', profile.organization_id).single();
  if (contractError || !contractData) throw new DocumentServiceError('Contrato nao encontrado.', 404, 'contract_not_found');
  const contract = contractData as unknown as ContractRow;
  if (!canGenerateForOrganization({
    profileOrganizationId: profile.organization_id,
    contractOrganizationId: contract.organization_id,
    role: profile.role,
  })) throw new DocumentServiceError('Sem permissao para acessar este contrato.', 403, 'organization_mismatch');

  const [installmentsResult, settingsResult, inspectionResult, mdmResult, photos] = await Promise.all([
    admin.from('installments').select('installment_number,due_date,original_amount,paid_amount,status,payments(paid_at,status)')
      .eq('contract_id', contract.id).order('installment_number'),
    admin.from('organization_contract_settings').select('legal_name,tax_id,address,phone,email,city,default_venue')
      .eq('organization_id', profile.organization_id).maybeSingle(),
    admin.from('inspections').select('checklist').eq('contract_id', contract.id).eq('inspection_type', 'delivery').maybeSingle(),
    admin.from('mdm_devices').select('status').eq('device_id', contract.device.id).maybeSingle(),
    loadPhotos(admin, contract.device.id, profile.organization_id),
  ]);
  if (installmentsResult.error) throw new DocumentServiceError('Nao foi possivel consultar as mensalidades.', 500, 'installment_query_failed');

  const installments = (installmentsResult.data ?? [] as unknown[]).map((row) => {
    const item = row as unknown as InstallmentRow;
    const confirmed = item.payments?.filter((payment) => payment.status === 'confirmed').sort((a, b) => b.paid_at.localeCompare(a.paid_at));
    return {
      number: Number(item.installment_number),
      dueDate: item.due_date,
      amount: money(item.original_amount),
      status: item.status,
      paidAmount: money(item.paid_amount),
      paidAt: confirmed?.[0]?.paid_at ?? null,
    } satisfies ContractInstallment;
  });

  const indemnityValue = money(contract.indemnity_value ?? contract.device.indemnity_value ?? contract.device.market_value);
  if (!contract.client?.id || !contract.device?.id || money(contract.monthly_amount) <= 0 || Number(contract.term_months) <= 0 || indemnityValue <= 0) {
    throw new DocumentServiceError('Complete os dados obrigatorios do contrato antes de gerar o PDF.', 422, 'missing_contract_data');
  }

  const settings = settingsResult.data as SettingsRow | null;
  const financial = calculateFinancialSummary({
    depositAmount: money(contract.deposit_amount),
    monthlyAmount: money(contract.monthly_amount),
    installmentCount: Number(contract.term_months),
    installments,
    lateFeePercent: money(contract.late_fee_percent),
    dailyInterestPercent: money(contract.daily_interest_percent),
    purchaseOption: Boolean(contract.purchase_option),
    purchaseOptionAmount: contract.purchase_option_amount === null ? null : money(contract.purchase_option_amount),
  });

  return {
    contractId: contract.id,
    contractNumber: contract.contract_number,
    issuedAt: new Date().toISOString(),
    startDate: contract.start_date,
    endDate: contract.end_date,
    firstInstallmentDate: contract.first_installment_date ?? installments[0]?.dueDate ?? contract.start_date,
    venue: settings?.default_venue || settings?.city || null,
    lessor: {
      name: settings?.legal_name || contract.organization.name,
      taxId: settings?.tax_id || null,
      phone: settings?.phone || null,
      email: settings?.email || null,
      address: settings?.address || null,
    },
    lessee: {
      name: contract.client.full_name,
      taxId: contract.client.cpf,
      rg: contract.client.rg,
      birthDate: contract.client.birth_date,
      phone: contract.client.phone,
      secondaryPhone: contract.client.secondary_phone,
      email: contract.client.email,
      address: joinAddress(
        contract.client.address_line,
        contract.client.address_number,
        contract.client.address_complement,
        contract.client.neighborhood,
        contract.client.city,
        contract.client.state,
        contract.client.postal_code,
      ),
      workAddress: contract.client.work_address,
      reference: joinAddress(contract.client.reference_name, contract.client.reference_phone),
    },
    device: {
      model: contract.device.model,
      capacityGb: Number(contract.device.capacity_gb),
      color: contract.device.color,
      batteryHealth: Number(contract.device.battery_health),
      imei1: contract.device.imei_1,
      imei2: contract.device.imei_2,
      serialNumber: contract.device.serial_number,
      condition: contract.device.condition,
      indemnityValue,
      notes: contract.device.notes,
      mdmStatus: String(mdmResult.data?.status || (contract.device.mdm_enrolled ? 'Ativo' : 'Desativado')),
      accessories: Array.isArray(contract.device.accessories) ? contract.device.accessories : [],
    },
    financial,
    installments,
    checklist: (inspectionResult.data?.checklist ?? {}) as DeliveryChecklist,
    photos,
  };
}

export async function generateAndStoreContractDocument(input: {
  contractId: string;
  documentType: DocumentType;
  accessToken: string;
  reason?: string | null;
}): Promise<{ document: ContractDocumentRow; signedUrl: string }> {
  const parsedId = uuidSchema.safeParse(input.contractId);
  if (!parsedId.success) throw new DocumentServiceError('Contrato invalido.', 400, 'invalid_contract_id');
  const admin = getAdminClient();
  const profile = await authenticate(admin, input.accessToken);
  const reason = input.reason?.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 250) || null;
  const pdfData = await assemblePdfData(admin, parsedId.data, profile);

  const { data: reservationData, error: reservationError } = await admin.rpc('reserve_contract_document', {
    p_organization_id: profile.organization_id,
    p_contract_id: parsedId.data,
    p_document_type: input.documentType,
    p_actor_id: profile.id,
    p_reason: reason,
  });
  if (reservationError || !reservationData) throw new DocumentServiceError('Nao foi possivel iniciar a versao do documento.', 500, 'version_reservation_failed');
  const reservation = reservationData as unknown as ContractDocumentRow;

  try {
    const bytes = input.documentType === 'rental_contract'
      ? await generateContractPdf(pdfData)
      : await generateDeliveryTermPdf(pdfData);
    const { error: uploadError } = await admin.storage.from('contracts').upload(reservation.storage_path, bytes, {
      contentType: 'application/pdf',
      upsert: false,
      cacheControl: '3600',
    });
    if (uploadError) throw new DocumentServiceError('Nao foi possivel salvar o PDF.', 500, 'storage_upload_failed');

    const { data: completedData, error: completeError } = await admin.rpc('complete_contract_document', {
      p_document_id: reservation.id,
      p_metadata: { page_format: 'A4', bytes: bytes.length, generator: 'pdf-lib' },
    });
    if (completeError || !completedData) {
      await admin.storage.from('contracts').remove([reservation.storage_path]);
      throw new DocumentServiceError('Nao foi possivel concluir a versao do documento.', 500, 'version_completion_failed');
    }
    const document = completedData as unknown as ContractDocumentRow;
    const { data: signedData, error: signedError } = await admin.storage.from('contracts').createSignedUrl(document.storage_path, 300);
    return { document, signedUrl: signedError ? '' : (signedData?.signedUrl ?? '') };
  } catch (error) {
    await admin.rpc('fail_contract_document', {
      p_document_id: reservation.id,
      p_error_code: error instanceof DocumentServiceError ? error.code : 'generation_failed',
    });
    console.error(JSON.stringify({
      event: 'contract_document_generation_failed',
      contractId: parsedId.data,
      documentType: input.documentType,
      code: error instanceof DocumentServiceError ? error.code : 'generation_failed',
    }));
    throw error;
  }
}
