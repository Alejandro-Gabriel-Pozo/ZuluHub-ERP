-- 0015_revertir_segundo_factor_de_plataforma: deshace la migración 0015_segundo_factor_de_plataforma (las tablas
-- `"twoFactor"`, `codigo_totp_usado` e `intento_segundo_factor`, la columna `"user"."twoFactorEnabled"` y la columna
-- `session.segundo_factor_en`).
--
-- DESTRUCTIVA en lo único que agregó 0015: borra los secretos TOTP (cifrados) y los códigos de recuperación (hasheados) de
-- cada administrador, la bandera de segundo factor de los usuarios y la marca de las sesiones. Cada administrador tendría que
-- volver a enrolar su aplicación autenticadora, y las sesiones de la consola quedarían sin segundo factor verificado. No
-- toca ninguna otra columna ni fila. Hay que AVISAR AL DUEÑO antes de correrla si hay datos de segundo factor. Ojo con el
-- código: la audiencia de plataforma declara esas tablas y columnas; sin ellas la consola no puede ingresar, así que conviene
-- bajar primero ese código (la web de empresa no las usa y sigue igual).
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta
-- `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el
-- conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL zuluhub.confirmar_reversion = 'SI';   -- solo si hay datos de segundo factor
--     \i migraciones/reversiones/0015_revertir_segundo_factor_de_plataforma.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0014. Los privilegios y las políticas se van con las tablas. No usa CASCADE: si
-- otro objeto depende de lo que se borra (una vista o una restricción de una migración posterior), el DROP falla y no se pierde
-- nada. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_secretos bigint := 0;
  v_usuarios bigint := 0;
  v_sesiones bigint := 0;
  v_pasos    bigint := 0;
  v_intentos bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con lo que ya se borró (una repetición) no hay nada que contar.
  IF to_regclass('autenticacion."twoFactor"') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM autenticacion."twoFactor"' INTO v_secretos;
  END IF;
  IF to_regclass('autenticacion.codigo_totp_usado') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM autenticacion.codigo_totp_usado' INTO v_pasos;
  END IF;
  IF to_regclass('autenticacion.intento_segundo_factor') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM autenticacion.intento_segundo_factor' INTO v_intentos;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'autenticacion."user"'::regclass AND attname = 'twoFactorEnabled' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT count(*) FROM autenticacion."user" WHERE "twoFactorEnabled"' INTO v_usuarios;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'autenticacion.session'::regclass AND attname = 'segundo_factor_en' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT count(*) FROM autenticacion.session WHERE segundo_factor_en IS NOT NULL' INTO v_sesiones;
  END IF;

  IF v_secretos + v_usuarios + v_sesiones + v_pasos + v_intentos > 0
     AND coalesce(current_setting('zuluhub.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay datos de segundo factor que esta reversión borraría (% secretos, % usuarios con segundo factor, % sesiones marcadas, % pasos usados, % intentos): avisar al dueño y repetir con SET LOCAL zuluhub.confirmar_reversion = ''SI''',
      v_secretos, v_usuarios, v_sesiones, v_pasos, v_intentos
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TABLE IF EXISTS autenticacion.intento_segundo_factor;
DROP TABLE IF EXISTS autenticacion.codigo_totp_usado;
DROP TABLE IF EXISTS autenticacion."twoFactor";
ALTER TABLE autenticacion.session DROP COLUMN IF EXISTS segundo_factor_en;
ALTER TABLE autenticacion."user" DROP COLUMN IF EXISTS "twoFactorEnabled";

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_segundo_factor_de_plataforma.sql' ESCAPE '\';
  END IF;
END
$$;
