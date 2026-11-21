-- 0064_revertir_stock_entrada_de_compra_a_cuarentena_y_rechazo: deshace 0064: `renglon_de_movimiento_validar` vuelve a la versión de 0030 (cuarentena y rechazo solo reciben y entregan por
-- transferencia, ajuste o anulación). NO borra datos ni toca movimientos ya registrados: solo los NUEVOS dejan de admitirse. Efecto en compras: confirmar una recepción N3 con
-- una línea para cuarentena o rechazo vuelve a fallar con `renglon_deposito_de_uso_restringido`. Se corre a mano, revisada, en una transacción y con el rol dueño de la base.
-- Es repetible. Solo borra su propia fila del registro `migracion`.

CREATE OR REPLACE FUNCTION renglon_de_movimiento_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  m record;
  v_deposito record;
  v_activo boolean;
BEGIN
  SELECT x.clase, x.deposito_id, x.hecho_en, x.fecha_negocio, x.registrado_en = now() AS de_esta_transaccion INTO m
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
  IF v_deposito.uso <> 'NORMAL' AND m.clase NOT IN ('TRANSFERENCIA', 'AJUSTE', 'AJUSTE_POR_CONTEO', 'ANULACION') THEN
    RAISE EXCEPTION 'cuarentena y rechazo solo reciben y entregan por transferencia, ajuste o anulación'
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

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0064_stock_entrada_de_compra_a_cuarentena_y_rechazo.sql';
  END IF;
END
$$;
