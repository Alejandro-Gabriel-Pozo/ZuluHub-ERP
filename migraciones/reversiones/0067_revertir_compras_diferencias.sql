-- 0067_revertir_compras_diferencias: deshace 0067 (compras N4, diferencias y tolerancias): borra `diferencia_de_compra`, `tolerancia_aplicada_de_conciliacion` y `tolerancia_de_compras` y devuelve
-- las dos funciones de 0066 que topan lo recibido contra la orden a su versión SIN tolerancia de recepción.
--
-- DESTRUCTIVA si hay datos: FRENA (55000) si existe cualquier fila en las tres tablas; hay que AVISAR AL DUEÑO, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = 'SI'.
-- Las conciliaciones y las asignaciones NO se tocan (son de 0037). No usa CASCADE.
--
-- No la aplica el ejecutor: se corre a mano, revisada, en una sola transacción y con el rol dueño de la base (que evade RLS):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay filas
--     \i migraciones/reversiones/0067_revertir_compras_diferencias.sql
--     COMMIT;
--
-- Se puede repetir sin que cambie nada. Solo borra su propia fila del registro `migracion`. Requiere 0066 aplicada (las funciones que restaura son suyas).

DO $$
DECLARE
  v_filas bigint := 0;
  v_n bigint;
  v_tabla text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['diferencia_de_compra', 'tolerancia_aplicada_de_conciliacion', 'tolerancia_de_compras'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_n;
      v_filas := v_filas + v_n;
    END IF;
  END LOOP;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de diferencias y tolerancias que esta reversión borraría: avisar al dueño, tener un respaldo y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas USING ERRCODE = '55000';
  END IF;
END
$$;

-- Primero las funciones (dejan de leer la tabla de tolerancias), después las tablas.
CREATE OR REPLACE FUNCTION compras_vinculo_de_orden_valida() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_prov_orden uuid;
  v_prov_recepcion uuid;
  v_retirada boolean;
  v_producto_orden uuid;
  v_producto_recepcion uuid;
  v_cantidad numeric;
  v_nivel text;
  v_exige boolean;
BEGIN
  SELECT o.estado, o.proveedor_id INTO v_estado, v_prov_orden FROM public.orden_de_compra o WHERE o.id = NEW.orden_id AND o.empresa_id = NEW.empresa_id FOR SHARE;
  IF v_estado IS DISTINCT FROM 'PEDIDA' THEN
    RAISE EXCEPTION 'se recibe contra una orden pedida' USING ERRCODE = '23514', CONSTRAINT = 'orden_no_pedida';
  END IF;
  SELECT r.proveedor_id INTO v_prov_recepcion FROM public.recepcion r WHERE r.id = NEW.recepcion_id AND r.empresa_id = NEW.empresa_id;
  IF v_prov_recepcion IS DISTINCT FROM v_prov_orden THEN
    RAISE EXCEPTION 'el proveedor de la recepción no es el de la orden' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_de_orden_proveedor_distinto';
  END IF;
  SELECT l.retirada, l.producto_id INTO v_retirada, v_producto_orden FROM public.linea_de_orden l
   WHERE l.empresa_id = NEW.empresa_id AND l.orden_id = NEW.orden_id AND l.numero = NEW.linea_de_orden;
  IF v_retirada THEN
    RAISE EXCEPTION 'la línea de la orden se retiró' USING ERRCODE = '23514', CONSTRAINT = 'linea_de_orden_retirada';
  END IF;
  SELECT l.cantidad_en_stock, l.producto_id INTO v_cantidad, v_producto_recepcion FROM public.linea_de_recepcion l
   WHERE l.empresa_id = NEW.empresa_id AND l.recepcion_id = NEW.recepcion_id AND l.numero = NEW.linea;
  IF v_producto_recepcion IS DISTINCT FROM v_producto_orden THEN
    RAISE EXCEPTION 'el producto de la línea recibida no es el de la línea de la orden' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_de_orden_producto_distinto';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inspeccion_de_linea_de_recepcion i WHERE i.empresa_id = NEW.empresa_id AND i.recepcion_id = NEW.recepcion_id AND i.linea = NEW.linea
                  AND i.condicion = 'RECHAZADA') THEN
    v_nivel := coalesce((SELECT n.nivel FROM public.nivel_de_control n
                          WHERE n.empresa_id = NEW.empresa_id AND n.sucursal_id IS NULL AND n.control = 'compras.recepcion_excede_la_orden'), 'PERMITIR');
    v_exige := v_nivel = 'BLOQUEAR' OR (v_nivel = 'AVISAR' AND NOT NEW.confirmo_exceso);
    IF v_exige AND EXISTS (SELECT 1 FROM public.saldo_de_linea_de_orden s WHERE s.empresa_id = NEW.empresa_id AND s.orden_id = NEW.orden_id AND s.linea = NEW.linea_de_orden
                            AND s.cantidad_recibida + v_cantidad > s.cantidad_pedida) THEN
      IF v_nivel = 'BLOQUEAR' THEN
        RAISE EXCEPTION 'la recepción supera lo pedido' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_bloqueada';
      END IF;
      RAISE EXCEPTION 'la recepción supera lo pedido y no se confirmó' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_sin_confirmar';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION compras_recepcion_confirmada_suma_a_la_orden() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_nivel text;
  v_exige boolean;
  v_estado text;
  v_nueva numeric;
  r record;
