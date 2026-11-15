-- 0056_revertir_receta_sin_insumos: deshace la migración 0056_receta_sin_insumos: el disparador `componente_de_composicion_validar` vuelve al cuerpo de 0032 (acepta de nuevo
-- un artículo de clase «insumo» como componente).
--
-- NO es destructiva (no borra ni cambia filas): solo reemplaza el cuerpo de una función. Antes de bajarla conviene bajar el código que rechaza el insumo (`COMPONENTE_ES_INSUMO`).
-- Este script NO lo aplica el ejecutor de migraciones: se corre a mano, revisado, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0056_revertir_receta_sin_insumos.sql
--     COMMIT;
--
-- No usa CASCADE. Borra solo su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

CREATE OR REPLACE FUNCTION componente_de_composicion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_de_esta_transaccion boolean;
  v_activo boolean;
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

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0056_receta_sin_insumos.sql';
  END IF;
END
$$;
