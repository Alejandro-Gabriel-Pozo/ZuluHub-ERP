-- 0042_revertir_conteo_con_hora: deshace la migración 0042_conteo_con_hora (la columna `conteo_registro.contado_en` y las tablas
-- `motivo_de_diferencia`, `conteo_diferencia` y `conteo_marca`, con sus funciones y disparadores).
--
-- DESTRUCTIVA si hay datos: BORRA la hora declarada de cada carga de conteo y la explicación (motivo, detalle y marcas) de cada conteo aplicado,
-- y eso NO SE RECUPERA. Los ajustes de stock que esos conteos hicieron NO se tocan (están en el libro de movimientos), pero quedaría sin registro
-- el porqué de cada diferencia. FRENA si encuentra alguna fila: hay que AVISAR AL DUEÑO y repetir con `SET LOCAL pedernal.confirmar_reversion = 'SI'`.
-- `motivo_de_diferencia` es una tabla sembrada (8 filas fijas): no cuenta como dato a perder. Con la migración recién aplicada y sin conteos
-- cargados con hora, no hay nada que perder y corre sin confirmación.
--
-- Compatibilidad: el código anterior a esta migración ignora la columna y las tablas, así que se puede revertir con la aplicación vieja corriendo.
-- El código de este tramo (cargar con hora, aplicar con motivos) SÍ las lee: hay que bajarlo antes de revertir.
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola
-- transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay algún dato de este tramo
--     \i migraciones/reversiones/0042_revertir_conteo_con_hora.sql
--     COMMIT;
--
-- Deja la base como estaba después de 0041. No usa CASCADE: si otro objeto depende de una tabla, el DROP falla y no se pierde nada. Solo borra
-- su propia fila del registro `migracion`, para que la migración se pueda volver a aplicar. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_filas bigint := 0;
  v_parcial bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con las tablas ya borradas (una repetición) no hay nada que contar.
  IF to_regclass('public.conteo_diferencia') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.conteo_diferencia' INTO v_parcial;
    v_filas := v_filas + v_parcial;
  END IF;
  IF to_regclass('public.conteo_marca') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.conteo_marca' INTO v_parcial;
    v_filas := v_filas + v_parcial;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'conteo_registro' AND column_name = 'contado_en') THEN
    EXECUTE 'SELECT count(*) FROM public.conteo_registro WHERE contado_en IS NOT NULL' INTO v_parcial;
    v_filas := v_filas + v_parcial;
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas del conteo con hora (horas declaradas, explicaciones y marcas) que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los disparadores de solo inserción frenan hasta al dueño de la base: se sacan junto con cada tabla (DROP TABLE no los dispara), en el orden
-- inverso de las claves foráneas.
DROP TABLE IF EXISTS conteo_marca;
DROP TABLE IF EXISTS conteo_diferencia;
DROP TABLE IF EXISTS motivo_de_diferencia;

DROP FUNCTION IF EXISTS conteo_diferencia_coherente();
DROP FUNCTION IF EXISTS conteo_marca_validar();
DROP FUNCTION IF EXISTS conteo_diferencia_validar();

-- La columna de la hora (su CHECK se va con ella). `conteo_registro` es de solo inserción: DROP COLUMN no dispara sus disparadores.
ALTER TABLE IF EXISTS conteo_registro DROP COLUMN IF EXISTS contado_en;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_conteo\_con\_hora.sql' ESCAPE '\';
  END IF;
END
$$;
