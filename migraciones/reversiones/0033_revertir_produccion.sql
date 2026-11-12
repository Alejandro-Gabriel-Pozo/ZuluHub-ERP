-- 0033_revertir_produccion: deshace la migración 0033_produccion (contador_de_ordenes, orden_de_produccion y renglon_de_orden, con sus
-- funciones y disparadores). No toca nada de 0030 ni de 0032 (los movimientos de stock que la orden originó quedan en el libro).
--
-- DESTRUCTIVA si hay datos: BORRA todas las órdenes de producción con lo esperado y lo real, el costo congelado de cada una y el contador
-- de números, y eso NO SE RECUPERA (el costo de lo producido solo está ahí, y el número de orden no se reconstruye). Los movimientos del
-- libro y sus lotes quedan, pero sin la orden que los explica. Hay que AVISAR AL DUEÑO antes de correrla si hay alguna fila. Ojo con el
-- código: el módulo `produccion` lee y escribe estas tablas; conviene apagar el módulo y bajar ese código primero. Se revierte ANTES que 0032.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay alguna orden cargada
--     \i migraciones/reversiones/0033_revertir_produccion.sql
--     COMMIT;
--
-- Deja la base como estaba después de 0032. No usa CASCADE: si otro objeto depende de una tabla (una clave foránea de una migración
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
  FOREACH v_tabla IN ARRAY ARRAY['orden_de_produccion', 'renglon_de_orden', 'contador_de_ordenes'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de órdenes de producción que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los disparadores de borrado frenan hasta al dueño de la base: se sacan junto con cada tabla (DROP TABLE no los dispara).
DROP TABLE IF EXISTS renglon_de_orden;
DROP TABLE IF EXISTS orden_de_produccion;
DROP TABLE IF EXISTS contador_de_ordenes;

DROP FUNCTION IF EXISTS contador_de_ordenes_solo_por_ordenes();
DROP FUNCTION IF EXISTS orden_validar();
DROP FUNCTION IF EXISTS orden_cerrada_con_reales();
DROP FUNCTION IF EXISTS renglon_de_orden_validar();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_produccion.sql' ESCAPE '\';
  END IF;
END
$$;
