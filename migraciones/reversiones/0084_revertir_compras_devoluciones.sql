-- 0084_revertir_compras_devoluciones: deshace 0084 (compras N4, devoluciones al proveedor): borra `linea_de_devolucion` y `devolucion_a_proveedor` y sus funciones.
--
-- DESTRUCTIVA si hay datos: FRENA (55000) si existe cualquier devolución o línea; hay que AVISAR AL DUEÑO, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = 'SI'.
-- Las salidas de stock que generaron las devoluciones NO se tocan (son del libro de stock). El motivo sembrado `SALIDA/DEVOLUCION_A_PROVEEDOR` NO se borra: la tabla de motivos es global y de solo inserción
-- (queda, inofensivo, y si la migración se reaplica la siembra se omite). No usa CASCADE.
--
-- No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base (que evade RLS):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay filas
--     \i migraciones/reversiones/0084_revertir_compras_devoluciones.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DO $$
DECLARE
  v_filas bigint := 0;
  v_n bigint;
  v_tabla text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['linea_de_devolucion', 'devolucion_a_proveedor'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_n;
      v_filas := v_filas + v_n;
    END IF;
  END LOOP;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de devoluciones que esta reversión borraría: avisar al dueño, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TABLE IF EXISTS linea_de_devolucion;
DROP TABLE IF EXISTS devolucion_a_proveedor;
DROP FUNCTION IF EXISTS compras_linea_de_devolucion_valida();
DROP FUNCTION IF EXISTS compras_devolucion_cambia();
DROP FUNCTION IF EXISTS compras_devolucion_prepara();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (el nombre lleva el «.sql», como lo guarda el registro).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0084_compras_devoluciones.sql';
  END IF;
END
$$;
