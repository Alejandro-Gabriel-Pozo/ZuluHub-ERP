-- 0111_revertir_compras_notas_de_debito: deja 0085 como estaba (restricción de vínculo, tope sin filtrar por clase, sin el disparador de la nota de débito). FRENA (55000) si hay notas de débito: avisar al dueño antes de correrla con datos.
-- Se corre en UNA sola transacción, con el dueño de la base (evade RLS: sin eso el conteo de notas de débito no vería las filas de las empresas y la reversión pasaría con datos). Se puede repetir sin que cambie nada.
DO $$
DECLARE
  v_notas bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.comprobante_de_proveedor') IS NOT NULL THEN
    SELECT count(*) INTO v_notas FROM public.comprobante_de_proveedor WHERE clase = 'NOTA_DE_DEBITO';
  END IF;
  IF v_notas > 0 THEN
    RAISE EXCEPTION 'hay % notas de débito: no se revierte sin decisión del dueño', v_notas USING ERRCODE = '55000';
  END IF;
END
$$;
DO $$
BEGIN
  IF to_regclass('public.comprobante_de_proveedor') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS comprobante_nota_de_debito_valida ON public.comprobante_de_proveedor;
    ALTER TABLE public.comprobante_de_proveedor DROP CONSTRAINT IF EXISTS cp_asociado_ck;
    ALTER TABLE public.comprobante_de_proveedor ADD CONSTRAINT cp_asociado_ck CHECK ((clase = 'NOTA_DE_CREDITO') = (comprobante_asociado_id IS NOT NULL));
  END IF;
END
$$;
DROP FUNCTION IF EXISTS public.compras_nota_de_debito_valida();
-- Restaura el cuerpo de 0085 (la suma sin filtro por clase: sin notas de débito vinculadas es equivalente). Copia exacta de `migraciones/0085_compras_notas_de_credito.sql`.
CREATE OR REPLACE FUNCTION compras_nota_de_credito_valida() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_estado text;
  v_proveedor uuid;
  v_total numeric(18,2);
  v_acreditado numeric(18,2);
BEGIN
  IF NEW.clase <> 'NOTA_DE_CREDITO' THEN
    RETURN NEW;
  END IF;
  SELECT c.clase, c.estado, c.proveedor_id, c.total_segun_factura INTO v_clase, v_estado, v_proveedor, v_total
    FROM public.comprobante_de_proveedor c WHERE c.id = NEW.comprobante_asociado_id AND c.empresa_id = NEW.empresa_id FOR UPDATE;
  IF v_clase IS DISTINCT FROM 'FACTURA' THEN
    RAISE EXCEPTION 'la nota de crédito corrige una factura de la empresa' USING ERRCODE = '23514', CONSTRAINT = 'nota_de_credito_sin_factura';
  END IF;
  IF v_estado <> 'REGISTRADO' THEN
    RAISE EXCEPTION 'la factura que corrige la nota de crédito está anulada' USING ERRCODE = '23514', CONSTRAINT = 'nota_de_credito_de_factura_anulada';
  END IF;
  IF v_proveedor <> NEW.proveedor_id THEN
    RAISE EXCEPTION 'la nota de crédito y su factura son de proveedores distintos' USING ERRCODE = '23514', CONSTRAINT = 'nota_de_credito_de_otro_proveedor';
  END IF;
  SELECT coalesce(sum(n.total_segun_factura), 0) INTO v_acreditado
    FROM public.comprobante_de_proveedor n
   WHERE n.empresa_id = NEW.empresa_id AND n.comprobante_asociado_id = NEW.comprobante_asociado_id AND n.estado <> 'ANULADO';
  IF v_acreditado + NEW.total_segun_factura > v_total THEN
    RAISE EXCEPTION 'lo acreditado supera el total de la factura (% de %)', v_acreditado + NEW.total_segun_factura, v_total USING ERRCODE = '23514', CONSTRAINT = 'nota_de_credito_excede_la_factura';
  END IF;
  RETURN NEW;
END
$$;
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0111_compras_notas_de_debito.sql';
  END IF;
END
$$;
