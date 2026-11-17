-- 0032_revertir_lotes_y_recetas: deshace la migración 0032_lotes_y_recetas (las seis tablas de lotes: control_de_lote, lote,
-- calidad_de_lote, renglon_de_lote, saldo_de_lote y reasignacion_de_lote; la columna `composicion.pasos`; las funciones y los dos
-- disparadores diferidos que sumó sobre las tablas de 0030; los dos motivos de la producción) y deja las tres funciones de disparador y el
-- CHECK del compuesto como estaban en 0030. No toca nada más de 0030 ni de 0031.
--
-- DESTRUCTIVA si hay datos: BORRA los controles de lote, los lotes con sus saldos, la historia de calidad, los lotes de cada renglón del
-- libro, las reasignaciones y los pasos de las recetas, y eso NO SE RECUPERA (sin los renglones de lote no se sabe de qué lote salió cada
-- cosa). Hay que AVISAR AL DUEÑO antes de correrla si hay alguna fila. Ojo con el código: el módulo `stock` escribe y lee estas tablas en
-- cada movimiento de un artículo con control; conviene apagar la perilla `lotes` y bajar ese código primero.
--
-- Además FRENA SIEMPRE (no se puede confirmar) si alguna fila de 0030 ya usa lo que 0032 abrió, porque esas filas no se borran ni se editan
-- (nada se borra) y el CHECK que se restaura las rechazaría: una composición de un producto ELABORADO, un artículo de stock de un
-- ELABORADO o VENDIBLE, un componente que es un producto elaborado, o un movimiento con los motivos de la producción. Hay que resolver eso
-- antes (por ejemplo, con la anulación de las órdenes), o dejar la migración puesta.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay algún dato de lotes cargado
--     \i migraciones/reversiones/0032_revertir_lotes_y_recetas.sql
--     COMMIT;
--
-- Deja la base como estaba después de 0031. No usa CASCADE: si otro objeto depende de una tabla (una clave foránea de una migración
-- posterior, como la orden de producción de 0033, que se revierte antes), el DROP falla y no se pierde nada. Solo borra los dos motivos que
-- sembró y su propia fila del registro `migracion`, para que la migración se pueda volver a aplicar. Se puede repetir sin que cambie nada.

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

  -- Lo que 0030 ya guarda y que esta reversión no podría restaurar: frena siempre.
  IF to_regclass('public.control_de_lote') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.composicion c JOIN public.producto p ON p.id = c.producto_id AND p.empresa_id = c.empresa_id
                WHERE p.clase_de_uso = 'ELABORADO') THEN
      RAISE EXCEPTION 'hay composiciones de productos elaborados: no se puede revertir 0032 (nada se borra)' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.articulo_de_stock a JOIN public.producto p ON p.id = a.producto_id AND p.empresa_id = a.empresa_id
                WHERE p.clase_de_uso IN ('ELABORADO', 'VENDIBLE')) THEN
      RAISE EXCEPTION 'hay artículos de stock de productos elaborados o vendibles: no se puede revertir 0032 (nada se borra)' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.componente_de_composicion WHERE compuesto_id IS NOT NULL) THEN
      RAISE EXCEPTION 'hay componentes que son productos elaborados: no se puede revertir 0032 (nada se borra)' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.movimiento_de_stock
                WHERE motivo IN ('PRODUCTO_DE_TRANSFORMACION', 'CONSUMO_DE_TRANSFORMACION')) THEN
      RAISE EXCEPTION 'hay movimientos de producción: no se puede revertir 0032 (nada se borra)' USING ERRCODE = '55000';
    END IF;
  END IF;

  -- Con las tablas ya borradas (una repetición) no hay nada que contar.
  FOREACH v_tabla IN ARRAY ARRAY['control_de_lote', 'lote', 'calidad_de_lote', 'renglon_de_lote', 'saldo_de_lote', 'reasignacion_de_lote'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'composicion' AND column_name = 'pasos') THEN
    SELECT count(*) INTO v_filas FROM public.composicion WHERE pasos IS NOT NULL;
    v_total := v_total + v_filas;
  END IF;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de lotes, calidad o pasos de receta que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los disparadores diferidos que 0032 puso sobre tablas de 0030, antes que las funciones.
