-- 0098_revertir_correccion_de_lo_recibido: deshace 0098: borra la tabla `correccion_de_lo_recibido`, su función y su disparador y quita el permiso de UPDATE de `cantidad_recibida`.
-- DESTRUCTIVA si hay correcciones: PIERDE su historial y deja `saldo_de_linea_de_recepcion.cantidad_recibida` con el valor corregido sin la fila que lo explica. FRENA (55000) si existe alguna;
-- hay que AVISAR AL DUEÑO y resolver a mano (volver cada línea a su cantidad original con una corrección inversa) antes. Los dos motivos de stock sembrados no se borran (tabla de solo inserción).
-- Se corre a mano, revisada, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada). No usa CASCADE. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_filas bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  -- Dinámico: sin la tabla (segunda corrida) la consulta no se puede ni planificar.
  IF to_regclass('public.correccion_de_lo_recibido') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.correccion_de_lo_recibido' INTO v_filas;
  END IF;
  IF v_filas > 0 THEN
    RAISE EXCEPTION 'hay % correcciones de lo recibido: no se revierte (perdería su historial); resolverlas a mano antes', v_filas USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los disparadores de la tabla se van con ella (DROP TABLE no usa CASCADE: nada más depende de ella).
DROP TABLE IF EXISTS correccion_de_lo_recibido;
DROP FUNCTION IF EXISTS correccion_de_lo_recibido_aplicar();
REVOKE UPDATE (cantidad_recibida) ON saldo_de_linea_de_recepcion FROM pedernal_app;
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0098_correccion_de_lo_recibido.sql';
  END IF;
END
$$;
