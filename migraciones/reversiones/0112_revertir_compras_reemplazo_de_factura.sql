-- 0112_revertir_compras_reemplazo_de_factura: quita el vínculo «reemplaza a» de 0112. FRENA (55000) si ya hay reemplazos. AVISAR AL DUEÑO antes de correrla con datos.
-- Se corre en UNA sola transacción, con el dueño de la base (evade RLS: sin eso el conteo no vería las facturas de las empresas y la reversión pasaría con datos). Se puede repetir sin que cambie nada.
DO $$
DECLARE
  v_reemplazos bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'comprobante_de_proveedor' AND column_name = 'reemplaza_a_id') THEN
    EXECUTE 'SELECT count(*) FROM public.comprobante_de_proveedor WHERE reemplaza_a_id IS NOT NULL' INTO v_reemplazos;
  END IF;
  IF v_reemplazos > 0 THEN
    RAISE EXCEPTION 'hay % facturas con reemplazo: no se revierte sin decisión del dueño', v_reemplazos USING ERRCODE = '55000';
  END IF;
END
$$;
DROP TRIGGER IF EXISTS comprobante_reemplazo_valida ON public.comprobante_de_proveedor;
DROP FUNCTION IF EXISTS public.compras_reemplazo_valida();
DROP INDEX IF EXISTS public.cp_reemplazo_vigente_uk;
DROP INDEX IF EXISTS public.cp_reemplaza_ix;
ALTER TABLE IF EXISTS public.comprobante_de_proveedor DROP CONSTRAINT IF EXISTS cp_reemplaza_ck;
ALTER TABLE IF EXISTS public.comprobante_de_proveedor DROP CONSTRAINT IF EXISTS cp_reemplaza_fkey;
ALTER TABLE IF EXISTS public.comprobante_de_proveedor DROP COLUMN IF EXISTS reemplaza_a_id;
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0112_compras_reemplazo_de_factura.sql';
  END IF;
END
$$;
