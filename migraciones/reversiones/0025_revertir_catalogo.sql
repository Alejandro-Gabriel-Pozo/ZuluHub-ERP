-- 0025_revertir_catalogo: deshace la migración 0025_catalogo (las nueve tablas del catálogo mínimo: unidad_de_medida, seccion_de_carta,
-- producto, grupo_de_elecciones, opcion, version_de_opcion, consumo_de_opcion, precio_de_venta y copia_de_opciones, con sus funciones y
-- disparadores). EL NÚMERO ES PROVISORIO, como el de la migración: se renumera junto con ella.
--
-- DESTRUCTIVA si hay datos: BORRA todos los productos, opciones, precios (con su historial) y consumos cargados, y eso NO SE RECUPERA. No
-- toca ninguna otra tabla. Hay que AVISAR AL DUEÑO antes de correrla si hay alguna fila. Ojo con el código: el módulo `catalogo` lee esas
-- tablas; sin ellas sus casos de uso y consultas fallan, así que conviene bajar primero ese código. Una venta que ya haya sellado un
-- `precioId` o un `versionDeOpcionId` (E4) perdería su referencia: la reversión falla (clave foránea) si existe una tabla posterior que
-- las usa, y no se pierde nada.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay algún dato de catálogo cargado
--     \i migraciones/reversiones/0025_revertir_catalogo.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0024. No usa CASCADE: si otro objeto depende de una tabla (una clave foránea de una migración
-- posterior), el DROP falla y no se pierde nada. Se puede repetir sin que cambie nada. `unidad_de_medida` es una tabla sembrada (14
-- filas fijas): no cuenta como dato a perder.

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
  FOREACH v_tabla IN ARRAY ARRAY['seccion_de_carta', 'producto', 'grupo_de_elecciones', 'opcion', 'version_de_opcion',
                                 'consumo_de_opcion', 'precio_de_venta', 'copia_de_opciones'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de catálogo (productos, opciones, precios, consumos) que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- `precio_vigente` devuelve el tipo de la fila de `precio_de_venta`: se baja primero (con la tabla, el DROP TABLE sin CASCADE fallaría).
DROP FUNCTION IF EXISTS precio_vigente(uuid, uuid, uuid, uuid, timestamptz);

-- Los disparadores de borrado y de solo inserción frenan hasta al dueño de la base: se sacan junto con cada tabla (DROP TABLE no los
-- dispara) en el orden inverso de las claves foráneas.
DROP TABLE IF EXISTS copia_de_opciones;
DROP TABLE IF EXISTS precio_de_venta;
DROP TABLE IF EXISTS consumo_de_opcion;
DROP TABLE IF EXISTS version_de_opcion;
DROP TABLE IF EXISTS opcion;
DROP TABLE IF EXISTS grupo_de_elecciones;
DROP TABLE IF EXISTS producto;
DROP TABLE IF EXISTS seccion_de_carta;
DROP TABLE IF EXISTS unidad_de_medida;

DROP FUNCTION IF EXISTS precio_de_venta_validar();
DROP FUNCTION IF EXISTS consumo_de_opcion_validar();
DROP FUNCTION IF EXISTS version_de_opcion_validar();
DROP FUNCTION IF EXISTS opcion_validar();
DROP FUNCTION IF EXISTS grupo_de_elecciones_validar();
DROP FUNCTION IF EXISTS producto_validar();
DROP FUNCTION IF EXISTS texto_de_catalogo_valido(text, integer);

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_catalogo.sql' ESCAPE '\';
  END IF;
END
$$;
