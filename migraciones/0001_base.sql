-- 0001_base: instalación, tenant, empresa, sucursal, identidad mínima, auditorías, trabajos,
-- roles de base y aislamiento por RLS (H2; ADR-004, ADR-007, ADR-011).
--
-- Reglas de esta migración:
--  * No lleva contraseñas ni cadenas de conexión. Los roles nacen NOLOGIN; quien administra la
--    base les da LOGIN y contraseña fuera del repositorio.
--  * Es compatible hacia atrás: crea objetos nuevos, no borra ni reescribe nada.
--  * Se ejecuta como el rol dueño de la base (en Neon, el rol por defecto del proyecto).
--  * Endurecimiento contra suplantación: ningún rol limitado puede crear objetos temporales
--    (REVOKE TEMPORARY) y toda función fija su search_path y califica las tablas con `public.`.
--    Postgres busca `pg_temp` primero para las relaciones sin esquema: sin estas dos defensas, un
--    rol con SQL arbitrario crearía `TEMP TABLE empresa/tenant` falsas y saltearía las políticas.

-- ---------------------------------------------------------------------------------------------
-- Roles (a nivel de clúster: se crean solo si faltan)
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  r text;
  ajenas text;
  topes constant text[] := ARRAY[
    'statement_timeout=30s', 'idle_in_transaction_session_timeout=60s', 'lock_timeout=15s'
  ];
  tope text;
BEGIN
  FOREACH r IN ARRAY ARRAY['zuluhub_app', 'zuluhub_grupo', 'zuluhub_trabajos', 'zuluhub_plataforma']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT',
        r
      );
    END IF;
  END LOOP;

  -- Un rol limitado no puede heredar poderes de otro (por ejemplo, `neon_superuser` en Neon):
  -- se frena la migración en vez de seguir con un rol que evade lo que acá se configura.
  SELECT string_agg(format('%s es miembro de %s', m.rolname, g.rolname), ', ' ORDER BY m.rolname, g.rolname)
    INTO ajenas
    FROM pg_auth_members am
    JOIN pg_roles m ON m.oid = am.member
    JOIN pg_roles g ON g.oid = am.roleid
   WHERE m.rolname = ANY (ARRAY['zuluhub_app', 'zuluhub_grupo', 'zuluhub_trabajos', 'zuluhub_plataforma']);
  IF ajenas IS NOT NULL THEN
    RAISE EXCEPTION 'los roles de ZuluHub no pueden ser miembros de otros roles (%): revocar la pertenencia y repetir', ajenas
      USING ERRCODE = '55000';
  END IF;

  FOREACH r IN ARRAY ARRAY['zuluhub_app', 'zuluhub_grupo', 'zuluhub_trabajos', 'zuluhub_plataforma']
  LOOP
    -- Si el rol ya existía (por ejemplo, creado a mano), se le fuerzan los atributos seguros. Solo
    -- se escribe el catálogo si algo difiere: así repetir la migración no compite con otras sesiones.
    IF EXISTS (
      SELECT 1 FROM pg_roles
       WHERE rolname = r
         AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit)
    ) THEN
      EXECUTE format(
        'ALTER ROLE %I NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT',
        r
      );
    END IF;

    -- Topes de tiempo por rol: una consulta, una transacción abierta o una espera de bloqueo
    -- descontroladas no pueden colgar la base.
    FOREACH tope IN ARRAY topes
    LOOP
      IF NOT EXISTS (
        SELECT 1
          FROM pg_db_role_setting s
          JOIN pg_roles ro ON ro.oid = s.setrole
         WHERE ro.rolname = r AND s.setdatabase = 0 AND tope = ANY (s.setconfig)
      ) THEN
        EXECUTE format(
          'ALTER ROLE %I SET %s = %L', r, split_part(tope, '=', 1), split_part(tope, '=', 2)
        );
      END IF;
    END LOOP;
  END LOOP;
END
$$;

