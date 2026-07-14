# GR Solution Rental

Aplicacao empresarial para locacao de iPhones, com autenticacao, organizacoes, perfis, clientes, frota, contratos, parcelas, pagamentos, rentabilidade, cobranca e MDM.

## Stack

- Vite, React 19 e TypeScript strict
- Tailwind CSS 4, Lucide e Motion
- React Hook Form + Zod
- TanStack Query
- Supabase Auth, PostgreSQL, Storage e Edge Functions
- Vercel para o frontend SPA
- Vitest para regras de negocio

## Infraestrutura preservada

Este repositorio ja possuia as tabelas de estetica `clients`, `procedures`, `appointments` e `expenses`. Elas nao sao removidas nem renomeadas.

Como `public.clients` ja existia com ID numerico, o modulo de locacao usa `public.rental_clients` com UUID. Essa decisao evita conversao destrutiva e preserva os dados implantados. A migration incremental esta em:

`supabase/migrations/202607130001_gr_solution_rental.sql`

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

O arquivo `vercel.json` preserva build Vite e fallback SPA. Configure apenas variaveis publicas no projeto Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_NAME` (opcional)

`SUPABASE_SERVICE_ROLE_KEY` nao e usada pelo frontend e deve ser removida das variaveis da Vercel. A chave privilegiada existe apenas no ambiente seguro das Edge Functions, onde o Supabase a fornece automaticamente.

Depois de alterar variaveis, faca um novo deploy para que o Vite as incorpore no build.

## O que e real e o que e mock

| Recurso | Estado |
| --- | --- |
| Login, logout e recuperacao de senha | Real, Supabase Auth |
| Clientes, aparelhos, contratos, parcelas e pagamentos | Real, PostgreSQL + RLS |
| Upload de documentos | Real, Supabase Storage privado |
| Geracao de contrato e parcelas | Real, transacao PostgreSQL |
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

Os testes cobrem dias 29/30/31, fevereiro e ano bissexto, multa e juros, pagamentos parcial/integral, caucao, venda, ROI, payback, transicoes e permissoes MDM.
