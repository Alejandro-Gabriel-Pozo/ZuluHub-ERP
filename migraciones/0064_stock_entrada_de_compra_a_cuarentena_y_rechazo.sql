-- 0064_stock_entrada_de_compra_a_cuarentena_y_rechazo: una entrada de COMPRA con origen RECEPCION puede ir directo a un depósito de CUARENTENA o de RECHAZO (compras N3, E9 T13).
-- Decisión del dueño del 14/11/2026 (decisiones-del-dueno-2026-11.md, «Compras con recepción separada», punto 1): «se puede recibir directo a cuarentena o a rechazo». E9 D-E9-1:
-- «lo relaja la migración de compras». Hasta 0030 `renglon_de_movimiento_validar` rechazaba toda entrada y salida de esos depósitos (solo transferencia, ajuste o anulación).
-- ADITIVA y compatible hacia atrás: `CREATE OR REPLACE` de una función de disparador (misma firma, mismo search_path, mismo disparador, mismos permisos); solo AFLOJA un control y
-- SOLO para `clase = 'ENTRADA'` con `motivo = 'COMPRA'` y `origen_tipo = 'RECEPCION'` (lo que registra `confirmarRecepcion`). Toda otra entrada, y la venta y la salida desde esos
-- depósitos, siguen rechazadas. No cambia ninguna tabla, rol ni permiso; las existencias de cuarentena y rechazo siguen sin sumar a lo disponible (0030).
-- No agrega SECURITY DEFINER. Reversión: `migraciones/reversiones/0064_revertir_stock_entrada_de_compra_a_cuarentena_y_rechazo.sql` (deja de aceptar esas entradas; no borra nada).
-- DEPENDE de 0030 (la función vigente) y de 0037 (el motivo COMPRA ya existe en el libro); se comprueba al empezar.

DO $$
BEGIN
  IF to_regprocedure('public.renglon_de_movimiento_validar()') IS NULL THEN
    RAISE EXCEPTION '0064 necesita 0030 (renglon_de_movimiento_validar)' USING ERRCODE = '55000';
  END IF;
END
$$;

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
