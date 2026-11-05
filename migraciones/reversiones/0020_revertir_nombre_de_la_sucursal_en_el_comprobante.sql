-- 0020_revertir_nombre_de_la_sucursal_en_el_comprobante: deshace la migración 0020_nombre_de_la_sucursal_en_el_comprobante (la columna
-- `sucursal_nombre` de `comprobante` con su CHECK, el disparador `comprobante_alta_sucursal_nombre` y su función).
--
-- DESTRUCTIVA en lo único que agregó 0020: BORRA el nombre de sucursal que cada comprobante congeló, y eso NO SE RECUPERA (no se puede
-- recomputar: es el que la sucursal tenía al emitir, y pudo renombrarse después). No toca ninguna otra columna ni fila, ni nada de 0019.
-- Hay que AVISAR AL DUEÑO antes de correrla si hay algún comprobante con nombre congelado. Ojo con el código: las consultas del
-- comprobante (y la impresión) leen esa columna; sin ella fallan, así que conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay algún nombre congelado
--     \i migraciones/reversiones/0020_revertir_nombre_de_la_sucursal_en_el_comprobante.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0019. No usa CASCADE: si otro objeto depende de la columna (una vista o una restricción de una
-- migración posterior), el DROP falla y no se pierde nada. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_comprobantes bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con la columna ya borrada (una repetición) no hay nada que contar.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.comprobante'::regclass AND attname = 'sucursal_nombre' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.comprobante WHERE sucursal_nombre IS NOT NULL' INTO v_comprobantes;
  END IF;
  IF v_comprobantes > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % comprobantes con el nombre de la sucursal congelado que esta reversión borraría (no se recupera): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_comprobantes
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS comprobante_alta_sucursal_nombre ON comprobante;
DROP FUNCTION IF EXISTS comprobante_copiar_nombre_de_sucursal();
-- El CHECK cae con la columna.
ALTER TABLE comprobante
  DROP COLUMN IF EXISTS sucursal_nombre;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_nombre_de_la_sucursal_en_el_comprobante.sql' ESCAPE '\';
  END IF;
END
$$;