DROP TRIGGER IF EXISTS componente_de_composicion_sin_ciclos ON componente_de_composicion;
DROP TRIGGER IF EXISTS renglon_de_movimiento_cubierto_por_lotes ON renglon_de_movimiento;

-- Los disparadores de borrado y de solo inserción frenan hasta al dueño de la base: se sacan junto con cada tabla (DROP TABLE no los
-- dispara).
DROP TABLE IF EXISTS reasignacion_de_lote;
DROP TABLE IF EXISTS saldo_de_lote;
DROP TABLE IF EXISTS renglon_de_lote;
DROP TABLE IF EXISTS calidad_de_lote;
DROP TABLE IF EXISTS lote;
DROP TABLE IF EXISTS control_de_lote;

DROP FUNCTION IF EXISTS composicion_sin_ciclos();
DROP FUNCTION IF EXISTS control_de_lote_coherente();
DROP FUNCTION IF EXISTS control_de_lote_validar();
DROP FUNCTION IF EXISTS lote_validar();
DROP FUNCTION IF EXISTS calidad_de_lote_validar();
DROP FUNCTION IF EXISTS calidad_de_lote_aplicar();
DROP FUNCTION IF EXISTS renglon_de_lote_validar();
DROP FUNCTION IF EXISTS renglon_de_lote_aplicar();
DROP FUNCTION IF EXISTS renglon_cubierto_por_lotes();
DROP FUNCTION IF EXISTS saldo_de_lote_solo_por_movimientos();
DROP FUNCTION IF EXISTS saldo_de_lote_no_negativo();
DROP FUNCTION IF EXISTS saldo_de_lote_cierra_con_el_nucleo();
DROP FUNCTION IF EXISTS reasignacion_de_lote_validar();
DROP FUNCTION IF EXISTS reasignacion_de_lote_aplicar();

-- El libro: se saca el CHECK de la producción.
ALTER TABLE movimiento_de_stock DROP CONSTRAINT IF EXISTS movimiento_de_stock_transformacion_ck;

-- Los motivos sembrados: la tabla es de solo inserción, así que se suspende su disparador solo para estas dos filas. Si algún movimiento los
-- usa, la clave foránea frena el DELETE y no se pierde nada.
ALTER TABLE motivo_de_movimiento DISABLE TRIGGER motivo_de_movimiento_solo_insercion;
DELETE FROM motivo_de_movimiento WHERE codigo IN ('PRODUCTO_DE_TRANSFORMACION', 'CONSUMO_DE_TRANSFORMACION');
ALTER TABLE motivo_de_movimiento ENABLE TRIGGER motivo_de_movimiento_solo_insercion;

-- Las recetas como estaban: sin pasos, sin la única del compuesto y con el compuesto cerrado.
ALTER TABLE composicion DROP CONSTRAINT IF EXISTS composicion_pasos_ck;
ALTER TABLE composicion DROP COLUMN IF EXISTS pasos;
REVOKE INSERT (compuesto_id) ON componente_de_composicion FROM pedernal_app;
ALTER TABLE componente_de_composicion DROP CONSTRAINT IF EXISTS componente_compuesto_uk;
ALTER TABLE componente_de_composicion DROP CONSTRAINT IF EXISTS componente_compuesto_cerrado_ck;
ALTER TABLE componente_de_composicion ADD CONSTRAINT componente_compuesto_cerrado_ck CHECK (compuesto_id IS NULL);   -- E6 lo abre (con la prohibición de ciclos)

