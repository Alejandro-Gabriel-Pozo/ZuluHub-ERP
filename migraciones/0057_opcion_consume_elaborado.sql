-- 0057_opcion_consume_elaborado: una opción de un grupo puede consumir un ELABORADO (dueño, 12/11/2026; DDD:91(b); decisión 179 Q9: «se activa junto con la ficha de receta»).
-- Hasta 0025 `consumo_de_opcion_validar` admitía solo MATERIA_PRIMA, INSUMO y REVENTA; ahora suma ELABORADO. La lista vive una vez en el dominio
-- (`CLASES_QUE_SE_CONSUMEN`, catalogo/dominio/clases.ts) y la base la copia; `test/integracion/catalogo-migracion.test.ts` y `catalogo-opcion-consume-elaborado.test.ts` fallan si difieren.
-- Previene: que la regla del dueño se cumpla en el código y la base la rechace (o al revés). VENDIBLE sigue sin poder consumirse.
-- ADITIVA y compatible hacia atrás: `CREATE OR REPLACE` de una función de disparador (misma firma, mismo search_path, mismos permisos y disparador); solo AFLOJA un control.
-- Las versiones de opción ya creadas no se revalidan. No agrega SECURITY DEFINER ni cambia roles.
-- Reversión: `migraciones/reversiones/0057_revertir_opcion_consume_elaborado.sql` (frena si ya hay consumos de elaborados). El ejecutor no la aplica.
-- DEPENDE de 0025 (la versión vigente de la función); se comprueba al empezar.

DO $$
BEGIN
  IF to_regprocedure('public.consumo_de_opcion_validar()') IS NULL THEN
    RAISE EXCEPTION '0057 necesita 0025 (consumo_de_opcion_validar)';
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
  IF v_clase_insumo IS NOT NULL AND v_clase_insumo NOT IN ('MATERIA_PRIMA', 'INSUMO', 'REVENTA', 'ELABORADO') THEN
    RAISE EXCEPTION 'una opción solo consume materia prima, insumos, reventa o elaborados'
      USING ERRCODE = '23514', CONSTRAINT = 'consumo_de_opcion_insumo_no_admitido';
  END IF;
  RETURN NEW;
END
$$;
