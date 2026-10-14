-- 0012_respaldo: el rol exclusivo de respaldo, `zuluhub_respaldo` (especificación `respaldo-y-recuperacion.md`
-- §B.3 del repositorio de documentos; DECIDIDO por el dueño 2026-10-14: un rol de solo lectura, con credenciales
-- propias, ÚNICO con permiso de saltar el aislamiento).
-- EL NÚMERO ES PROVISORIO: lo asigna quien integra (si otra migración toma el 0012, se renumera este archivo y su
-- reversión; la regla del registro de contratos exige que un número no se repita).
--
-- Qué hace:
--  * Crea el rol a nivel de clúster solo si falta: NOLOGIN al nacer (lo activa el dueño con
--    `npm run migrar -- --preparar-roles --con-respaldo`), BYPASSRLS (sin eso `pg_dump` falla o copia de menos ante
--    tablas con RLS forzado), sin superusuario, sin crear roles ni bases, sin replicación, sin herencia y con a lo
--    sumo 2 conexiones. Si ya existía con otros atributos, se le fuerzan estos.
--  * Frena si el rol es miembro de otro rol, o si otro rol es miembro de él (heredaría sus lecturas).
--  * Topes por rol: un volcado lee tablas enteras (más que los 30 s de los roles de la aplicación) pero no puede
--    quedar colgado ni bloquear una migración; y cada sesión arranca de SOLO LECTURA.
--  * USAGE en los esquemas de ZuluHub y SELECT en todas sus tablas y secuencias, también las que creen las
--    migraciones siguientes (privilegios por defecto del rol que migra). Nada más: ni escritura, ni TEMPORARY.
--
-- No es destructiva y no toca datos. Su reversión está en `reversiones/0012_revertir_respaldo.sql`.

DO $$
DECLARE
  r constant text := 'zuluhub_respaldo';
  ajenas text;
  topes constant text[] := ARRAY[
    'statement_timeout=15min', 'idle_in_transaction_session_timeout=10min', 'lock_timeout=30s',
    'default_transaction_read_only=on'
  ];
  tope text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    EXECUTE format(
      'CREATE ROLE %I NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT CONNECTION LIMIT 2',
      r
    );
  END IF;

  -- Ni miembro de otro rol (heredaría poderes, el caso de `neon_superuser`), ni con miembros (heredarían su lectura total).
  SELECT string_agg(format('%s es miembro de %s', m.rolname, g.rolname), ', ' ORDER BY m.rolname, g.rolname)
    INTO ajenas
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles g ON g.oid = am.roleid
   WHERE m.rolname = r OR g.rolname = r;
  IF ajenas IS NOT NULL THEN
    RAISE EXCEPTION 'el rol de respaldo no puede tener pertenencias (%): revocarlas y repetir', ajenas
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = r
       AND (rolsuper OR NOT rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit
            OR rolconnlimit <> 2)
  ) THEN
    EXECUTE format(
      'ALTER ROLE %I NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT CONNECTION LIMIT 2',
      r
    );
  END IF;

  FOREACH tope IN ARRAY topes
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_db_role_setting s
        JOIN pg_roles ro ON ro.oid = s.setrole
       WHERE ro.rolname = r AND s.setdatabase = 0 AND tope = ANY (s.setconfig)
    ) THEN
      EXECUTE format('ALTER ROLE %I SET %s = %L', r, split_part(tope, '=', 1), split_part(tope, '=', 2));
    END IF;
  END LOOP;

  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM %I', current_database(), r);
END
$$;

GRANT USAGE ON SCHEMA public, autenticacion TO zuluhub_respaldo;
GRANT SELECT ON ALL TABLES IN SCHEMA public, autenticacion TO zuluhub_respaldo;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, autenticacion TO zuluhub_respaldo;
-- Lo que creen las migraciones siguientes (las corre el mismo rol dueño) también lo lee: una tabla nueva no deja
-- la copia incompleta (lo comprueba `respaldo-rol.test.ts`, regla RS4).
ALTER DEFAULT PRIVILEGES IN SCHEMA public, autenticacion GRANT SELECT ON TABLES TO zuluhub_respaldo;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, autenticacion GRANT SELECT ON SEQUENCES TO zuluhub_respaldo;
