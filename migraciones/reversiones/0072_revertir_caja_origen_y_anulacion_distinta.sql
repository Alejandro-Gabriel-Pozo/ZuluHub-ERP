-- 0072_revertir_caja_origen_y_anulacion_distinta: deshace 0072: quita el CHECK de anulación distinta y, del bloque 2, las columnas `origen_tipo` y `origen_id` con su índice y sus restricciones.
--
-- FRENA (55000) si hay movimientos con `origen_tipo` no nulo: quitar las columnas borraría el origen estructurado de esos movimientos (la clave de idempotencia conserva el texto, pero
-- ya no habría columna para consultarlo). AVISAR AL DUEÑO antes y, si se decide seguir, repetir con SET LOCAL pedernal.confirmar_reversion = 'SI'. Se corre a mano, revisada, en una
-- transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay movimientos con origen
--     \i migraciones/reversiones/0072_revertir_caja_origen_y_anulacion_distinta.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_filas bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'movimiento_caja' AND column_name = 'origen_tipo'
  ) THEN
    SELECT count(*) INTO v_filas FROM public.movimiento_caja WHERE origen_tipo IS NOT NULL;
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % movimientos de caja con origen: quitar las columnas borraría ese dato; avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP INDEX IF EXISTS movimiento_caja_origen_uk;
ALTER TABLE movimiento_caja DROP CONSTRAINT IF EXISTS movimiento_caja_origen_ck;
ALTER TABLE movimiento_caja DROP CONSTRAINT IF EXISTS movimiento_caja_origen_par_ck;
ALTER TABLE movimiento_caja DROP COLUMN IF EXISTS origen_id;
ALTER TABLE movimiento_caja DROP COLUMN IF EXISTS origen_tipo;
ALTER TABLE movimiento_caja DROP CONSTRAINT IF EXISTS movimiento_caja_anula_distinta_ck;

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0072_caja_origen_y_anulacion_distinta.sql';
  END IF;
END
$$;
