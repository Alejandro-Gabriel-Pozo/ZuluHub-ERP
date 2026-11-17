-- 0048_revertir_departamento_en_la_cuenta: deshace la migración 0048_departamento_en_la_cuenta: quita de `cuenta_consumo` la columna `departamento_id` (con su clave foránea y
-- su índice), el disparador y su función.
--
-- DESTRUCTIVA si hay datos: BORRA el departamento con el que se abrió cada cuenta (no se recupera). Hay que AVISAR AL DUEÑO antes de correrla si alguna cuenta lo tiene.
-- Conviene bajar primero el código que escribe esa columna (`abrirCuenta`).
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño
-- de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si alguna cuenta tiene departamento
--     \i migraciones/reversiones/0048_revertir_departamento_en_la_cuenta.sql
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
     WHERE table_schema = 'public' AND table_name = 'cuenta_consumo' AND column_name = 'departamento_id'
  ) THEN
    SELECT count(*) INTO v_filas FROM public.cuenta_consumo WHERE departamento_id IS NOT NULL;
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % cuentas con departamento que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS cuenta_departamento_validar ON cuenta_consumo;
DROP FUNCTION IF EXISTS cuenta_validar_departamento();
DROP INDEX IF EXISTS cuenta_departamento_ix;
ALTER TABLE cuenta_consumo DROP CONSTRAINT IF EXISTS cuenta_departamento_fkey;
ALTER TABLE cuenta_consumo DROP COLUMN IF EXISTS departamento_id;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0048_departamento_en_la_cuenta.sql';
  END IF;
END
$$;
