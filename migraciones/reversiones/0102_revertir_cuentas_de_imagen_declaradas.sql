-- 0102_revertir_cuentas_de_imagen_declaradas: deshace 0102 (cuentas de imagen declaradas por empresa y su defensa sobre el logo de la carta).
-- DESTRUCTIVA si hay cuentas declaradas (activas o retiradas): PIERDE quién declaró y retiró cada una. FRENA (55000) si existe al menos una fila; AVISAR AL DUEÑO y resolver con respaldo, fuera de
-- esta reversión. Quitar el disparador de `carta_publica` no cambia ninguna carta: solo deja de exigir la declaración al guardar un logo. Revertir el código y la base juntos: con el código nuevo
-- sin la tabla, la lectura pública de cuentas falla cerrada (el logo no se muestra).
-- Se corre a mano, revisada, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada). No usa CASCADE. Se puede repetir sin que cambie nada.
--
--     BEGIN;
--     \i migraciones/reversiones/0102_revertir_cuentas_de_imagen_declaradas.sql
--     COMMIT;

DO $$
DECLARE
  v_filas bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada' USING ERRCODE = '55000';
  END IF;
  -- Dinámico: sin la tabla (segunda corrida) la consulta no se puede ni planificar.
  IF to_regclass('public.cuenta_de_imagen_declarada') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.cuenta_de_imagen_declarada' INTO v_filas;
  END IF;
  IF v_filas > 0 THEN
    RAISE EXCEPTION 'hay % cuentas de imagen declaradas: no se revierte (perdería quién las declaró y retiró); avisar al dueño y resolver con respaldo', v_filas USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS carta_publica_logo_declarado ON carta_publica;
DROP FUNCTION IF EXISTS carta_publica_logo_declarado();
-- Los disparadores, las políticas y los índices de la tabla se van con ella (nada más depende de ella).
DROP TABLE IF EXISTS cuenta_de_imagen_declarada;
DROP FUNCTION IF EXISTS cuenta_de_imagen_tope();
DROP FUNCTION IF EXISTS cuenta_de_imagen_cambia();
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0102_cuentas_de_imagen_declaradas.sql';
  END IF;
END
$$;
