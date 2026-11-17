-- 0085_revertir_compras_notas_de_credito: deshace 0085 (compras N4, notas de crédito del proveedor sin saldo): borra los dos disparadores, sus funciones, el índice y la columna `comprobante_asociado_id` con sus restricciones.
--
-- DESTRUCTIVA si hay datos: FRENA (55000) si existe cualquier comprobante con factura asociada (una nota de crédito cargada); hay que AVISAR AL DUEÑO, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = 'SI'
-- (las notas quedarían como comprobantes que pierden el vínculo con la factura que corrigen: nada se borra, pero el vínculo se pierde). No usa CASCADE.
--
-- No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base (que evade RLS):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay filas
--     \i migraciones/reversiones/0085_revertir_compras_notas_de_credito.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DO $$
DECLARE
  v_notas bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'comprobante_de_proveedor' AND column_name = 'comprobante_asociado_id') THEN
    SELECT count(*) INTO v_notas FROM public.comprobante_de_proveedor WHERE comprobante_asociado_id IS NOT NULL;
  END IF;
  IF v_notas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % notas de crédito cargadas que esta reversión dejaría sin su factura: avisar al dueño, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_notas USING ERRCODE = '55000';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.comprobante_de_proveedor') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS comprobante_con_notas ON comprobante_de_proveedor;
    DROP TRIGGER IF EXISTS comprobante_nota_valida ON comprobante_de_proveedor;
    DROP INDEX IF EXISTS cp_asociado_ix;
    ALTER TABLE comprobante_de_proveedor DROP CONSTRAINT IF EXISTS cp_asociado_ck;
    ALTER TABLE comprobante_de_proveedor DROP CONSTRAINT IF EXISTS cp_asociado_fkey;
    ALTER TABLE comprobante_de_proveedor DROP COLUMN IF EXISTS comprobante_asociado_id;
  END IF;
END
$$;
DROP FUNCTION IF EXISTS compras_factura_con_notas();
DROP FUNCTION IF EXISTS compras_nota_de_credito_valida();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (el nombre lleva el «.sql», como lo guarda el registro).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0085_compras_notas_de_credito.sql';
  END IF;
END
$$;
