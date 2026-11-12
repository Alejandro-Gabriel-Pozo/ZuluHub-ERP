-- 0043_revertir_carta_publica: deshace la migración 0043_carta_publica: borra las tablas `carta_publica` y `disponibilidad_de_producto` (con sus funciones, disparadores,
-- políticas y la lectura del rol público) y devuelve `texto_de_catalogo_valido` a la lista de 0025 (sin `¿ ¡ ? ! % $`).
--
-- DESTRUCTIVA si hay datos: BORRA qué sucursales tenían carta en línea Y SUS CÓDIGOS (los QR impresos dejarían de andar para siempre: un código nuevo no
-- se puede igualar al viejo) y qué productos estaban ocultos (esa historia NO se recupera: la auditoría guarda los cambios, no la fila). Hay que AVISAR AL
-- DUEÑO antes de correrla si hay alguna fila. Ojo con el código: el módulo `catalogo` y el adaptador de la carta (T3) leen esas tablas; sin ellas fallan,
-- así que conviene bajar primero ese código. Una tabla posterior que apunte a ellas con una clave foránea hace fallar el DROP y no se pierde nada.
--
-- TAMBIÉN FRENA si algún dato ya guardado usa alguno de los seis signos nuevos en una columna con CHECK de `texto_de_catalogo_valido` (productos, secciones,
-- opciones, grupos, depósitos…): con la lista vieja esa fila no se podría volver a guardar. Hay que corregir esos textos antes (y avisar al dueño). Solo
-- se miran los CHECK; una función de disparador que use `texto_de_catalogo_valido` solo valida al escribir, así que no hay nada que contar.
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola
-- transacción (si algo frena, no queda nada a medias) y con el rol dueño de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay alguna carta o algún producto oculto cargado
--     \i migraciones/reversiones/0043_revertir_carta_publica.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

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

  -- Con las tablas ya borradas (una repetición) no hay nada que contar.
  FOREACH v_tabla IN ARRAY ARRAY['carta_publica', 'disponibilidad_de_producto'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas (cartas públicas y productos ocultos) que esta reversión borraría (no se recuperan, y los QR impresos dejarían de andar): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- DROP TABLE no dispara los disparadores de borrado: se sacan junto con cada tabla.
DROP TABLE IF EXISTS disponibilidad_de_producto;
DROP TABLE IF EXISTS carta_publica;
DROP FUNCTION IF EXISTS disponibilidad_de_producto_validar();
DROP FUNCTION IF EXISTS carta_publica_validar();

-- La lista de permitidos de 0025, tal cual era (sin `¿ ¡ ? ! % $`). Conserva el EXECUTE de `pedernal_app`.
CREATE OR REPLACE FUNCTION texto_de_catalogo_valido(t text, p_maximo integer) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN t IS NULL OR p_maximo IS NULL OR char_length(t) NOT BETWEEN 1 AND p_maximo THEN false
    ELSE t = btrim(t)
      AND t ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°:;"#ºª’“”–—«»®™''][A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°+:;"#ºª’“”–—«»®™'' -]*$'
  END
$$;

-- Con la lista vieja ya puesta: ninguna fila guardada puede quedar inválida. Si alguna lo está, se frena y la transacción no deja nada hecho.
DO $$
DECLARE
  v_restriccion record;
  v_malas bigint;
BEGIN
  FOR v_restriccion IN
    SELECT c.conrelid::regclass::text AS tabla, c.conname AS nombre, pg_get_expr(c.conbin, c.conrelid) AS expresion
      FROM pg_constraint c
     WHERE c.contype = 'c' AND pg_get_expr(c.conbin, c.conrelid) LIKE '%texto_de_catalogo_valido%'
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE (%s) IS FALSE', v_restriccion.tabla, v_restriccion.expresion) INTO v_malas;
    IF v_malas > 0 THEN
      RAISE EXCEPTION 'hay % filas de % que la lista vieja de 0025 rechazaría (restricción %): corregir esos textos antes de revertir', v_malas, v_restriccion.tabla, v_restriccion.nombre
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0043_carta_publica.sql';
  END IF;
END
$$;