-- Sin objetos temporales para nadie más que el dueño: cierra la suplantación por `pg_temp`.
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format(
    'REVOKE TEMPORARY ON DATABASE %I FROM zuluhub_app, zuluhub_grupo, zuluhub_trabajos, zuluhub_plataforma',
    current_database()
  );
END
$$;
-- Nadie crea objetos en el esquema público salvo el dueño (en Postgres 15+ ya viene así).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Las funciones futuras nacen cerradas: hay que otorgar EXECUTE a propósito. Se hace sobre las
-- funciones que cree el rol dueño en esta base (sin `IN SCHEMA`: el privilegio implícito de PUBLIC
-- es global, y un REVOKE limitado a un esquema no lo quita).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- Funciones. TODAS fijan `search_path = pg_catalog, public, pg_temp` (pg_temp al final) y nombran
-- sus tablas con `public.`: un test del catálogo lo exige para cada función del esquema.
--
-- Funciones de contexto: el servidor las fija por transacción con set_config(..., true).
-- Sin contexto devuelven NULL y las políticas no dejan ver ninguna fila.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app_empresa_id() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT nullif(current_setting('app.empresa_id', true), '')::uuid $$;

CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_persona_id() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT nullif(current_setting('app.persona_id', true), '')::uuid $$;

-- CUIT: 11 dígitos y dígito verificador módulo 11 (pesos 5,4,3,2,7,6,5,4,3,2). Misma regla que
-- primitivas/identificacion-fiscal; un test compara ambas.
CREATE FUNCTION cuit_valido(c text) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN c IS NULL OR c !~ '^[0-9]{11}$' THEN false
    ELSE (
      SELECT CASE r WHEN 11 THEN 0 WHEN 10 THEN -1 ELSE r END
      FROM (
        SELECT 11 - (sum(substr(c, i, 1)::int * (ARRAY[5,4,3,2,7,6,5,4,3,2])[i]) % 11) AS r
        FROM generate_series(1, 10) AS i
      ) AS calculo
    ) = substr(c, 11, 1)::int
  END
$$;

-- Zona horaria IANA conocida por la base. La valida un disparador y no un CHECK: la lista depende
-- de la versión de tzdata del servidor, y un CHECK que cambia de valor rompería restauraciones.
CREATE FUNCTION zona_horaria_valida(z text) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = z) $$;

-- ---------------------------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------------------------
CREATE TABLE instalacion (
  id        boolean PRIMARY KEY DEFAULT true CONSTRAINT instalacion_unica CHECK (id),
  modo      text NOT NULL CONSTRAINT instalacion_modo_ck CHECK (modo IN ('MULTI', 'SINGLE')),
  creado_en timestamptz NOT NULL DEFAULT now()
);
INSERT INTO instalacion (modo) VALUES ('MULTI');

CREATE TABLE tenant (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         text NOT NULL
                 CONSTRAINT tenant_nombre_ck CHECK (nombre !~ '^\s|\s$' AND nombre <> ''),
  estado         text NOT NULL DEFAULT 'ACTIVE'
                 CONSTRAINT tenant_estado_ck CHECK (estado IN ('ACTIVE', 'SUSPENDED')),
  motivo_estado  text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT tenant_motivo_ck CHECK (
    (estado = 'SUSPENDED') = (motivo_estado IS NOT NULL AND btrim(motivo_estado) <> '')
  )
);

