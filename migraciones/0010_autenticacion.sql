-- 0010_autenticacion: las tablas de la librería de autenticación (esquema `autenticacion`, solo para el rol
-- `zuluhub_autenticacion`), el vínculo persona <-> usuario (`persona.usuario_auth_id`) y la puerta `SESION`
-- (claim firmado `s`): la aplicación lee, con solo la sesión, su persona y sus empresas, y nada más.
-- Armazón web y despliegue, §3.3, §4.2 y §4.6 (tramo W3a); ADR-011, ADR-013.
-- EL NÚMERO 0010 ES PROVISORIO: se renumera al integrar si otra migración entra antes (0009 es facturación,
-- en otra rama). El nombre `*_autenticacion.sql` y las pruebas no dependen del número.
--
-- Reglas de esta migración (las mismas de 0001 a 0008):
--  * Es ADITIVA: crea un esquema, tablas, una columna nula, funciones, un disparador y políticas. No modifica
--    ni borra ninguna fila, política ni privilegio existente. Su reversión es un script aparte, revisado y
--    DESTRUCTIVO (borra usuarios y sesiones): `migraciones/reversiones/0010_revertir_autenticacion.sql`. El
--    ejecutor no lo aplica.
--  * No agrega NINGUNA función SECURITY DEFINER: la única del esquema sigue siendo `contexto_firmado()` (un
--    meta-test lo exige) y NO cambia: el claim `s` viaja en el mismo payload firmado. Las funciones nuevas
--    corren con los permisos de quien consulta y sujetas a RLS.
--  * Toda función nueva fija `search_path = pg_catalog, public, pg_temp`, califica sus tablas con `public.` y
--    nace sin EXECUTE para PUBLIC; solo se otorga a quien la necesita.
--  * Nadie recibe TRUNCATE ni REFERENCES. DELETE solo lo recibe `zuluhub_autenticacion`, y solo sobre sus
--    propias tablas (cerrar sesión y el barrido de lo vencido). INSERT y UPDATE van por columna en `public`.
--  * RLS activa y FORZADA en toda tabla nueva. Ninguna política `FOR ALL`: cada comando tiene la suya.
--  * DEPENDE de 0004 (el rol `zuluhub_autenticacion` nació ahí, sin tablas) y de 0007 (`tenant.marca_id`);
--    se comprueba al empezar.
--  * NO da LOGIN ni contraseña al rol: lo hace quien administra la base (en las pruebas, `global.ts`; en Neon,
--    el dueño en cada rama, B4 del plan). Sin contraseñas, claves ni cadenas de conexión en este archivo.
--
-- Decisiones de diseño (todas probadas por tests; los números son de esta migración):
--
--  P1. La librería de autenticación vive en su propio esquema y su propio rol. `zuluhub_autenticacion` tiene
--      USAGE sobre `autenticacion` (sin CREATE) y SELECT/INSERT/UPDATE/DELETE sobre sus cinco tablas; sobre el
--      esquema `public` sigue sin nada (ni USAGE). Los demás roles no tocan el esquema `autenticacion`. Las
--      tablas llevan RLS forzada con una política por comando solo para ese rol: aunque alguien diera un
--      permiso de más por error, ningún otro rol vería filas. Las ids son uuid (`generateId: "uuid"`).
--  P2. `session.host` (NOT NULL) ata cada sesión al host en el que se creó (§4.3, G4): la misma tabla y el
--      mismo secreto sirven a todos los hosts, y sin esto una cookie copiada de la marca A valdría en la B.
--      La base solo guarda la columna; compararla con el host del pedido lo hace el adaptador (W3b).
--  P3. El vínculo persona <-> usuario es `persona.usuario_auth_id uuid NULL`, ÚNICO (varias personas sin
--      usuario conviven) e INMUTABLE una vez fijado (disparador `persona_vinculo_inmutable`, que frena
--      también al dueño). NO es una clave foránea: `public` no depende del esquema `autenticacion` (otro rol,
--      otra conexión) y borrar un usuario no debe arrastrar a la persona. Lo fija la aceptación de una
--      invitación, nunca una búsqueda por email (ADR-013): `zuluhub_app` recibe UPDATE de ESA columna, y la
--      política `persona_invitado_vincular` solo deja pasar el contexto de INVITACION, sobre la persona del
--      email de su invitación, mientras la columna está nula y apuntando al usuario firmado en `s`.
--  P4. Recursión de políticas. «Las membresías de la persona de la sesión» obliga a mirar `persona` desde
--      `membresia`, y `persona_miembros_app` (0002) ya mira `membresia` desde `persona`: si la política de
--      `membresia` consultara `persona` directamente, Postgres rechazaría el ciclo («infinite recursion
--      detected in policy») en TODA consulta de `membresia`, sea cual sea el contexto (probado). Se corta
--      resolviendo la persona de la sesión en una función común, `app_persona_de_sesion()`: Postgres no mira
--      dentro de las funciones al reescribir las políticas. Queda un círculo en tiempo de ejecución sobre el
--      papel (la función lee `persona`, cuya política de miembros lee `membresia`, cuya política de sesión
--      llama a la función...) que NO se produce porque la lectura de miembros filtra primero por
--      `empresa_id = app_empresa_id()` (un filtro barato y a prueba de fugas que el planificador evalúa antes
--      que las políticas) y la sesión no tiene empresa. Es una dependencia del orden de evaluación del
--      planificador, no una garantía del lenguaje: si fallara, fallaría CERRADO (error de pila, nunca filas
--      de más) y una prueba recorre todas las tablas con todos los contextos y distintos planes para
--      delatarlo. No se tocó `persona_miembros_app` a propósito: una guarda extra en una política vieja no
--      se puede probar (ningún plan la hace necesaria) y rompería lo aditivo de esta migración.
--  P5. Puerta `SESION` (rol `zuluhub_app`; contexto firmado con `s` y sin empresa ni persona): solo lectura
--      y solo lo propio. `persona`: la del usuario (activa). `membresia`: las activas de esa persona.
--      `empresa`: las de esas membresías. `tenant`: los de esas empresas. Ninguna política de escritura. El
--      contexto de INVITACION también lleva `s` (el invitado ya ingresó), así que estas lecturas también le
--      sirven: son lo mismo, lo propio del usuario autenticado. Sin `s` (todo otro contexto), las políticas
--      no dejan pasar nada.
--  P6. La marca NO se filtra en la base: el token no la lleva (igual que en el contexto operativo, §B.10). La
--      consulta de identidad filtra por `tenant.marca_id` con la marca que resolvió el servidor desde el host.
--  P7. `app_usuario_auth()` falla cerrado: un `s` que no sea un uuid canónico da NULL, no un error (a
--      diferencia de `e`/`p`, que lanzan al convertir): el contexto lo firma el servidor, pero esta función
--      está en el camino de TODA lectura de la sesión y un valor raro no debe tumbar consultas ajenas.

