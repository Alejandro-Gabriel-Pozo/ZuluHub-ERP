-- 0031_revertir_stock_costos: deshace la migración 0031_stock_costos (las dos tablas del costo: costo_de_articulo y costo_de_renglon, con su
-- función y sus disparadores). No toca nada de 0030.
--
-- DESTRUCTIVA si hay datos: BORRA el promedio vigente de cada depósito y artículo y el costo congelado de cada renglón del libro, y eso NO
-- SE RECUPERA (el costo congelado es el único registro de a cuánto salió cada cosa: no se puede reconstruir sin él, y el promedio sale de
-- lo que entró con costo). Hay que AVISAR AL DUEÑO antes de correrla si hay alguna fila. Ojo con el código: el módulo `stock` escribe y lee
-- estas tablas en cada movimiento; sin ellas todo movimiento falla, así que conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay algún costo cargado
--     \i migraciones/reversiones/0031_revertir_stock_costos.sql
--     COMMIT;
--
-- Deja la base como estaba después de 0030. No usa CASCADE: si otro objeto depende de una tabla (una clave foránea de una migración
-- posterior), el DROP falla y no se pierde nada. Solo borra su propia fila del registro `migracion`, para que la migración se pueda volver
-- a aplicar. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_tabla text;
  v_filas bigint;
  v_total bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con las tablas ya borradas (una repetición) no hay nada que contar.
  FOREACH v_tabla IN ARRAY ARRAY['costo_de_articulo', 'costo_de_renglon'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de costos de stock (promedios y costos congelados) que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los disparadores de borrado y de solo inserción frenan hasta al dueño de la base: se sacan junto con cada tabla (DROP TABLE no los
-- dispara).
DROP TABLE IF EXISTS costo_de_renglon;
DROP TABLE IF EXISTS costo_de_articulo;

DROP FUNCTION IF EXISTS costo_de_renglon_validar();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_stock\_costos.sql' ESCAPE '\';
  END IF;
END
$$;
