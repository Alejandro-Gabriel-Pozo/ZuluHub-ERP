-- 0056_receta_sin_insumos: la receta lleva solo ingredientes; un artículo de clase «insumo» (packaging, limpieza) no puede ser componente.
-- Decisión del dueño (14/11/2026, `11-especificaciones/decisiones-del-dueno-2026-11.md`, fila «Receta e insumos operativos»): la receta lleva materia prima,
-- elaborado y reventa; NO lleva packaging ni limpieza. El servidor lo rechaza (`COMPONENTE_ES_INSUMO`, `composiciones.ts`); esta migración pone la misma regla en la base,
-- para que ninguna otra vía de escritura pueda dejar un insumo en una receta.
--
-- Qué cambia: el disparador de alta `componente_de_composicion_validar` (de 0032) rechaza, además, un componente cuyo artículo es de un producto de clase `INSUMO`
-- (restricción `componente_articulo_es_insumo`, 23514). El resto de la función queda IGUAL (mismo `search_path`, mismos permisos, mismo disparador: `CREATE OR REPLACE`).
--
-- Reglas de esta migración: APRIETA un control y no cambia datos. El disparador corre solo al INSERTAR un componente y las versiones de receta son solo inserción: las recetas
-- ya guardadas con un insumo NO se revalidan ni se tocan, siguen calculándose igual; solo una versión NUEVA que lo incluya es rechazada. Por eso no necesita freno por filas
-- existentes. Reversión (script aparte, repetible, no destructiva): `migraciones/reversiones/0056_revertir_receta_sin_insumos.sql` restaura el cuerpo de 0032.
-- DEPENDE de 0032 (recetas); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.componente_de_composicion') IS NULL OR to_regclass('public.articulo_de_stock') IS NULL OR to_regclass('public.producto') IS NULL THEN
    RAISE EXCEPTION 'la receta sin insumos requiere 0030_stock y 0032_lotes_y_recetas aplicadas antes' USING ERRCODE = '55000';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION componente_de_composicion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_de_esta_transaccion boolean;
  v_activo boolean;
  v_clase text;
  v_producto record;
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
    SELECT a.activo, p.clase_de_uso INTO v_activo, v_clase
      FROM public.articulo_de_stock a
      JOIN public.producto p ON p.id = a.producto_id AND p.empresa_id = a.empresa_id
     WHERE a.id = NEW.articulo_id AND a.empresa_id = NEW.empresa_id FOR SHARE OF a;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'el artículo del componente no existe'
        USING ERRCODE = '23503', CONSTRAINT = 'componente_articulo_fkey';
    END IF;
    IF NOT v_activo THEN
      RAISE EXCEPTION 'el artículo del componente no está activo'
        USING ERRCODE = '23514', CONSTRAINT = 'componente_articulo_inactivo';
    END IF;
    IF v_clase = 'INSUMO' THEN
      RAISE EXCEPTION 'la receta lleva solo ingredientes: un insumo operativo (packaging, limpieza) no es un componente'
        USING ERRCODE = '23514', CONSTRAINT = 'componente_articulo_es_insumo';
    END IF;
  ELSIF NEW.compuesto_id IS NOT NULL THEN
    SELECT p.clase_de_uso, p.activo INTO v_producto
      FROM public.producto p WHERE p.id = NEW.compuesto_id AND p.empresa_id = NEW.empresa_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'el producto del componente no existe'
        USING ERRCODE = '23503', CONSTRAINT = 'componente_compuesto_fkey';
    END IF;
    IF v_producto.clase_de_uso <> 'ELABORADO' THEN
      RAISE EXCEPTION 'un componente que no es un artículo de stock es un producto elaborado'
        USING ERRCODE = '23514', CONSTRAINT = 'componente_compuesto_no_elaborado';
    END IF;
    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'el producto elaborado del componente no está activo'
        USING ERRCODE = '23514', CONSTRAINT = 'componente_compuesto_inactivo';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
