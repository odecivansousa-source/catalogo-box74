-- =====================================================================
-- BOX74 - Migração: Tabela Segura de Credenciais Meta WhatsApp
-- Armazenamento confidencial no backend com Row Level Security (RLS)
-- Acesso anônimo/público estritamente revogado; exclusivo para service_role
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.box74_meta_credentials (
  id TEXT PRIMARY KEY DEFAULT 'active_whatsapp_integration',
  phone_number TEXT NOT NULL,
  phone_number_display TEXT NOT NULL,
  phone_number_id TEXT,
  waba_id TEXT,
  access_token TEXT,
  status TEXT NOT NULL DEFAULT 'preparado', -- 'preparado', 'autorizado', 'ativo'
  coexistence_status TEXT NOT NULL DEFAULT 'preparado', -- 'preparado', 'autorizado', 'ativo'
  coexistence_enabled BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ativação obrigatória de Row Level Security (RLS)
ALTER TABLE public.box74_meta_credentials ENABLE ROW LEVEL SECURITY;

-- 1. Revogação expressa de qualquer acesso anônimo ou público
REVOKE ALL ON public.box74_meta_credentials FROM anon;
REVOKE ALL ON public.box74_meta_credentials FROM public;

-- 2. Concessão de permissão total para a role administrativa de serviço (backend)
GRANT ALL ON public.box74_meta_credentials TO service_role;

-- 3. Limpeza de políticas prévias para evitar duplicação ou conflitos
DROP POLICY IF EXISTS "Acesso exclusivo de servico para credenciais Meta" ON public.box74_meta_credentials;
DROP POLICY IF EXISTS "Acesso exclusivo backend service_role" ON public.box74_meta_credentials;

-- 4. Política RLS: restrita exclusivamente ao backend via service_role
CREATE POLICY "Acesso exclusivo backend service_role"
ON public.box74_meta_credentials
FOR ALL
TO service_role
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
