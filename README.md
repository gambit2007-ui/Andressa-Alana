# Andressa Alana Gestao de Estetica

Base web para gestao de clinica de estetica com frontend em React + Vite e API em Express para Vercel.

## Stack

- Frontend: React 19 + Vite + Tailwind
- API: Express em `api/[...path].ts`
- Banco: Supabase (PostgreSQL)

## Configuracao local

1. Instale dependencias:
   `npm install`
2. Copie `.env.example` para `.env.local` e preencha:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Crie as tabelas no Supabase executando o SQL de `supabase/schema.sql`.
4. Rode o projeto:
   `npm run dev`

## Endpoints

A API responde em `/api/*` com os modulos:

- `clients`
- `procedures`
- `appointments`
- `expenses`
- `stats`
- `finances`

## Deploy na Vercel

1. Conecte o repositorio na Vercel.
2. Configure variaveis de ambiente:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `FINANCE_YEAR` (opcional)
3. Faça deploy.

O dominio padrao sera algo como: `https://<projeto>.vercel.app`.
