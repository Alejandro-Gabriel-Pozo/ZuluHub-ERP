-- 0088_rol_autenticacion_de_plataforma: un rol de base PROPIO de la consola de plataforma para la librería de autenticación
-- (`pedernal_autenticacion_plataforma`), con los MISMOS privilegios mínimos que hoy tiene `pedernal_autenticacion` sobre las
-- tablas del esquema `autenticacion`. Decisión del dueño (2026-11-19, pregunta directa): la consola no comparte la credencial de
-- la web. Así la contraseña de la consola se crea, rota y revoca sin tocar la de la web (ni cortarla).
-- EL NÚMERO 0088 ES PROVISORIO: se renumera al integrar si otra migración entra antes.
--
-- LÍMITE DECLARADO (no se vende como lo que no es): esto separa la CREDENCIAL, no los DATOS. La web y la consola siguen usando
-- las mismas tablas (`user`, `session`, `account`, `verification`, `rateLimit` y las del segundo factor), con las audiencias
-- separadas por código, y las políticas RLS de cada rol son `USING (true)` como en 0010 y 0015. Aislar una audiencia de la otra
-- dentro de la base es otro tramo (cambia el modelo de datos y el comportamiento de la librería): queda anotado como hallazgo.
--
-- Reglas de esta migración (las mismas de 0001 a 0086):
--  * Es ADITIVA: crea un rol, concesiones y políticas. NO modifica ni quita nada de `pedernal_autenticacion` ni de ningún otro
--    rol. Su reversión es un script aparte, revisado: `migraciones/reversiones/0088_revertir_rol_autenticacion_de_plataforma.sql`.
--    El ejecutor no lo aplica.
--  * Es REPETIBLE: el rol se crea solo si falta, las concesiones repetidas no cambian nada y cada política se crea solo si falta.
--  * No agrega funciones (ninguna SECURITY DEFINER). Sin LOGIN, sin contraseña, sin cadenas de conexión: el login lo da el
--    workflow `cargar-entorno-consola.yml` (con la conexión del dueño), nunca esta migración.
--  * Nadie recibe TRUNCATE ni REFERENCES. Privilegios iguales a los de `pedernal_autenticacion` (0010, 0013 y 0015): DELETE solo
--    sobre `session`, `verification`, `rateLimit` y las dos tablas de intentos del segundo factor (NO sobre `user` ni `account`).
--    `"twoFactor"`: UPDATE solo de `secret`, `"backupCodes"` y `verified`.
--  * El rol nace sin ningún privilegio sobre `public` (ni USAGE del esquema) ni sobre las tablas de negocio.
--  * RLS: las tablas ya la tienen activa y FORZADA; acá solo se agrega, por cada comando concedido, una política para el rol
--    nuevo (nombre propio, sin pisar las de `pedernal_autenticacion`). Ninguna política `FOR ALL`.
--  * DEPENDE de 0004 (el rol `pedernal_autenticacion`, cuyos atributos y topes se copian), 0010, 0013 y 0015; se comprueba al empezar.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_autenticacion')
     OR to_regclass('autenticacion."user"') IS NULL
     OR to_regclass('autenticacion."twoFactor"') IS NULL
     OR to_regclass('autenticacion.intento_segundo_factor') IS NULL THEN
    RAISE EXCEPTION '0088 requiere 0004, 0010 y 0015 aplicadas antes (falta el rol o las tablas de la autenticación)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- El rol (a nivel de clúster: se crea solo si falta). Mismos atributos y topes que 0004.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  r constant text := 'pedernal_autenticacion_plataforma';
  ajenas text;
  topes constant text[] := ARRAY[
    'statement_timeout=30s', 'idle_in_transaction_session_timeout=60s', 'lock_timeout=15s'
  ];
  tope text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    EXECUTE format(
      'CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT',
      r
    );
  END IF;

  -- Igual que en 0001: un rol limitado no puede heredar poderes de otro.
  SELECT string_agg(format('%s es miembro de %s', m.rolname, g.rolname), ', ' ORDER BY g.rolname)
    INTO ajenas
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles g ON g.oid = am.roleid
   WHERE m.rolname = r;
  IF ajenas IS NOT NULL THEN
    RAISE EXCEPTION 'los roles de Pedernal no pueden ser miembros de otros roles (%): revocar la pertenencia y repetir', ajenas
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = r
       AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit)
  ) THEN
    EXECUTE format(
      'ALTER ROLE %I NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT', r
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

  -- Sin objetos temporales (cierra la suplantación por `pg_temp`, como en 0001).
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM %I', current_database(), r);
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Privilegios: los mismos que `pedernal_autenticacion` (0010 + 0013 + 0015), nada más.
-- ---------------------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA autenticacion TO pedernal_autenticacion_plataforma;

GRANT SELECT, INSERT, UPDATE ON autenticacion."user", autenticacion.account
  TO pedernal_autenticacion_plataforma;
GRANT SELECT, INSERT, UPDATE, DELETE ON autenticacion.session, autenticacion.verification, autenticacion."rateLimit"
  TO pedernal_autenticacion_plataforma;
GRANT SELECT, INSERT ON autenticacion."twoFactor" TO pedernal_autenticacion_plataforma;
GRANT UPDATE (secret, "backupCodes", verified) ON autenticacion."twoFactor" TO pedernal_autenticacion_plataforma;
GRANT SELECT, INSERT, DELETE ON autenticacion.codigo_totp_usado, autenticacion.intento_segundo_factor
  TO pedernal_autenticacion_plataforma;

-- Una política por comando concedido y solo para el rol nuevo (como 0010 y 0015, con nombre propio).
DO $$
DECLARE
  t text;
  c text;
  comandos constant jsonb := jsonb_build_object(
    'user', ARRAY['SELECT', 'INSERT', 'UPDATE'],
    'account', ARRAY['SELECT', 'INSERT', 'UPDATE'],
    'session', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    'verification', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    'rateLimit', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    'twoFactor', ARRAY['SELECT', 'INSERT', 'UPDATE'],
    'codigo_totp_usado', ARRAY['SELECT', 'INSERT', 'DELETE'],
    'intento_segundo_factor', ARRAY['SELECT', 'INSERT', 'DELETE']
  );
  nombres constant jsonb := jsonb_build_object(
    'SELECT', 'rol_autenticacion_plataforma_leer', 'INSERT', 'rol_autenticacion_plataforma_alta',
    'UPDATE', 'rol_autenticacion_plataforma_cambiar', 'DELETE', 'rol_autenticacion_plataforma_borrar'
  );
BEGIN
  FOR t IN SELECT jsonb_object_keys(comandos)
  LOOP
    EXECUTE format('ALTER TABLE autenticacion.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE autenticacion.%I FORCE ROW LEVEL SECURITY', t);
    FOR c IN SELECT jsonb_array_elements_text(comandos -> t)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'autenticacion' AND tablename = t AND policyname = nombres ->> c
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON autenticacion.%I FOR %s TO pedernal_autenticacion_plataforma %s',
          nombres ->> c, t, c,
          CASE c
            WHEN 'INSERT' THEN 'WITH CHECK (true)'
            WHEN 'UPDATE' THEN 'USING (true) WITH CHECK (true)'
            ELSE 'USING (true)'
          END
        );
      END IF;
    END LOOP;
  END LOOP;
END
$$;
