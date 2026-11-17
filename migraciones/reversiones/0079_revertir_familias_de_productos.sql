-- 0079_revertir_familias_de_productos: deshace 0079_familias_de_productos: borra `familia_de_producto` y `miembro_de_familia` (con sus funciones, disparadores, políticas y la lectura del rol público).
--
-- DESTRUCTIVA si hay datos: BORRA las familias armadas y su historia de miembros (quién agregó y quitó qué). Los productos, sus precios y su stock NO se tocan. Hay que AVISAR AL DUEÑO
-- antes de correrla si hay alguna fila. ORDEN: si 0080 y 0081 están aplicadas hay que revertirlas ANTES (apuntan a `familia_de_producto`): este script falla con un error de
-- dependencia y no cambia nada si no se hace. El código del catálogo que lee estas tablas falla sin ellas: conviene bajarlo primero.
--
-- Este script NO lo aplica el ejecutor de migraciones: se corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay alguna familia cargada
--     \i migraciones/reversiones/0079_revertir_familias_de_productos.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_tabla text;
  v_filas bigint;
  v_total bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['familia_de_producto', 'miembro_de_familia'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas (familias y miembros) que esta reversión borraría: avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- DROP TABLE no dispara los disparadores de borrado: se sacan junto con cada tabla.
DROP TABLE IF EXISTS miembro_de_familia;
DROP TABLE IF EXISTS familia_de_producto;
DROP FUNCTION IF EXISTS miembro_de_familia_validar();
DROP FUNCTION IF EXISTS familia_de_producto_validar();

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0079_familias_de_productos.sql';
  END IF;
END
$$;