-- ---------------------------------------------------------------------------------------------
-- Verificaciones previas: se frena con un mensaje claro, sin haber cambiado nada
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuluhub_autenticacion') THEN
    RAISE EXCEPTION 'autenticación requiere 0004_plataforma aplicada antes (falta el rol zuluhub_autenticacion)'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenant' AND column_name = 'marca_id'
  ) THEN
    RAISE EXCEPTION 'autenticación requiere 0007_marcas_y_planes aplicada antes (falta tenant.marca_id)'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'autenticacion') THEN
    RAISE EXCEPTION 'el esquema autenticacion ya existe: esta migración no lo adopta (revisar a mano)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- El esquema de la librería de autenticación (P1). Las columnas son las que declara Better Auth 1.7.7
-- (`getAuthTables`, con `rateLimit.storage = "database"`, `generateId: "uuid"`), más `session.host` (P2).
-- El tipo de cada una sigue la regla de su generador para Postgres (texto, boolean, timestamptz, bigint).
-- ---------------------------------------------------------------------------------------------
CREATE SCHEMA autenticacion;
REVOKE ALL ON SCHEMA autenticacion FROM PUBLIC;

CREATE TABLE autenticacion."user" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  email            text NOT NULL,
  "emailVerified"  boolean NOT NULL DEFAULT false,
  image            text,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_email_uk UNIQUE (email)
);

