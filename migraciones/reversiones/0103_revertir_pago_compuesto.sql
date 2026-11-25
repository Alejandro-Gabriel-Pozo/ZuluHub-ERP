-- 0103_revertir_pago_compuesto: deshace 0103: borra `medio_de_un_pago`, su función y sus disparadores y restaura `pago_medio_ck` sin `COMPUESTO`.
-- DESTRUCTIVA si hay pagos COMPUESTO: perdería sus medios. FRENA (55000) si existe alguno; hay que AVISAR AL DUEÑO y resolverlo a mano antes. Con solo pagos de un medio no se pierde nada (el medio está en la cabecera).
-- Se corre a mano, revisada, en una sola transacción y con el rol dueño de la base (evade RLS). No usa CASCADE. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_compuestos bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.pago_de_comprobante') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.pago_de_comprobante WHERE medio = ''COMPUESTO''' INTO v_compuestos;
  END IF;
  IF v_compuestos > 0 THEN
    RAISE EXCEPTION 'hay % pagos compuestos: no se revierte (perdería sus medios); resolverlos a mano antes', v_compuestos USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los disparadores de la tabla se van con ella; el de la cabecera lo quita la reversión de 0104 (que corre antes).
DROP TABLE IF EXISTS medio_de_un_pago;
DROP FUNCTION IF EXISTS pago_compuesto_verificar();
ALTER TABLE pago_de_comprobante DROP CONSTRAINT IF EXISTS pago_medio_ck;
ALTER TABLE pago_de_comprobante ADD CONSTRAINT pago_medio_ck
  CHECK (medio IN ('EFECTIVO', 'TARJETA_DEBITO', 'TARJETA_CREDITO', 'TRANSFERENCIA', 'QR', 'OTRO'));
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0103_pago_compuesto.sql';
  END IF;
END
$$;
