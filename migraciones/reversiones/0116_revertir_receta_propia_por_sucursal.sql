-- 0116_revertir_receta_propia_por_sucursal: deja la receta como estaba en 0032: sin ámbito, una sola receta por producto y empresa. FRENA (55000) si hay alguna receta propia: la tabla es de solo inserción
-- y el historial de recetas no se borra sin decisión del dueño (avisarle antes de correrla). Se corre en UNA sola transacción, con el dueño de la base (evade RLS: sin eso el conteo no vería las filas de las
-- empresas y la reversión pasaría con datos). Se puede repetir sin que cambie nada.
--
--     BEGIN;
--     \i migraciones/reversiones/0116_revertir_receta_propia_por_sucursal.sql
--     COMMIT;
--
-- No usa CASCADE. Borra solo la fila de 0116 del registro `migracion` para poder volver a aplicarla. Los cuerpos de las tres funciones son copia EXACTA de `migraciones/0032_lotes_y_recetas.sql`.
DO $$
DECLARE
  v_propias bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'composicion' AND column_name = 'sucursal_id') THEN
    RAISE EXCEPTION '0116 no está aplicada (composicion.sucursal_id no existe)' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_propias FROM public.composicion WHERE sucursal_id IS NOT NULL;
  IF v_propias > 0 THEN
    RAISE EXCEPTION 'hay % versiones de recetas propias: no se revierte sin decisión del dueño', v_propias USING ERRCODE = '55000';
  END IF;
END
$$;

-- Las funciones vuelven a su cuerpo de 0032 ANTES de soltar lo que usa `composicion_sin_ciclos` (`composicion_vigente_id`) y las columnas.
CREATE OR REPLACE FUNCTION composicion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_anterior integer;
BEGIN
  NEW.registrada_en := now();
  SELECT p.clase_de_uso INTO v_clase FROM public.producto p WHERE p.id = NEW.producto_id AND p.empresa_id = NEW.empresa_id;
  IF v_clase IS NOT NULL AND v_clase NOT IN ('VENDIBLE', 'ELABORADO') THEN
    RAISE EXCEPTION 'solo un producto vendible o elaborado tiene composición'
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
  IF v_clase IS NOT NULL AND v_clase NOT IN ('MATERIA_PRIMA', 'INSUMO', 'REVENTA', 'ELABORADO', 'VENDIBLE') THEN
    RAISE EXCEPTION 'esta clase de producto no se controla en stock'
      USING ERRCODE = '23514', CONSTRAINT = 'articulo_de_stock_clase_no_controlable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION composicion_sin_ciclos() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_producto uuid;
  v_ultimo integer;
  v_ciclo boolean;
  v_niveles integer;
BEGIN
  SELECT max(k.numero) INTO v_ultimo
    FROM public.componente_de_composicion k WHERE k.empresa_id = NEW.empresa_id AND k.composicion_id = NEW.composicion_id;
  IF NEW.numero <> v_ultimo THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('composicion_sin_ciclos:' || NEW.empresa_id::text, 0));
  SELECT c.producto_id INTO v_producto FROM public.composicion c WHERE c.id = NEW.composicion_id AND c.empresa_id = NEW.empresa_id;
  WITH RECURSIVE camino (producto_id, nivel, ruta, ciclo) AS (
    SELECT v_producto, 1, ARRAY[v_producto], false
    UNION ALL
    SELECT k.compuesto_id, camino.nivel + 1, camino.ruta || k.compuesto_id, k.compuesto_id = ANY (camino.ruta)
      FROM camino
      JOIN LATERAL (SELECT c.id FROM public.composicion c
                     WHERE c.empresa_id = NEW.empresa_id AND c.producto_id = camino.producto_id
                     ORDER BY c.numero DESC LIMIT 1) vigente ON true
      JOIN public.componente_de_composicion k
        ON k.empresa_id = NEW.empresa_id AND k.composicion_id = vigente.id AND k.compuesto_id IS NOT NULL
     WHERE NOT camino.ciclo AND camino.nivel < 7
  )
  SELECT coalesce(bool_or(ciclo), false), coalesce(max(nivel) FILTER (WHERE NOT ciclo), 1) INTO v_ciclo, v_niveles FROM camino;
  IF v_ciclo THEN
    RAISE EXCEPTION 'una receta no puede contener, directa ni indirectamente, al propio producto'
      USING ERRCODE = '23514', CONSTRAINT = 'composicion_con_ciclo';
  END IF;
  IF v_niveles > 5 THEN
    RAISE EXCEPTION 'una receta admite hasta cinco niveles de recetas dentro de recetas'
      USING ERRCODE = '23514', CONSTRAINT = 'composicion_demasiado_anidada';
  END IF;
  RETURN NULL;
END
$$;

DROP FUNCTION IF EXISTS public.composicion_vigente_id(uuid, uuid, uuid);
ALTER TABLE public.composicion DROP CONSTRAINT IF EXISTS composicion_numero_uk;
ALTER TABLE public.composicion DROP CONSTRAINT IF EXISTS composicion_origen_ck;
ALTER TABLE public.composicion DROP CONSTRAINT IF EXISTS composicion_sucursal_fkey;
ALTER TABLE public.composicion ADD CONSTRAINT composicion_numero_uk UNIQUE (empresa_id, producto_id, numero);
ALTER TABLE public.composicion DROP COLUMN IF EXISTS origen_numero;
ALTER TABLE public.composicion DROP COLUMN IF EXISTS sucursal_id;

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0116_receta_propia_por_sucursal.sql';
  END IF;
END
$$;