CREATE TABLE empresa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant (id),
  cuit           text NOT NULL CONSTRAINT empresa_cuit_ck CHECK (cuit_valido(cuit)),
  razon_social   text NOT NULL
                 CONSTRAINT empresa_razon_social_ck CHECK (razon_social !~ '^\s|\s$' AND razon_social <> ''),
  estado         text NOT NULL DEFAULT 'PROVISIONING'
                 CONSTRAINT empresa_estado_ck CHECK (
                   estado IN ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'DELETING')
                 ),
  motivo_estado  text,
  zona_horaria   text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',  -- validada por disparador
  moneda         char(3) NOT NULL DEFAULT 'ARS'
                 CONSTRAINT empresa_moneda_ck CHECK (moneda = 'ARS'),  -- v1: solo pesos (ADR-006)
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT empresa_motivo_ck CHECK (
    estado NOT IN ('SUSPENDED', 'CANCELLED') OR (motivo_estado IS NOT NULL AND btrim(motivo_estado) <> '')
  )
);
-- El CUIT es único en toda la instalación entre empresas no canceladas: una alta cancelada nunca
-- operó y su CUIT se puede volver a usar (caso 0c).
CREATE UNIQUE INDEX empresa_cuit_uk ON empresa (cuit) WHERE estado <> 'CANCELLED';
CREATE INDEX empresa_tenant_ix ON empresa (tenant_id);

CREATE TABLE sucursal (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  nombre         text NOT NULL
                 CONSTRAINT sucursal_nombre_ck CHECK (nombre !~ '^\s|\s$' AND nombre <> ''),
  activa         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT sucursal_id_empresa_uk UNIQUE (id, empresa_id)  -- para FK compuestas de tablas hijas
);
CREATE UNIQUE INDEX sucursal_nombre_uk ON sucursal (empresa_id, lower(nombre));

-- Identidad mínima: lo justo para ligar al dueño del grupo. Personas, membresías e invitaciones
-- completas llegan en H3.
CREATE TABLE persona (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL CONSTRAINT persona_email_ck CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  activo_global boolean NOT NULL DEFAULT true,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT persona_email_uk UNIQUE (email)
);

CREATE TABLE membresia_tenant (
  persona_id uuid NOT NULL REFERENCES persona (id),
  tenant_id  uuid NOT NULL REFERENCES tenant (id),
  rol        text NOT NULL CONSTRAINT membresia_tenant_rol_ck CHECK (rol IN ('PROPIETARIO')),
  activo     boolean NOT NULL DEFAULT true,
  creado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (persona_id, tenant_id)
);

