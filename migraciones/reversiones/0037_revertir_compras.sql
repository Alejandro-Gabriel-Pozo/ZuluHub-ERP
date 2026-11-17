-- 0037_revertir_compras: deshace 0037_compras (las diecinueve tablas de compras N1 y N2 con sus funciones y disparadores).
--
-- DESTRUCTIVA si hay datos: BORRA la ficha de compra de los proveedores, las presentaciones, las ofertas, las recepciones con sus líneas, los comprobantes de
-- proveedor con sus importes y tributos, las conciliaciones, los pagos y las correcciones de todas las empresas, y eso NO SE RECUPERA. Hay que AVISAR AL
-- DUEÑO antes de correrla si hay alguna fila. Las entradas de stock que generó cada recepción NO se tocan (son del libro de stock). Una tabla posterior que las
-- use (N3 o N4) hace fallar el DROP por su clave foránea y no se pierde nada.
--
-- Este script NO lo aplica el ejecutor de migraciones: se corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay filas
--     \i migraciones/reversiones/0037_revertir_compras.sql
--     COMMIT;
--
-- No usa CASCADE. Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`.

DO $$
DECLARE
  v_tabla text;
  v_filas bigint;
  v_total bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['configuracion_de_compras', 'ficha_de_compra_del_proveedor', 'comprobante_de_la_ficha', 'punto_de_venta_de_la_ficha',
      'pedido_de_ficha', 'presentacion_de_producto', 'oferta_de_proveedor', 'recepcion', 'linea_de_recepcion', 'comprobante_de_proveedor',
      'linea_de_comprobante', 'importe_por_alicuota', 'tributo_de_comprobante', 'conciliacion', 'asignacion_de_conciliacion', 'pago_de_comprobante',
      'correccion_de_compra'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de compras que esta reversión borraría: avisar al dueño, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TABLE IF EXISTS correccion_de_compra;
DROP TABLE IF EXISTS pago_de_comprobante;
DROP TABLE IF EXISTS asignacion_de_conciliacion;
DROP TABLE IF EXISTS conciliacion;
DROP TABLE IF EXISTS saldo_de_linea_de_comprobante;
DROP TABLE IF EXISTS tributo_de_comprobante;
DROP TABLE IF EXISTS importe_por_alicuota;
DROP TABLE IF EXISTS linea_de_comprobante;
DROP TABLE IF EXISTS comprobante_de_proveedor;
DROP TABLE IF EXISTS saldo_de_linea_de_recepcion;
DROP TABLE IF EXISTS linea_de_recepcion;
DROP TABLE IF EXISTS recepcion;
DROP TABLE IF EXISTS oferta_de_proveedor;
DROP TABLE IF EXISTS presentacion_de_producto;
DROP TABLE IF EXISTS pedido_de_ficha;
DROP TABLE IF EXISTS punto_de_venta_de_la_ficha;
DROP TABLE IF EXISTS comprobante_de_la_ficha;
DROP TABLE IF EXISTS ficha_de_compra_del_proveedor;
DROP TABLE IF EXISTS configuracion_de_compras;
DROP FUNCTION IF EXISTS asignacion_aplicar();
DROP FUNCTION IF EXISTS compras_saldo_solo_por_disparadores();
DROP FUNCTION IF EXISTS linea_de_comprobante_crear_saldo();
DROP FUNCTION IF EXISTS linea_de_recepcion_crear_saldo();
DROP FUNCTION IF EXISTS compras_hija_en_la_transaccion_de_su_cabecera();
DROP FUNCTION IF EXISTS compras_solo_cambia_estado();
DROP FUNCTION IF EXISTS compras_comprobante_preparar();
DROP FUNCTION IF EXISTS compras_recepcion_preparar();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0037_compras.sql';
  END IF;
END
$$;
