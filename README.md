# GR Solution Rental

Aplicacao empresarial para locacao de iPhones, com autenticacao, organizacoes, perfis, clientes, frota, contratos, parcelas, pagamentos, rentabilidade, cobranca e MDM.

## Stack

- Vite, React 19 e TypeScript strict
- Tailwind CSS 4, Lucide e Motion
- React Hook Form + Zod
- TanStack Query
- Supabase Auth, PostgreSQL, Storage e Edge Functions
- Vercel para o frontend SPA e funcoes server-side de documentos
- Vitest para regras de negocio

## Infraestrutura preservada

Este repositorio ja possuia as tabelas de estetica `clients`, `procedures`, `appointments` e `expenses`. Elas nao sao removidas nem renomeadas.

Como `public.clients` ja existia com ID numerico, o modulo de locacao usa `public.rental_clients` com UUID. Essa decisao evita conversao destrutiva e preserva os dados implantados. A migration incremental esta em:

`supabase/migrations/202607130001_gr_solution_rental.sql`

O modulo de documentos contratuais usa uma segunda migration incremental, sem alterar os contratos historicos:

`supabase/migrations/202608040001_contract_pdf_module.sql`

## Configuracao local

1. Instale as dependencias:

```bash
npm install
```

2. Crie `.env.local` com variaveis publicas:

```env
VITE_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Para testar localmente as funcoes server-side de PDF, configure tambem as variaveis privadas abaixo no ambiente da funcao. Nunca use o prefixo `VITE_` nessas chaves:

```env
SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

3. Aplique a migration no projeto Supabase existente. Nao use `db reset`:

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Se preferir, execute o conteudo da migration uma unica vez no SQL Editor do Supabase. O seed em `supabase/seed.sql` e opcional e deve ser usado somente em desenvolvimento/homologacao.

4. Inicie o frontend:

```bash
npm run dev
```

## Autenticacao e perfis

A migration cria a organizacao inicial `GR Solution` e associa usuarios existentes. O primeiro usuario recebe `admin`; os demais recebem `operator`.

Perfis disponiveis:

- `admin`: administracao e comandos destrutivos MDM
- `manager`: gestao operacional
- `finance`: pagamentos, estornos e caixa
- `operator`: clientes, aparelhos e contratos
- `viewer`: somente leitura

No Supabase, configure em Authentication > URL Configuration:

- Site URL: dominio de producao da Vercel
- Redirect URLs: dominio de producao e URL local

## Storage privado

A migration cria os buckets privados:

- `client-documents`
- `device-photos`
- `contracts`
- `inspections`
- `receipts`
- `invoices`

Os objetos sao isolados pelo primeiro segmento do caminho, que deve ser o UUID da organizacao. Documentos de clientes sao enviados de verdade pelo frontend e nao ficam em `localStorage` ou base64 no banco.

Os PDFs contratuais ficam no bucket privado `contracts`, versionados no caminho `organizacao/contrato/tipo/versao.pdf`. O acesso ocorre apenas por URL assinada temporaria e cada geracao fica registrada em `contract_documents`.

## Documentos dos contratos

Ao criar um contrato novo, o sistema salva primeiro os dados transacionais e depois solicita, de forma independente, os dois documentos:

- contrato de locacao
- termo de entrega e vistoria

Uma falha de PDF nao desfaz o contrato nem suas parcelas. O documento fica com status de falha e pode ser regenerado pela tela do contrato. Contratos historicos continuam com a regra financeira original; contratos novos registram a caucao separadamente e geram somente a quantidade informada de mensalidades.

Endpoints autenticados:

- `POST /api/contracts/:id/generate-pdf`
- `POST /api/contracts/:id/generate-delivery-term`

## Edge Functions

Funcoes disponiveis:

- `mark-overdue-installments`
- `billing-run`
- `mdm-sync`
- `mdm-command`
- `release-device`

Configure secrets somente no Supabase:

```bash
npx supabase secrets set BILLING_CRON_SECRET=um-segredo-longo MDM_PROVIDER=mock
```

Publique as funcoes:

```bash
npx supabase functions deploy mark-overdue-installments
npx supabase functions deploy billing-run
npx supabase functions deploy mdm-sync
npx supabase functions deploy mdm-command
npx supabase functions deploy release-device
```

Para Mosyle, mantenha `MDM_PROVIDER=mock` ate validar os endpoints oficiais do tenant. Depois configure `MOSYLE_BASE_URL` e `MOSYLE_API_TOKEN` como secrets e complete o esqueleto `MosyleMDMProvider`.

## Vercel

O arquivo `vercel.json` preserva o build Vite, o fallback SPA e as rotas das funcoes. Configure as variaveis abaixo no projeto Vercel para Production, Preview e Development:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_NAME` (opcional)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`SUPABASE_SERVICE_ROLE_KEY` e usada somente pelas funcoes server-side em `api/`. Ela nao pode ter prefixo `VITE_`, nao deve ser commitada e nunca deve ser enviada ao navegador. As funcoes validam o token do usuario, a organizacao e a permissao antes de usar a chave privilegiada.

Depois de alterar variaveis, faca um novo deploy para que o Vite as incorpore no build.

## O que e real e o que e mock

| Recurso | Estado |
| --- | --- |
| Login, logout e recuperacao de senha | Real, Supabase Auth |
| Clientes, aparelhos, contratos, parcelas e pagamentos | Real, PostgreSQL + RLS |
| Upload de documentos | Real, Supabase Storage privado |
| Geracao de contrato e parcelas | Real, transacao PostgreSQL |
| PDFs de contrato e termo de entrega | Real, Vercel Functions + `pdf-lib` + Storage privado |
| Historico e regeneracao de PDFs | Real, versoes auditadas em `contract_documents` |
| Pagamento parcial/integral e estorno | Real, RPC auditada |
| Regua de cobranca | Registra simulacoes; nao envia WhatsApp/email/Pix |
| MDM | `MockMDMProvider`; nao bloqueia nem apaga aparelho real |
| Mosyle | Esqueleto seguro, depende de credenciais e documentacao oficial |
| Liberacao Apple Business | Registro interno manual; nao afirma acao externa |

## Validacao

```bash
npm run lint
npm run test
npm run build
```

Os testes cobrem dias 29/30/31, fevereiro e ano bissexto, multa e juros, pagamentos parcial/integral, caucao separada, venda, ROI, payback, transicoes, permissoes MDM, clausulas condicionais, versionamento, tolerancia a falha e geracao real dos dois PDFs.
