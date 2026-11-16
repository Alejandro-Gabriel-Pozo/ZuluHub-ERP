-- 0057_revertir_opcion_consume_elaborado: deshace 0057: la función vuelve a la versión de 0025 (solo materia prima, insumo y reventa).
--
-- NO borra datos, pero FRENA (55000) si ya hay consumos de opción cuyo insumo es un ELABORADO: dejarían de cumplir la regla. Hay que AVISAR AL DUEÑO y decidir qué hacer con ellos
-- antes (las versiones de opción son inmutables). Se corre a mano, revisada, en una transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0057_revertir_opcion_consume_elaborado.sql
--     COMMIT;
--
-- Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_filas bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_filas
    FROM public.consumo_de_opcion c
    JOIN public.producto p ON p.id = c.insumo_id AND p.empresa_id = c.empresa_id
   WHERE p.clase_de_uso = 'ELABORADO';
  IF v_filas > 0 THEN
    RAISE EXCEPTION 'hay % consumos de opción de un elaborado: avisar al dueño antes de volver a la regla anterior', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION consumo_de_opcion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_dueno uuid;
  v_de_esta_transaccion boolean;
  v_clase_insumo text;
BEGIN
  SELECT g.clase, o.producto_id, v.xmin::text = (pg_current_xact_id()::xid)::text
    INTO v_clase, v_dueno, v_de_esta_transaccion
    FROM public.version_de_opcion v
    JOIN public.opcion o ON o.id = v.opcion_id AND o.empresa_id = v.empresa_id
    JOIN public.grupo_de_elecciones g ON g.id = o.grupo_id AND g.empresa_id = o.empresa_id
   WHERE v.id = NEW.version_de_opcion_id AND v.empresa_id = NEW.empresa_id;
  IF v_clase IS NULL THEN
    RETURN NEW;  -- la clave foránea rechaza la versión que no existe o es de otra empresa
  END IF;
  IF v_clase = 'VARIANTE' THEN
    RAISE EXCEPTION 'las opciones de la variante no consumen (la receta del producto va en su ficha de receta)'
      USING ERRCODE = '23514', CONSTRAINT = 'consumo_de_opcion_de_variante';
  END IF;
  IF NOT v_de_esta_transaccion THEN
    RAISE EXCEPTION 'el consumo solo se carga en la misma transacción que crea la versión de la opción'
      USING ERRCODE = '23514', CONSTRAINT = 'consumo_de_opcion_version_confirmada';
  END IF;
  IF NEW.insumo_id = v_dueno THEN
    RAISE EXCEPTION 'una opción no puede consumir a su propio producto'
      USING ERRCODE = '23514', CONSTRAINT = 'consumo_de_opcion_insumo_es_el_mismo_producto';
  END IF;
  SELECT p.clase_de_uso INTO v_clase_insumo FROM public.producto p WHERE p.id = NEW.insumo_id AND p.empresa_id = NEW.empresa_id;
  IF v_clase_insumo IS NOT NULL AND v_clase_insumo NOT IN ('MATERIA_PRIMA', 'INSUMO', 'REVENTA') THEN
    RAISE EXCEPTION 'una opción solo consume materia prima, insumos o reventa'
      USING ERRCODE = '23514', CONSTRAINT = 'consumo_de_opcion_insumo_no_admitido';
  END IF;
  RETURN NEW;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0057_opcion_consume_elaborado.sql';
  END IF;
END
$$;