-- Auditorías: solo inserción (un disparador lo impide hasta para el dueño de la tabla).
CREATE TABLE auditoria_empresa (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id       uuid NOT NULL REFERENCES empresa (id),
  actor_persona_id uuid REFERENCES persona (id),  -- NULL: actor de sistema
  accion           text NOT NULL CONSTRAINT auditoria_empresa_accion_ck CHECK (accion <> ''),
  entidad          text NOT NULL,
  entidad_id       text NOT NULL,
  antes            jsonb,
  despues          jsonb,
  creado_en        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_empresa_ix ON auditoria_empresa (empresa_id, id);

CREATE TABLE auditoria_plataforma (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor      text NOT NULL CONSTRAINT auditoria_plataforma_actor_ck CHECK (actor <> ''),
  accion     text NOT NULL CONSTRAINT auditoria_plataforma_accion_ck CHECK (accion <> ''),
  entidad    text NOT NULL,
  entidad_id text NOT NULL,
  antes      jsonb,
  despues    jsonb,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

-- Quién consultó la vista de grupo y de qué empresa (acceso, no contenido).
CREATE TABLE auditoria_acceso_grupo (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenant (id),
  persona_id uuid NOT NULL REFERENCES persona (id),
  empresa_id uuid REFERENCES empresa (id),  -- NULL: consultó la lista
  creado_en  timestamptz NOT NULL DEFAULT now()
);

-- Cola de trabajos (ADR-007). Sin secretos en `datos`.
CREATE TABLE trabajo (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid REFERENCES empresa (id),  -- NULL: ámbito plataforma
  tipo               text NOT NULL CONSTRAINT trabajo_tipo_ck CHECK (tipo <> ''),
  datos              jsonb NOT NULL DEFAULT '{}'::jsonb,
  clave_idempotencia text NOT NULL CONSTRAINT trabajo_clave_ck CHECK (clave_idempotencia <> ''),
  estado             text NOT NULL DEFAULT 'PENDIENTE'
                     CONSTRAINT trabajo_estado_ck CHECK (estado IN ('PENDIENTE', 'EN_CURSO', 'HECHO', 'FALLIDO')),
  intentos           integer NOT NULL DEFAULT 0 CONSTRAINT trabajo_intentos_ck CHECK (intentos >= 0),
  proximo_intento    timestamptz NOT NULL DEFAULT now(),
  tomado_hasta       timestamptz,
  ultimo_error       text,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  -- La clave es única por empresa (dos empresas pueden usar la misma) y, para el ámbito plataforma
  -- (empresa_id NULL), entre todos los trabajos de plataforma: NULLS NOT DISTINCT (Postgres 15+).
  CONSTRAINT trabajo_clave_uk UNIQUE NULLS NOT DISTINCT (empresa_id, clave_idempotencia)
);
CREATE INDEX trabajo_pendientes_ix ON trabajo (proximo_intento) WHERE estado IN ('PENDIENTE', 'EN_CURSO');

-- ---------------------------------------------------------------------------------------------
-- Disparadores: invariantes que la base impone aunque el código se olvide
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION fijar_version_y_fecha() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.actualizado_en := now();
  RETURN NEW;
END
$$;

CREATE FUNCTION fijar_fecha() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END
$$;

CREATE FUNCTION empresa_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'la empresa no se puede reasignar a otro tenant'
      USING ERRCODE = '23514', CONSTRAINT = 'empresa_tenant_inmutable';
  END IF;
  IF NEW.estado <> OLD.estado AND NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('PROVISIONING', 'ACTIVE'),
      ('PROVISIONING', 'CANCELLED'),
      ('ACTIVE', 'SUSPENDED'),
      ('SUSPENDED', 'ACTIVE'),
      ('ACTIVE', 'DELETING'),
      ('SUSPENDED', 'DELETING')
    ) AS permitida (desde, hasta)
    WHERE permitida.desde = OLD.estado AND permitida.hasta = NEW.estado
  ) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'empresa_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

-- Una empresa nueva solo se da de alta en un tenant ACTIVE (precondición de diseno-inicial §6.2).
-- El FOR SHARE toma el bloqueo de la fila del tenant: una suspensión concurrente espera a que esta
-- alta termine, o la alta ve la suspensión ya confirmada. Un tenant inexistente lo rechaza la
-- clave foránea (empresa_tenant_id_fkey), no esta función.
CREATE FUNCTION empresa_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
BEGIN
  SELECT t.estado INTO v_estado FROM public.tenant t WHERE t.id = NEW.tenant_id FOR SHARE;
  IF FOUND AND v_estado <> 'ACTIVE' THEN
    RAISE EXCEPTION 'el tenant no está activo: no se pueden dar de alta empresas'
      USING ERRCODE = '23514', CONSTRAINT = 'empresa_tenant_no_activo';
  END IF;
  RETURN NEW;
END
$$;

-- La zona horaria debe existir en la base. Se evalúa al escribir (alta o cambio de la columna).
CREATE FUNCTION empresa_validar_zona_horaria() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  -- Un NULL lo rechaza NOT NULL con su propio error.
  IF NEW.zona_horaria IS NOT NULL AND NOT public.zona_horaria_valida(NEW.zona_horaria) THEN
    RAISE EXCEPTION 'zona horaria desconocida: %', NEW.zona_horaria
      USING ERRCODE = '23514', CONSTRAINT = 'empresa_zona_horaria_ck';
  END IF;
  RETURN NEW;
END
$$;