CREATE TABLE autenticacion.session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "expiresAt"  timestamptz NOT NULL,
  token        text NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),
  "ipAddress"  text,
  "userAgent"  text,
  "userId"     uuid NOT NULL,
  -- P2: el host en el que se creó la sesión (el que resolvió el servidor, ya normalizado).
  host         text NOT NULL,
  CONSTRAINT session_token_uk UNIQUE (token),
  CONSTRAINT session_user_id_fkey FOREIGN KEY ("userId") REFERENCES autenticacion."user" (id) ON DELETE CASCADE,
  CONSTRAINT session_host_ck CHECK (host <> '' AND host = lower(btrim(host)))
);
CREATE INDEX session_user_id_ix ON autenticacion.session ("userId");

CREATE TABLE autenticacion.account (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId"              text NOT NULL,
  "providerId"             text NOT NULL,
  "userId"                 uuid NOT NULL,
  "accessToken"            text,
  "refreshToken"           text,
  "idToken"                text,
  "accessTokenExpiresAt"   timestamptz,
  "refreshTokenExpiresAt"  timestamptz,
  scope                    text,
  password                 text,
  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedAt"              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_user_id_fkey FOREIGN KEY ("userId") REFERENCES autenticacion."user" (id) ON DELETE CASCADE,
  -- Una cuenta de Google (su `sub`) es de un solo usuario: la librería no lo impone por sí sola.
  CONSTRAINT account_proveedor_sub_uq UNIQUE ("providerId", "accountId")
);
CREATE INDEX account_user_id_ix ON autenticacion.account ("userId");

