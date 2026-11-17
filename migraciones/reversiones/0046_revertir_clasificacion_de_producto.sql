-- 0046_revertir_clasificacion_de_producto: deshace la migración 0046_clasificacion_de_producto: borra la tabla `clasificacion_de_producto` con sus disparadores y políticas, y
-- la función de validación.
--
-- DESTRUCTIVA si hay datos: BORRA todos los vínculos producto → nodo de todas las empresas, con su historial de fechas (no se recuperan: la auditoría guarda los cambios, no la
-- fila). Hay que AVISAR AL DUEÑO antes de correrla si hay alguna fila. Si 0047 (el camino copiado al renglón de venta) está aplicada, hay que revertirla ANTES. Conviene bajar
-- primero el código que lee la tabla.
--
-- Este script NO lo aplica el ejecutor de migraciones (solo toma los `NNNN_nombre.sql` de `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de
-- la base (que evade RLS, o el conteo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay algún vínculo cargado
--     \i migraciones/reversiones/0046_revertir_clasificacion_de_producto.sql
--     COMMIT;
--
-- No usa CASCADE. Solo borra su propia fila del registro `migracion`, para poder volver a aplicarla. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_filas bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.clasificacion_de_producto') IS NOT NULL THEN
    SELECT count(*) INTO v_filas FROM public.clasificacion_de_producto;
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % vínculos de clasificación que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- DROP TABLE no dispara los disparadores de borrado: se sacan junto con la tabla.
DROP TABLE IF EXISTS clasificacion_de_producto;
DROP FUNCTION IF EXISTS clasificacion_de_producto_validar();

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0046_clasificacion_de_producto.sql';
  END IF;
END
$$;