-- En modo SINGLE la instalación tiene a lo sumo un tenant. El bloqueo serializa las altas
-- simultáneas; bajo SERIALIZABLE además lo detecta el motor. Si la fila de instalación falta (o
-- no se ve), falla cerrado: no se asume ningún modo.
CREATE FUNCTION tenant_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_modo text;
BEGIN
  SELECT i.modo INTO v_modo FROM public.instalacion i;
  IF v_modo IS NULL THEN
    RAISE EXCEPTION 'no se puede decidir el modo de la instalación: falta su fila'
      USING ERRCODE = '55000';
  END IF;
  IF v_modo = 'SINGLE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('zuluhub.tenant.alta', 0));
    IF EXISTS (SELECT 1 FROM public.tenant) THEN
      RAISE EXCEPTION 'la instalación es SINGLE y ya tiene un tenant'
        USING ERRCODE = '23514', CONSTRAINT = 'tenant_instalacion_single';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION solo_insercion() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION 'la tabla % es de solo inserción', TG_TABLE_NAME
    USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER tenant_version BEFORE UPDATE ON tenant
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER tenant_alta BEFORE INSERT ON tenant
  FOR EACH ROW EXECUTE FUNCTION tenant_validar_alta();
CREATE TRIGGER empresa_version BEFORE UPDATE ON empresa
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER empresa_cambio BEFORE UPDATE ON empresa
  FOR EACH ROW EXECUTE FUNCTION empresa_validar_cambio();
CREATE TRIGGER empresa_alta BEFORE INSERT ON empresa
  FOR EACH ROW EXECUTE FUNCTION empresa_validar_alta();
CREATE TRIGGER empresa_zona_horaria BEFORE INSERT OR UPDATE OF zona_horaria ON empresa
  FOR EACH ROW EXECUTE FUNCTION empresa_validar_zona_horaria();
CREATE TRIGGER sucursal_version BEFORE UPDATE ON sucursal
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER trabajo_fecha BEFORE UPDATE ON trabajo
  FOR EACH ROW EXECUTE FUNCTION fijar_fecha();

CREATE TRIGGER auditoria_empresa_solo_insercion BEFORE UPDATE OR DELETE ON auditoria_empresa
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER auditoria_plataforma_solo_insercion BEFORE UPDATE OR DELETE ON auditoria_plataforma
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER auditoria_acceso_grupo_solo_insercion BEFORE UPDATE OR DELETE ON auditoria_acceso_grupo
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER auditoria_empresa_sin_truncate BEFORE TRUNCATE ON auditoria_empresa
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER auditoria_plataforma_sin_truncate BEFORE TRUNCATE ON auditoria_plataforma
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER auditoria_acceso_grupo_sin_truncate BEFORE TRUNCATE ON auditoria_acceso_grupo
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- Una empresa opera solo si ella y su tenant están ACTIVE (estado efectivo, diseno-inicial §4.1).
-- Se evalúa con los permisos de quien consulta, dentro de su propia transacción: una suspensión
-- confirmada antes de que empiece la operación la rechaza.
CREATE FUNCTION empresa_operable(p_empresa uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.empresa e
    JOIN public.tenant t ON t.id = e.tenant_id
    WHERE e.id = p_empresa AND e.estado = 'ACTIVE' AND t.estado = 'ACTIVE'
  )
$$;

-- El tenant de una empresa, visto con los permisos de quien consulta (NULL si no la ve).
CREATE FUNCTION tenant_de_empresa(p_empresa uuid) RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT tenant_id FROM public.empresa WHERE id = p_empresa $$;

-- El tenant está ACTIVE, visto con los permisos de quien consulta. A diferencia de
-- empresa_operable, no mira el estado de ninguna empresa: es lo que usa la lectura de grupo
-- (con el tenant suspendido el propietario ve la lista y los estados, no los datos operativos).
CREATE FUNCTION tenant_activo(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenant t WHERE t.id = p_tenant AND t.estado = 'ACTIVE') $$;

