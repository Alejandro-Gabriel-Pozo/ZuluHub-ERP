-- 0014_revertir_aspecto_de_marca: deshace la migración 0014_aspecto_de_marca (la columna
-- `version_de_marca.aspecto`, su restricción, sus privilegios y la función `aspecto_valido`).
-- EL NÚMERO ES PROVISORIO, como el de la migración: se renumera junto con ella.
--
-- DESTRUCTIVA en lo único que agregó 0014: borra la columna `aspecto` y, con ella, el aspecto (estilo,
-- superficie, esquinas, títulos, ingreso) que se haya cargado en cada versión de marca. No toca ninguna otra
-- columna ni fila. Hay que AVISAR AL DUEÑO antes de correrla si alguna versión tiene un aspecto cargado. Ojo
-- con el código: la lectura pública de la marca pide la columna `aspecto`; sin ella esa consulta falla y la
-- puerta responde el error 503, así que conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la
-- carpeta `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de la base
-- (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay versiones con un aspecto cargado
--     \i migraciones/reversiones/0014_revertir_aspecto_de_marca.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0013. Los privilegios por columna se van con la columna. No usa
-- CASCADE: si otro objeto depende de lo que se borra (una vista o una restricción de una migración
-- posterior), el DROP falla y no se pierde nada. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_datos bigint;
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
     WHERE attrelid = 'public.version_de_marca'::regclass AND attname = 'aspecto' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.version_de_marca WHERE aspecto <> ''{}''::jsonb' INTO v_datos;
    IF v_datos > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
      RAISE EXCEPTION 'hay % versiones de marca con un aspecto cargado que esta reversión borraría: avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_datos
        USING ERRCODE = '55000';
    END IF;
  END IF;
END
$$;

ALTER TABLE version_de_marca DROP COLUMN IF EXISTS aspecto;
DROP FUNCTION IF EXISTS aspecto_valido(jsonb);

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_aspecto_de_marca.sql' ESCAPE '\';
  END IF;
END
$$;
