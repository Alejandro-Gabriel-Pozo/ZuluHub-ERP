-- 0019_revertir_contacto_de_la_sucursal: deshace la migración 0019_contacto_de_la_sucursal (las columnas `telefono`, `correo` y
-- `web` de `sucursal`, las `sucursal_telefono`, `sucursal_correo` y `sucursal_web` de `comprobante`, el disparador
-- `comprobante_alta_contacto` y su función). EL NÚMERO ES PROVISORIO, como el de la migración: se renumera junto con ella.
--
-- DESTRUCTIVA en lo único que agregó 0019: BORRA el contacto de cada sucursal y el contacto que cada comprobante congeló, y eso NO SE
-- RECUPERA (el contacto congelado no se puede recomputar: es el que la sucursal tenía al emitir, y la sucursal pudo cambiarlo
-- después). No toca ninguna otra columna ni fila, ni la función `comprobante_validar_alta`. Hay que AVISAR AL DUEÑO antes de correrla
-- si hay algún contacto cargado. Ojo con el código: las consultas y la edición de sucursales (y, cuando exista, la impresión) leen
-- esas columnas; sin ellas fallan, así que conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay algún contacto cargado o congelado
--     \i migraciones/reversiones/0019_revertir_contacto_de_la_sucursal.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0018. No usa CASCADE: si otro objeto depende de una columna (una vista o una restricción de
-- una migración posterior), el DROP falla y no se pierde nada. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_sucursales bigint := 0;
  v_comprobantes bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con las columnas ya borradas (una repetición) no hay nada que contar.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.sucursal'::regclass AND attname = 'telefono' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.sucursal WHERE telefono IS NOT NULL OR correo IS NOT NULL OR web IS NOT NULL'
      INTO v_sucursales;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.comprobante'::regclass AND attname = 'sucursal_telefono' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.comprobante
              WHERE sucursal_telefono IS NOT NULL OR sucursal_correo IS NOT NULL OR sucursal_web IS NOT NULL'
      INTO v_comprobantes;
  END IF;
  IF v_sucursales + v_comprobantes > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % sucursales y % comprobantes con contacto que esta reversión borraría (no se recupera): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_sucursales, v_comprobantes
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS comprobante_alta_contacto ON comprobante;
DROP FUNCTION IF EXISTS comprobante_copiar_contacto();
ALTER TABLE comprobante
  DROP COLUMN IF EXISTS sucursal_telefono,
  DROP COLUMN IF EXISTS sucursal_correo,
  DROP COLUMN IF EXISTS sucursal_web;
-- Los CHECK y los privilegios de columna caen con la columna.
ALTER TABLE sucursal
  DROP COLUMN IF EXISTS telefono,
  DROP COLUMN IF EXISTS correo,
  DROP COLUMN IF EXISTS web;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_contacto_de_la_sucursal.sql' ESCAPE '\';
  END IF;
END
$$;