-- El dueño del grupo del tenant indicado, con la persona y la membresía activas.
CREATE FUNCTION es_propietario_activo(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.membresia_tenant m
    JOIN public.persona p ON p.id = m.persona_id
    WHERE m.persona_id = public.app_persona_id()
      AND m.tenant_id = p_tenant
      AND m.rol = 'PROPIETARIO'
      AND m.activo
      AND p.activo_global
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Privilegios: todo cerrado para PUBLIC, cada rol recibe solo lo que necesita. Ningún rol tiene
-- DELETE. Los INSERT y los UPDATE son por columna: ningún rol puede dar de alta una fila con
-- `creado_en`, `version`, `estado` o `intentos` elegidos a mano (los fija el valor por defecto).
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app_empresa_id(), app_tenant_id(), app_persona_id(), cuit_valido(text),
  zona_horaria_valida(text), empresa_operable(uuid), es_propietario_activo(uuid), tenant_de_empresa(uuid),
  tenant_activo(uuid)
TO zuluhub_app, zuluhub_grupo, zuluhub_trabajos, zuluhub_plataforma;
GRANT USAGE ON SCHEMA public TO zuluhub_app, zuluhub_grupo, zuluhub_trabajos, zuluhub_plataforma;

-- app: opera dentro de una empresa
GRANT SELECT ON empresa, tenant, persona, membresia_tenant TO zuluhub_app;
GRANT SELECT ON sucursal, auditoria_empresa, trabajo TO zuluhub_app;
GRANT INSERT (empresa_id, nombre) ON sucursal TO zuluhub_app;
GRANT INSERT (empresa_id, actor_persona_id, accion, entidad, entidad_id, antes, despues)
  ON auditoria_empresa TO zuluhub_app;
GRANT INSERT (empresa_id, tipo, datos, clave_idempotencia) ON trabajo TO zuluhub_app;
GRANT UPDATE (nombre, activa) ON sucursal TO zuluhub_app;

-- grupo: solo lectura para el dueño del grupo, más el registro de su acceso
GRANT SELECT ON empresa, tenant, sucursal, persona, membresia_tenant TO zuluhub_grupo;
GRANT INSERT (tenant_id, persona_id, empresa_id) ON auditoria_acceso_grupo TO zuluhub_grupo;

-- trabajos: ve y avanza la cola; nada más
GRANT SELECT ON trabajo TO zuluhub_trabajos;
GRANT UPDATE (estado, intentos, proximo_intento, tomado_hasta, ultimo_error) ON trabajo TO zuluhub_trabajos;

-- plataforma: administra tenants y empresas; no lee datos operativos
GRANT SELECT ON instalacion, tenant, empresa, persona, membresia_tenant, trabajo, auditoria_plataforma TO zuluhub_plataforma;
GRANT INSERT (nombre) ON tenant TO zuluhub_plataforma;
GRANT INSERT (tenant_id, cuit, razon_social, zona_horaria) ON empresa TO zuluhub_plataforma;
GRANT INSERT (email) ON persona TO zuluhub_plataforma;
GRANT INSERT (persona_id, tenant_id, rol, activo) ON membresia_tenant TO zuluhub_plataforma;
GRANT INSERT (empresa_id, nombre) ON sucursal TO zuluhub_plataforma;
GRANT INSERT (empresa_id, actor_persona_id, accion, entidad, entidad_id, antes, despues)
  ON auditoria_empresa TO zuluhub_plataforma;
GRANT INSERT (actor, accion, entidad, entidad_id, antes, despues) ON auditoria_plataforma TO zuluhub_plataforma;
GRANT INSERT (empresa_id, tipo, datos, clave_idempotencia) ON trabajo TO zuluhub_plataforma;
GRANT UPDATE (nombre, estado, motivo_estado) ON tenant TO zuluhub_plataforma;
GRANT UPDATE (cuit, razon_social, estado, motivo_estado, zona_horaria) ON empresa TO zuluhub_plataforma;
GRANT UPDATE (activo_global) ON persona TO zuluhub_plataforma;
GRANT UPDATE (activo) ON membresia_tenant TO zuluhub_plataforma;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada en toda tabla; sin política no hay acceso
-- ---------------------------------------------------------------------------------------------
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresa FORCE ROW LEVEL SECURITY;
ALTER TABLE sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE sucursal FORCE ROW LEVEL SECURITY;
ALTER TABLE persona ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona FORCE ROW LEVEL SECURITY;
ALTER TABLE membresia_tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE membresia_tenant FORCE ROW LEVEL SECURITY;
ALTER TABLE auditoria_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_empresa FORCE ROW LEVEL SECURITY;
ALTER TABLE auditoria_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_plataforma FORCE ROW LEVEL SECURITY;
ALTER TABLE auditoria_acceso_grupo ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_acceso_grupo FORCE ROW LEVEL SECURITY;
ALTER TABLE trabajo ENABLE ROW LEVEL SECURITY;
ALTER TABLE trabajo FORCE ROW LEVEL SECURITY;
ALTER TABLE instalacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE instalacion FORCE ROW LEVEL SECURITY;

-- instalacion: solo la lee la plataforma
CREATE POLICY instalacion_plataforma ON instalacion FOR SELECT TO zuluhub_plataforma USING (true);

-- tenant
CREATE POLICY tenant_app_leer ON tenant FOR SELECT TO zuluhub_app
  USING (id = (SELECT e.tenant_id FROM empresa e WHERE e.id = app_empresa_id()));
CREATE POLICY tenant_grupo_leer ON tenant FOR SELECT TO zuluhub_grupo
  USING (id = app_tenant_id() AND es_propietario_activo(id));
CREATE POLICY tenant_plataforma_leer ON tenant FOR SELECT TO zuluhub_plataforma USING (true);
CREATE POLICY tenant_plataforma_alta ON tenant FOR INSERT TO zuluhub_plataforma WITH CHECK (true);
CREATE POLICY tenant_plataforma_cambiar ON tenant FOR UPDATE TO zuluhub_plataforma USING (true) WITH CHECK (true);

-- empresa
CREATE POLICY empresa_app_leer ON empresa FOR SELECT TO zuluhub_app USING (id = app_empresa_id());
CREATE POLICY empresa_grupo_leer ON empresa FOR SELECT TO zuluhub_grupo
  USING (tenant_id = app_tenant_id() AND es_propietario_activo(tenant_id));
CREATE POLICY empresa_plataforma_leer ON empresa FOR SELECT TO zuluhub_plataforma USING (true);
CREATE POLICY empresa_plataforma_alta ON empresa FOR INSERT TO zuluhub_plataforma WITH CHECK (true);
CREATE POLICY empresa_plataforma_cambiar ON empresa FOR UPDATE TO zuluhub_plataforma USING (true) WITH CHECK (true);

-- sucursal: la plataforma solo puede sembrarla (INSERT sin SELECT: no lee datos operativos)
CREATE POLICY sucursal_app_leer ON sucursal FOR SELECT TO zuluhub_app USING (empresa_id = app_empresa_id());
CREATE POLICY sucursal_app_alta ON sucursal FOR INSERT TO zuluhub_app
  WITH CHECK (empresa_id = app_empresa_id() AND empresa_operable(empresa_id));
CREATE POLICY sucursal_app_cambiar ON sucursal FOR UPDATE TO zuluhub_app
  USING (empresa_id = app_empresa_id() AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = app_empresa_id() AND empresa_operable(empresa_id));
-- El dueño del grupo ve las sucursales mientras el TENANT esté activo (diseno-inicial §4.1 y R3);
-- que una empresa puntual esté suspendida no se las oculta: ese estado lo ve en su lista.
CREATE POLICY sucursal_grupo_leer ON sucursal FOR SELECT TO zuluhub_grupo
  USING (
    tenant_de_empresa(empresa_id) = app_tenant_id()
    AND es_propietario_activo(app_tenant_id())
    AND tenant_activo(app_tenant_id())
  );
CREATE POLICY sucursal_plataforma_sembrar ON sucursal FOR INSERT TO zuluhub_plataforma WITH CHECK (true);

-- persona y membresia_tenant: cada rol ve su propia fila
CREATE POLICY persona_propia_app ON persona FOR SELECT TO zuluhub_app USING (id = app_persona_id());
CREATE POLICY persona_propia_grupo ON persona FOR SELECT TO zuluhub_grupo USING (id = app_persona_id());
CREATE POLICY persona_plataforma_leer ON persona FOR SELECT TO zuluhub_plataforma USING (true);
CREATE POLICY persona_plataforma_alta ON persona FOR INSERT TO zuluhub_plataforma WITH CHECK (true);
CREATE POLICY persona_plataforma_cambiar ON persona FOR UPDATE TO zuluhub_plataforma USING (true) WITH CHECK (true);

CREATE POLICY membresia_tenant_propia_app ON membresia_tenant FOR SELECT TO zuluhub_app
  USING (persona_id = app_persona_id());
CREATE POLICY membresia_tenant_propia_grupo ON membresia_tenant FOR SELECT TO zuluhub_grupo
  USING (persona_id = app_persona_id());
CREATE POLICY membresia_tenant_plataforma_leer ON membresia_tenant FOR SELECT TO zuluhub_plataforma USING (true);
CREATE POLICY membresia_tenant_plataforma_alta ON membresia_tenant FOR INSERT TO zuluhub_plataforma WITH CHECK (true);
CREATE POLICY membresia_tenant_plataforma_cambiar ON membresia_tenant FOR UPDATE TO zuluhub_plataforma
  USING (true) WITH CHECK (true);

-- auditorías
CREATE POLICY auditoria_empresa_app_leer ON auditoria_empresa FOR SELECT TO zuluhub_app
  USING (empresa_id = app_empresa_id());
CREATE POLICY auditoria_empresa_app_alta ON auditoria_empresa FOR INSERT TO zuluhub_app
  WITH CHECK (
    empresa_id = app_empresa_id()
    AND empresa_operable(empresa_id)
    AND actor_persona_id IS NOT DISTINCT FROM app_persona_id()
  );
CREATE POLICY auditoria_empresa_plataforma_alta ON auditoria_empresa FOR INSERT TO zuluhub_plataforma
  WITH CHECK (true);
CREATE POLICY auditoria_plataforma_leer ON auditoria_plataforma FOR SELECT TO zuluhub_plataforma USING (true);
CREATE POLICY auditoria_plataforma_alta ON auditoria_plataforma FOR INSERT TO zuluhub_plataforma WITH CHECK (true);
CREATE POLICY auditoria_acceso_grupo_alta ON auditoria_acceso_grupo FOR INSERT TO zuluhub_grupo
  WITH CHECK (tenant_id = app_tenant_id() AND persona_id = app_persona_id() AND es_propietario_activo(tenant_id));

-- trabajo
CREATE POLICY trabajo_app_leer ON trabajo FOR SELECT TO zuluhub_app USING (empresa_id = app_empresa_id());
CREATE POLICY trabajo_app_alta ON trabajo FOR INSERT TO zuluhub_app
  WITH CHECK (empresa_id = app_empresa_id() AND empresa_operable(empresa_id));
CREATE POLICY trabajo_trabajos_leer ON trabajo FOR SELECT TO zuluhub_trabajos USING (true);
CREATE POLICY trabajo_trabajos_avanzar ON trabajo FOR UPDATE TO zuluhub_trabajos USING (true) WITH CHECK (true);
CREATE POLICY trabajo_plataforma_leer ON trabajo FOR SELECT TO zuluhub_plataforma USING (true);
CREATE POLICY trabajo_plataforma_alta ON trabajo FOR INSERT TO zuluhub_plataforma WITH CHECK (true);