CREATE TABLE autenticacion.verification (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier   text NOT NULL,
  value        text NOT NULL,
  "expiresAt"  timestamptz NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_ix ON autenticacion.verification (identifier);

CREATE TABLE autenticacion."rateLimit" (
  id             uuid DEFAULT gen_random_uuid(),
  key            text NOT NULL,
  count          integer NOT NULL,
  "lastRequest"  bigint NOT NULL,
  CONSTRAINT rate_limit_pkey PRIMARY KEY (id),
  CONSTRAINT rate_limit_key_uk UNIQUE (key)
);

GRANT USAGE ON SCHEMA autenticacion TO zuluhub_autenticacion;
REVOKE ALL ON ALL TABLES IN SCHEMA autenticacion FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  autenticacion."user", autenticacion.session, autenticacion.account,
  autenticacion.verification, autenticacion."rateLimit"
TO zuluhub_autenticacion;

-- RLS forzada, una política por comando y solo para ese rol (P1).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user', 'session', 'account', 'verification', 'rateLimit']
  LOOP
    EXECUTE format('ALTER TABLE autenticacion.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE autenticacion.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY rol_autenticacion_leer ON autenticacion.%I FOR SELECT TO zuluhub_autenticacion USING (true)', t);
    EXECUTE format(
      'CREATE POLICY rol_autenticacion_alta ON autenticacion.%I FOR INSERT TO zuluhub_autenticacion WITH CHECK (true)', t);
    EXECUTE format(
      'CREATE POLICY rol_autenticacion_cambiar ON autenticacion.%I FOR UPDATE TO zuluhub_autenticacion USING (true) WITH CHECK (true)', t);
    EXECUTE format(
      'CREATE POLICY rol_autenticacion_borrar ON autenticacion.%I FOR DELETE TO zuluhub_autenticacion USING (true)', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- El vínculo persona <-> usuario (P3)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE persona ADD COLUMN usuario_auth_id uuid;
ALTER TABLE persona ADD CONSTRAINT persona_usuario_auth_id_uk UNIQUE (usuario_auth_id);

-- Una vez fijado no se cambia ni se quita (ni por SQL directo del dueño): soporte lo resuelve a mano.
CREATE FUNCTION persona_validar_vinculo() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF OLD.usuario_auth_id IS NOT NULL AND NEW.usuario_auth_id IS DISTINCT FROM OLD.usuario_auth_id THEN
    RAISE EXCEPTION 'el vínculo de una persona con su usuario no se puede cambiar ni quitar'
      USING ERRCODE = '23514', CONSTRAINT = 'persona_usuario_auth_inmutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER persona_vinculo_inmutable BEFORE UPDATE OF usuario_auth_id ON persona
  FOR EACH ROW EXECUTE FUNCTION persona_validar_vinculo();

-- ---------------------------------------------------------------------------------------------
-- Funciones de contexto de la sesión. Corren con los permisos de quien consulta y sujetas a RLS; sin
-- contexto firmado, o sin `s`, valen NULL.
-- ---------------------------------------------------------------------------------------------

-- El usuario autenticado del contexto (P7: un `s` que no es un uuid canónico es NULL, nunca un error).
CREATE FUNCTION app_usuario_auth() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN c.s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN c.s::uuid
  END
  FROM (SELECT public.contexto_firmado()->>'s' AS s) AS c
$$;

-- La persona activa que ese usuario tiene vinculada (P4): NULL si no hay usuario, no hay vínculo o la
-- persona está suspendida. Es lo que resuelven las políticas de `membresia` y de `empresa`.
CREATE FUNCTION app_persona_de_sesion() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT p.id FROM public.persona p
   WHERE p.usuario_auth_id = public.app_usuario_auth() AND p.activo_global
$$;

GRANT EXECUTE ON FUNCTION app_usuario_auth(), app_persona_de_sesion() TO zuluhub_app;

-- ---------------------------------------------------------------------------------------------
-- Privilegios y políticas de `zuluhub_app`
-- ---------------------------------------------------------------------------------------------

-- Vincular (P3): una sola columna, y solo la deja pasar la política de abajo.
GRANT UPDATE (usuario_auth_id) ON persona TO zuluhub_app;

-- Lecturas de la sesión (P5). Solo SELECT.
CREATE POLICY persona_sesion_leer ON persona FOR SELECT TO zuluhub_app
  USING (usuario_auth_id = (SELECT app_usuario_auth()) AND activo_global);

CREATE POLICY membresia_sesion_leer ON membresia FOR SELECT TO zuluhub_app
  USING (
    CASE
      WHEN (SELECT app_usuario_auth()) IS NULL THEN false
      ELSE activo AND persona_id = (SELECT app_persona_de_sesion())
    END
  );

CREATE POLICY empresa_sesion_leer ON empresa FOR SELECT TO zuluhub_app
  USING (
    CASE
      WHEN (SELECT app_usuario_auth()) IS NULL THEN false
      ELSE id IN (
        SELECT m.empresa_id FROM membresia m
         WHERE m.activo AND m.persona_id = (SELECT app_persona_de_sesion())
      )
    END
  );

CREATE POLICY tenant_sesion_leer ON tenant FOR SELECT TO zuluhub_app
  USING (
    CASE
      WHEN (SELECT app_usuario_auth()) IS NULL THEN false
      ELSE id IN (
        SELECT e.tenant_id FROM empresa e
         WHERE e.id IN (
           SELECT m.empresa_id FROM membresia m
            WHERE m.activo AND m.persona_id = (SELECT app_persona_de_sesion())
         )
      )
    END
  );

-- Vincular la persona con el usuario (P3): solo el contexto de INVITACION (token firmado), solo la persona
-- del email de esa invitación, solo si está activa y sin vínculo, y solo hacia el usuario firmado en `s`. El
-- WITH CHECK repite el contexto (D8 de 0002: las políticas permisivas se suman con OR).
CREATE POLICY persona_invitado_vincular ON persona FOR UPDATE TO zuluhub_app
  USING (
    usuario_auth_id IS NULL
    AND activo_global
    AND (SELECT app_usuario_auth()) IS NOT NULL
    AND email = (SELECT i.email FROM invitacion i WHERE i.token_hash = (SELECT app_token_invitacion()))
  )
  WITH CHECK (
    usuario_auth_id = (SELECT app_usuario_auth())
    AND email = (SELECT i.email FROM invitacion i WHERE i.token_hash = (SELECT app_token_invitacion()))
  );