-- Las tres funciones, tal cual las dejó 0030.
CREATE OR REPLACE FUNCTION articulo_de_stock_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.producto_id IS DISTINCT FROM OLD.producto_id
       OR NEW.unidad_de_stock_id IS DISTINCT FROM OLD.unidad_de_stock_id OR NEW.dimension IS DISTINCT FROM OLD.dimension THEN
      RAISE EXCEPTION 'el producto y la unidad de un artículo de stock no cambian'
        USING ERRCODE = '23514', CONSTRAINT = 'articulo_de_stock_inmutable';
    END IF;
    IF OLD.activo AND NOT NEW.activo AND EXISTS (
         SELECT 1
           FROM public.componente_de_composicion k
           JOIN public.composicion c ON c.id = k.composicion_id AND c.empresa_id = k.empresa_id
          WHERE k.empresa_id = OLD.empresa_id AND k.articulo_id = OLD.id
            AND c.numero = (SELECT max(c2.numero) FROM public.composicion c2
                             WHERE c2.empresa_id = c.empresa_id AND c2.producto_id = c.producto_id)) THEN
      RAISE EXCEPTION 'el artículo está en la composición vigente de un producto'
        USING ERRCODE = '23514', CONSTRAINT = 'articulo_de_stock_en_composicion_activa';
    END IF;
    RETURN NEW;
  END IF;
  SELECT p.clase_de_uso INTO v_clase FROM public.producto p WHERE p.id = NEW.producto_id AND p.empresa_id = NEW.empresa_id;
  IF v_clase IS NOT NULL AND v_clase NOT IN ('MATERIA_PRIMA', 'INSUMO', 'REVENTA') THEN
    RAISE EXCEPTION 'solo la materia prima, los insumos y la reventa se controlan en stock'
      USING ERRCODE = '23514', CONSTRAINT = 'articulo_de_stock_clase_no_controlable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION composicion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_anterior integer;
BEGIN
  NEW.registrada_en := now();
  SELECT p.clase_de_uso INTO v_clase FROM public.producto p WHERE p.id = NEW.producto_id AND p.empresa_id = NEW.empresa_id;
  IF v_clase IS NOT NULL AND v_clase <> 'VENDIBLE' THEN
    RAISE EXCEPTION 'solo un producto vendible tiene composición'
      USING ERRCODE = '23514', CONSTRAINT = 'composicion_producto_no_vendible';
  END IF;
  SELECT coalesce(max(c.numero), 0) INTO v_anterior
    FROM public.composicion c WHERE c.empresa_id = NEW.empresa_id AND c.producto_id = NEW.producto_id;
  IF NEW.numero <> v_anterior + 1 THEN
    RAISE EXCEPTION 'el número de versión de una composición es el siguiente al último'
      USING ERRCODE = '23514', CONSTRAINT = 'composicion_numero_salteado';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION componente_de_composicion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_de_esta_transaccion boolean;
  v_activo boolean;
BEGIN
  SELECT c.registrada_en = now() INTO v_de_esta_transaccion
    FROM public.composicion c WHERE c.id = NEW.composicion_id AND c.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la composición del componente no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'componente_composicion_fkey';
  END IF;
  IF NOT v_de_esta_transaccion THEN
    RAISE EXCEPTION 'los componentes solo se cargan en la misma transacción que crea la versión de la composición'
      USING ERRCODE = '23514', CONSTRAINT = 'componente_version_confirmada';
  END IF;
  IF NEW.articulo_id IS NOT NULL THEN
    SELECT a.activo INTO v_activo
      FROM public.articulo_de_stock a WHERE a.id = NEW.articulo_id AND a.empresa_id = NEW.empresa_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'el artículo del componente no existe'
        USING ERRCODE = '23503', CONSTRAINT = 'componente_articulo_fkey';
    END IF;
    IF NOT v_activo THEN
      RAISE EXCEPTION 'el artículo del componente no está activo'
        USING ERRCODE = '23514', CONSTRAINT = 'componente_articulo_inactivo';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_lotes\_y\_recetas.sql' ESCAPE '\';
  END IF;
END
$$;
