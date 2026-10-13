-- 0010_revertir_autenticacion: deshace la migración 0010_autenticacion (las tablas de la librería de
-- autenticación, el vínculo persona <-> usuario y la puerta `SESION`).
-- EL NÚMERO ES PROVISORIO, como el de la migración: se renumera junto con ella.
--
-- DESTRUCTIVA: borra el esquema `autenticacion` entero (los usuarios, sus cuentas de Google, TODAS las sesiones
-- abiertas y los contadores de intentos) y la columna `persona.usuario_auth_id` (el vínculo de cada persona con su
-- usuario: sin él, nadie podría entrar a su empresa hasta volver a aceptar una invitación). Hay que AVISAR AL
-- DUEÑO y tener un respaldo antes de correrla (rama de Neon `antes-de-NNNN`). La salida normal es HACIA
-- ADELANTE: una migración nueva que corrija lo que haga falta.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la
-- carpeta `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de la base
-- (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL zuluhub.confirmar_reversion = 'SI';   -- solo si hay usuarios, sesiones o vínculos
--     \i migraciones/reversiones/0010_revertir_autenticacion.sql
--     COMMIT;
--
-- Deja el catálogo de 0001 a 0008 como estaba: quita las políticas y funciones de la sesión, devuelve
-- `persona_miembros_app` a su definición de 0002, quita la concesión de UPDATE sobre `persona.usuario_auth_id`, la
-- columna (con su restricción única y su disparador) y el esquema `autenticacion` con sus tablas. No usa CASCADE:
-- si otro objeto depende de lo que se borra (una clave foránea o una política de una migración posterior), el
-- DROP falla y no se pierde nada.
--
-- NO borra el rol `zuluhub_autenticacion`: los roles son del clúster y otras bases pueden usarlo. Le quita todo
-- acceso a esta base (queda como nació en 0004: sin tablas ni esquemas).

DO $$
DECLARE
  v_datos bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  SELECT (SELECT count(*) FROM autenticacion."user")
       + (SELECT count(*) FROM autenticacion.session)
       + (SELECT count(*) FROM autenticacion.account)
       + (SELECT count(*) FROM public.persona WHERE usuario_auth_id IS NOT NULL)
    INTO v_datos;
  IF v_datos > 0 AND coalesce(current_setting('zuluhub.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de usuarios, cuentas, sesiones o vínculos que esta reversión borraría: avisar al dueño, tener un respaldo y repetir con SET LOCAL zuluhub.confirmar_reversion = ''SI''', v_datos
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Las políticas nuevas de la sesión (y la guarda de `persona_miembros_app`, que vuelve a su forma de 0002).
DROP POLICY persona_invitado_vincular ON persona;
DROP POLICY tenant_sesion_leer ON tenant;
DROP POLICY empresa_sesion_leer ON empresa;
DROP POLICY membresia_sesion_leer ON membresia;
DROP POLICY persona_sesion_leer ON persona;
ALTER POLICY persona_miembros_app ON persona
  USING (
    EXISTS (
      SELECT 1 FROM membresia m
      WHERE m.persona_id = persona.id AND m.empresa_id = (SELECT app_empresa_id())
    )
  );

-- El vínculo: concesión, disparador, restricción única y columna.
REVOKE UPDATE (usuario_auth_id) ON persona FROM zuluhub_app;
DROP TRIGGER persona_vinculo_inmutable ON persona;
DROP FUNCTION persona_validar_vinculo();
ALTER TABLE persona DROP CONSTRAINT persona_usuario_auth_id_uk;
ALTER TABLE persona DROP COLUMN usuario_auth_id;

-- Las funciones de la sesión (primero la que usa a la otra).
DROP FUNCTION app_persona_de_sesion();
DROP FUNCTION app_usuario_auth();

-- El esquema de la librería, con sus tablas, índices, políticas y privilegios.
REVOKE ALL ON ALL TABLES IN SCHEMA autenticacion FROM zuluhub_autenticacion;
REVOKE ALL ON SCHEMA autenticacion FROM zuluhub_autenticacion;
DROP TABLE autenticacion."rateLimit";
DROP TABLE autenticacion.verification;
DROP TABLE autenticacion.account;
DROP TABLE autenticacion.session;
DROP TABLE autenticacion."user";
DROP SCHEMA autenticacion;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_autenticacion.sql' ESCAPE '\';
  END IF;
END
$$;
