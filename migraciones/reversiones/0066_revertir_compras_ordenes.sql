-- 0066_revertir_compras_ordenes: deshace 0066 (compras N4, órdenes): borra `linea_de_recepcion_de_orden`, `saldo_de_linea_de_orden`, `linea_de_orden` y `orden_de_compra`, el disparador de
-- `recepcion` que devolvía lo recibido a la orden y las funciones de la migración.
--
-- DESTRUCTIVA si hay datos: FRENA (55000) si existe cualquier orden, línea, saldo o vínculo de recepción con una orden; hay que AVISAR AL DUEÑO, tener un respaldo y repetir
-- con SET LOCAL pedernal.confirmar_reversion = 'SI'. Las recepciones y el stock que ya entraron NO se tocan (son de 0037 y del libro de stock); solo se pierde el vínculo con la orden.
-- No usa CASCADE.
--
-- No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base (que evade RLS):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay filas
--     \i migraciones/reversiones/0066_revertir_compras_ordenes.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`. Si 0067 (tolerancias, conciliación de tres vías) está aplicada, revertirla antes.

DO $$
DECLARE
  v_filas bigint := 0;
  v_n bigint;
  v_tabla text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['orden_de_compra', 'linea_de_orden', 'saldo_de_linea_de_orden', 'linea_de_recepcion_de_orden'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_n;
      v_filas := v_filas + v_n;
    END IF;
  END LOOP;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de órdenes de compra que esta reversión borraría: avisar al dueño, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS recepcion_devuelve_a_la_orden ON recepcion;
DROP TRIGGER IF EXISTS recepcion_suma_a_la_orden ON recepcion;
DROP TABLE IF EXISTS linea_de_recepcion_de_orden;
DROP TABLE IF EXISTS saldo_de_linea_de_orden;
DROP TABLE IF EXISTS linea_de_orden;
DROP TABLE IF EXISTS orden_de_compra;
DROP FUNCTION IF EXISTS compras_recepcion_anulada_devuelve_a_la_orden();
DROP FUNCTION IF EXISTS compras_recepcion_confirmada_suma_a_la_orden();
DROP FUNCTION IF EXISTS compras_vinculo_de_orden_valida();
DROP FUNCTION IF EXISTS compras_saldo_de_orden_solo_por_disparadores();
DROP FUNCTION IF EXISTS compras_linea_de_orden_valida();
DROP FUNCTION IF EXISTS compras_orden_abre_saldos();
DROP FUNCTION IF EXISTS compras_orden_cambia();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0066_compras_ordenes.sql';
  END IF;
END
$$;
