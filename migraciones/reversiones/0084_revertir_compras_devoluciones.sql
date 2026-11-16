-- 0084_revertir_compras_devoluciones: deshace 0084 (compras N4, devoluciones al proveedor): borra `linea_de_devolucion` y `devolucion_a_proveedor` y sus funciones, y devuelve `renglon_de_movimiento_validar` a la versión de 0064.
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

-- La función de stock vuelve a la de 0064 (sin la excepción de la devolución).
CREATE OR REPLACE FUNCTION renglon_de_movimiento_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  m record;
  v_deposito record;
  v_activo boolean;
BEGIN
  SELECT x.clase, x.motivo, x.origen_tipo, x.deposito_id, x.hecho_en, x.fecha_negocio, x.registrado_en = now() AS de_esta_transaccion INTO m
    FROM public.movimiento_de_stock x WHERE x.id = NEW.movimiento_id AND x.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el movimiento del renglón no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'renglon_de_movimiento_movimiento_fkey';
  END IF;
  IF NOT m.de_esta_transaccion THEN
    RAISE EXCEPTION 'los renglones solo se cargan en la misma transacción que crea el movimiento'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_movimiento_confirmado';
  END IF;
  NEW.hecho_en := m.hecho_en;
  NEW.fecha_negocio := m.fecha_negocio;
  IF m.clase NOT IN ('TRANSFERENCIA', 'ANULACION') AND NEW.deposito_id <> m.deposito_id THEN
    RAISE EXCEPTION 'el depósito del renglón es el del movimiento'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_deposito_distinto_del_acto';
  END IF;
  SELECT d.uso, d.activo INTO v_deposito
    FROM public.deposito d WHERE d.id = NEW.deposito_id AND d.empresa_id = NEW.empresa_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el depósito del renglón no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'renglon_de_movimiento_deposito_fkey';
  END IF;
  IF NOT v_deposito.activo THEN
    RAISE EXCEPTION 'un depósito inactivo no admite movimientos'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_deposito_inactivo';
  END IF;
  IF v_deposito.uso <> 'NORMAL' AND m.clase NOT IN ('TRANSFERENCIA', 'AJUSTE', 'AJUSTE_POR_CONTEO', 'ANULACION')
     AND NOT (m.clase = 'ENTRADA' AND m.motivo = 'COMPRA' AND m.origen_tipo = 'RECEPCION') THEN
    RAISE EXCEPTION 'cuarentena y rechazo solo reciben y entregan por transferencia, ajuste o anulación (y reciben la entrada de una compra recibida)'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_deposito_de_uso_restringido';
  END IF;
  SELECT a.activo INTO v_activo FROM public.articulo_de_stock a WHERE a.id = NEW.articulo_id AND a.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el artículo del renglón no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'renglon_de_movimiento_articulo_fkey';
  END IF;
  IF NOT v_activo AND m.clase <> 'ANULACION' THEN
    RAISE EXCEPTION 'un artículo inactivo no admite movimientos'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_articulo_inactivo';
  END IF;
  RETURN NEW;
END
$$;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (el nombre lleva el «.sql», como lo guarda el registro).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0084_compras_devoluciones.sql';
  END IF;
END
$$;
