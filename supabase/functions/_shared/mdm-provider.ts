export type MdmCommandInput = { deviceId: string; command: string; reason: string };
export type MdmCommandResult = { reference: string; status: 'executed' | 'failed'; payload: Record<string, unknown> };

export interface MDMProvider {
  sendCommand(input: MdmCommandInput): Promise<MdmCommandResult>;
}

export class MockMDMProvider implements MDMProvider {
  async sendCommand(input: MdmCommandInput): Promise<MdmCommandResult> {
    return {
      reference: `mock-${crypto.randomUUID()}`,
      status: 'executed',
      payload: { simulated: true, deviceId: input.deviceId, command: input.command },
    };
  }
}

export class MosyleMDMProvider implements MDMProvider {
  async sendCommand(_input: MdmCommandInput): Promise<MdmCommandResult> {
    const baseUrl = Deno.env.get('MOSYLE_BASE_URL');
    const token = Deno.env.get('MOSYLE_API_TOKEN');
    if (!baseUrl || !token) throw new Error('Mosyle nao configurado. Mantenha MDM_PROVIDER=mock ate validar credenciais e endpoints oficiais.');
    throw new Error('Provider Mosyle e um esqueleto seguro; implemente somente com a documentacao oficial do tenant.');
  }
}

export const getMdmProvider = (): MDMProvider => Deno.env.get('MDM_PROVIDER') === 'mosyle' ? new MosyleMDMProvider() : new MockMDMProvider();