BEGIN
  v_nivel := coalesce((SELECT n.nivel FROM public.nivel_de_control n
                        WHERE n.empresa_id = NEW.empresa_id AND n.sucursal_id IS NULL AND n.control = 'compras.recepcion_excede_la_orden'), 'PERMITIR');
  FOR r IN
    SELECT v.orden_id, v.linea_de_orden, v.confirmo_exceso, l.cantidad_en_stock AS cantidad
      FROM public.linea_de_recepcion_de_orden v
      JOIN public.linea_de_recepcion l ON l.empresa_id = v.empresa_id AND l.recepcion_id = v.recepcion_id AND l.numero = v.linea
     WHERE v.empresa_id = NEW.empresa_id AND v.recepcion_id = NEW.id
       AND NOT EXISTS (SELECT 1 FROM public.inspeccion_de_linea_de_recepcion i WHERE i.empresa_id = v.empresa_id AND i.recepcion_id = v.recepcion_id AND i.linea = v.linea
                        AND i.condicion = 'RECHAZADA')
     ORDER BY v.orden_id, v.linea_de_orden
  LOOP
    SELECT o.estado INTO v_estado FROM public.orden_de_compra o WHERE o.id = r.orden_id AND o.empresa_id = NEW.empresa_id FOR SHARE;
    IF v_estado IS DISTINCT FROM 'PEDIDA' THEN
      RAISE EXCEPTION 'se recibe contra una orden pedida' USING ERRCODE = '23514', CONSTRAINT = 'orden_no_pedida';
    END IF;
    v_exige := v_nivel = 'BLOQUEAR' OR (v_nivel = 'AVISAR' AND NOT r.confirmo_exceso);
    UPDATE public.saldo_de_linea_de_orden s SET cantidad_recibida = s.cantidad_recibida + r.cantidad, actualizado_en = now()
     WHERE s.empresa_id = NEW.empresa_id AND s.orden_id = r.orden_id AND s.linea = r.linea_de_orden
       AND (NOT v_exige OR s.cantidad_recibida + r.cantidad <= s.cantidad_pedida)
    RETURNING s.cantidad_recibida INTO v_nueva;
    IF v_nueva IS NULL THEN
      IF v_nivel = 'BLOQUEAR' THEN
        RAISE EXCEPTION 'la recepción supera lo pedido' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_bloqueada';
      END IF;
      RAISE EXCEPTION 'la recepción supera lo pedido y no se confirmó' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_sin_confirmar';
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;

DROP TABLE IF EXISTS diferencia_de_compra;
DROP TABLE IF EXISTS tolerancia_aplicada_de_conciliacion;
DROP TABLE IF EXISTS tolerancia_de_compras;
DROP FUNCTION IF EXISTS compras_diferencia_en_su_conciliacion();
DROP FUNCTION IF EXISTS compras_diferencia_cambia();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0067_compras_diferencias.sql';
  END IF;
END
$$;
