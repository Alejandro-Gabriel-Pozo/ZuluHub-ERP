-- 0004_plataforma: identidad de los administradores de plataforma, actor firmado, idempotencia de
-- plataforma, referencia de error y el rol de base de la autenticación (H5 plataforma; ADR-011,
-- ADR-012; decisiones del dueño del 2026-10-12 sobre SOPORTE, membresías, referencia de error y
-- login).
--
-- Reglas de esta migración (las mismas de 0001 a 0003):
--  * Es ADITIVA: crea tablas, funciones, políticas y un rol. No modifica ni borra ninguna política,
--    privilegio ni objeto existente. Todo lo que restringe a la plataforma lo hace con políticas
--    RESTRICTIVE (se suman con AND a las permisivas de 0001 y 0002).
--  * No agrega NINGUNA función SECURITY DEFINER: la única del esquema sigue siendo
--    `contexto_firmado()` (un meta-test lo exige). Todo corre con los permisos de quien consulta.
--  * Toda función nueva fija `search_path = pg_catalog, public, pg_temp`, califica sus tablas con
--    `public.` y nace sin EXECUTE para PUBLIC; solo se otorga al rol que la necesita.
--  * Nadie recibe DELETE ni TRUNCATE. INSERT y UPDATE van por columna.
--  * RLS activa y FORZADA en toda tabla nueva.
--  * Sin contraseñas, claves ni cadenas de conexión: el rol nuevo nace NOLOGIN; quien administra la
--    base le da LOGIN y contraseña fuera del repositorio.
--  * No referencia ningún objeto de 0003 (ni de las migraciones siguientes).
--
-- Decisiones de diseño (todas probadas por tests):
--
--  P1. El actor de plataforma viaja FIRMADO. El contexto de plataforma lleva en el claim `a` el id
--      del administrador (uuid canónico en minúsculas) o el texto `sistema`. Sin `a` (token viejo,
--      token de otro rol, token vencido o sin token) la plataforma no ve ni escribe nada: antes, con
--      políticas `USING (true)`, veía todo aunque no hubiera contexto.
--  P2. Dos roles de plataforma: ADMIN (todo lo que 0001 y 0002 le dieron) y SOPORTE (solo leer,
--      reenviar y revocar el alta del gerente y dejar su constancia). Esa diferencia la impone la
--      base con políticas restrictivas: un guard roto o un SOPORTE que intenta escalar choca acá.
--      El actor `sistema` (el barrido de altas vencidas) solo puede cancelar el alta de una empresa
--      en PROVISIONING y revocar las invitaciones pendientes del alta.
--      Límite honesto: `sistema` lo puede firmar cualquiera que tenga la clave del contexto y la
--      cadena de la plataforma. Protege contra errores de código y contra un SOPORTE, no contra un
--      servidor comprometido.
--  P3. Una lectura de plataforma exige un actor vigente (`sistema` o un administrador activo, ADMIN o
--      SOPORTE): un administrador dado de baja pierde la lectura aunque su token siga vigente.
--      La excepción es la tabla `admin_plataforma`, cuya política no puede llamar a la función que
--      la consulta (Postgres rechaza el ciclo): ahí alcanza con que haya un actor firmado. Así el
--      caso de uso puede leer la fila del actor y responder SIN_PERMISO.
--  P4. La plataforma lee 4 columnas de `membresia` (empresa, persona, rol, activo) y ningún dato
--      operativo: no `invitacion_id`, no fechas, no asignaciones, no sucursales (decisión F1).
--  P5. SOPORTE solo emite y cambia invitaciones de tipo ALTA_GERENTE y solo encola trabajos de
--      envío de invitación: no puede invitar a una empresa ya en marcha (eso le daría acceso a sus
--      datos). ADMIN conserva lo que le dio 0002.
--  P6. Un administrador de plataforma no puede tener ninguna membresía (decisión F5). Esta migración
--      lo impone en el único punto que la base puede vigilar con los permisos del dueño: al dar de
--      alta o reactivar al administrador. Lo demás (que una invitación o una membresía nueva no
--      nazca para el email de un administrador) lo chequea el código, porque los roles de la
--      aplicación no ven `admin_plataforma`. Ver la advertencia en `admin_plataforma_validar`.
--  P7. `referencia_de_error`: tabla mínima de solo inserción (decisión F4). El formato lo imponen
--      CHECK estrictos, así no se puede colar texto libre ni datos de negocio.
--  P8. `pedernal_autenticacion`: quinto rol de base para las tablas de la librería de autenticación
--      (decisión F6). Nace SIN NINGÚN privilegio sobre las tablas de negocio; sus tablas y sus
--      permisos llegan en la migración de la autenticación (P8 del tramo).

-- ---------------------------------------------------------------------------------------------
-- Rol de la autenticación (a nivel de clúster: se crea solo si falta)
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  r constant text := 'pedernal_autenticacion';
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
-- Tablas
-- ---------------------------------------------------------------------------------------------

-- Administradores de plataforma: identidad propia, distinta de `persona`. El alta y la baja las hace
-- el dueño de la base con un script (ningún rol limitado puede escribir acá). NUNCA guarda secretos:
-- ni segundo factor, ni códigos de recuperación, ni contraseñas.
CREATE TABLE admin_plataforma (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL
                 CONSTRAINT admin_plataforma_email_ck CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  rol            text NOT NULL CONSTRAINT admin_plataforma_rol_ck CHECK (rol IN ('ADMIN', 'SOPORTE')),
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT admin_plataforma_email_uk UNIQUE (email)
);

-- Idempotencia de las escrituras de plataforma (el puerto de transacciones no la trae). La clave es
-- por administrador: dos administradores pueden usar la misma sin chocar. `huella` es el sha256 de
-- la entrada canónica; `resultado` es lo que se devuelve ante un reintento.
CREATE TABLE idempotencia_plataforma (
  admin_id  uuid NOT NULL REFERENCES admin_plataforma (id),
  clave     text NOT NULL CONSTRAINT idempotencia_plataforma_clave_ck CHECK (clave ~ '^[A-Za-z0-9_-]{16,128}$'),
  operacion text NOT NULL CONSTRAINT idempotencia_plataforma_operacion_ck CHECK (operacion ~ '^[a-z_.]+$'),
  huella    text NOT NULL CONSTRAINT idempotencia_plataforma_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  resultado jsonb NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotencia_plataforma_pkey PRIMARY KEY (admin_id, clave)
);

-- Referencia de error: el código que ve la persona cuando se le rechaza una acción, para que soporte
-- lo busque. Solo el motivo tipado: ningún dato de negocio, ningún texto libre (los CHECK lo
-- impiden). Se inserta con el contexto de quien recibe el rechazo (ver las políticas de abajo).
CREATE TABLE referencia_de_error (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referencia text NOT NULL
             CONSTRAINT referencia_de_error_referencia_ck CHECK (referencia ~ '^PD-[0-9A-F]{4}-[0-9A-F]{4}$'),
  accion     text NOT NULL
             CONSTRAINT referencia_de_error_accion_ck
             CHECK (accion ~ '^[a-z_]+(\.[a-z_]+)*$' AND char_length(accion) <= 80),
  motivo     text NOT NULL
             CONSTRAINT referencia_de_error_motivo_ck
             CHECK (motivo ~ '^[A-Z][A-Z0-9_]*$' AND char_length(motivo) <= 80),
  empresa_id uuid REFERENCES empresa (id),
  persona_id uuid REFERENCES persona (id),
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referencia_de_error_referencia_ix ON referencia_de_error (referencia);

-- ---------------------------------------------------------------------------------------------
-- Disparadores
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER admin_plataforma_version BEFORE UPDATE ON admin_plataforma
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- Solo inserción: las claves de idempotencia y las referencias no se editan ni se borran, ni por
-- fila ni con TRUNCATE (el disparador frena hasta al dueño de la tabla).
CREATE TRIGGER idempotencia_plataforma_solo_insercion BEFORE UPDATE OR DELETE ON idempotencia_plataforma
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER idempotencia_plataforma_sin_truncate BEFORE TRUNCATE ON idempotencia_plataforma
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER referencia_de_error_solo_insercion BEFORE UPDATE OR DELETE ON referencia_de_error
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER referencia_de_error_sin_truncate BEFORE TRUNCATE ON referencia_de_error
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- Un administrador activo no puede tener ninguna membresía (de empresa ni de tenant), activa o no,
-- con su mismo email (decisión F5).
-- ADVERTENCIA: la función corre con los permisos de quien escribe (el dueño de la base, con el
-- script de alta) y sujeta a RLS. En Neon el dueño evade RLS y ve todo. Si algún día lo ejecutara un
-- rol que no la evade, no vería ninguna persona y el chequeo pasaría en silencio: por eso el script
-- del primer administrador hace el mismo chequeo por su cuenta, y esta función es la segunda barrera.
-- Solo vigila el sentido "administrador nuevo o reactivado"; el inverso (membresía o invitación
-- nueva para el email de un administrador) lo chequea el código de los casos de uso.
CREATE FUNCTION admin_plataforma_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.activo AND EXISTS (
    SELECT 1
    FROM public.persona p
    WHERE p.email = NEW.email
      AND (
        EXISTS (SELECT 1 FROM public.membresia m WHERE m.persona_id = p.id)
        OR EXISTS (SELECT 1 FROM public.membresia_tenant mt WHERE mt.persona_id = p.id)
      )
  ) THEN
    RAISE EXCEPTION 'un administrador de plataforma no puede tener membresías en ninguna empresa'
      USING ERRCODE = '23514', CONSTRAINT = 'admin_plataforma_sin_membresia';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER admin_plataforma_membresias BEFORE INSERT OR UPDATE OF email, activo ON admin_plataforma
  FOR EACH ROW EXECUTE FUNCTION admin_plataforma_validar();

-- Un administrador no se borra: la baja es `activo = false`. La auditoría de plataforma lo nombra por
-- su id (texto), y borrarlo dejaría esa huella sin dueño. El disparador frena hasta al dueño.
CREATE FUNCTION admin_plataforma_no_se_borra() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION 'un administrador de plataforma no se borra: se lo da de baja con activo = false'
    USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER admin_plataforma_sin_borrado BEFORE DELETE ON admin_plataforma
  FOR EACH ROW EXECUTE FUNCTION admin_plataforma_no_se_borra();
CREATE TRIGGER admin_plataforma_sin_truncate BEFORE TRUNCATE ON admin_plataforma
  FOR EACH STATEMENT EXECUTE FUNCTION admin_plataforma_no_se_borra();

-- ---------------------------------------------------------------------------------------------
-- Funciones de contexto de plataforma. Corren con los permisos de quien consulta (plataforma) y
-- sujetas a RLS; sin contexto firmado valen NULL / false.
-- ---------------------------------------------------------------------------------------------

-- El actor firmado: el id del administrador (texto canónico) o 'sistema'.
CREATE FUNCTION app_actor_plataforma() RETURNS text LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT nullif(public.contexto_firmado()->>'a', '') $$;

-- ¿El actor es un administrador ACTIVO con alguno de esos roles? Un `sistema`, un id que no existe o
-- un administrador dado de baja dan false. El actor se lee una sola vez por llamada.
CREATE FUNCTION admin_plataforma_con_rol(p_roles text[]) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_plataforma a
    WHERE a.id::text = (SELECT public.app_actor_plataforma())
      AND a.activo
      AND a.rol = ANY (p_roles)
  )
$$;

-- ¿Hay un actor de plataforma vigente? `sistema` o un administrador activo (ADMIN o SOPORTE).
CREATE FUNCTION plataforma_actor_vigente() RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT coalesce((SELECT public.app_actor_plataforma()) = 'sistema', false)
         OR public.admin_plataforma_con_rol(ARRAY['ADMIN', 'SOPORTE'])
$$;

-- ---------------------------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON admin_plataforma, idempotencia_plataforma, referencia_de_error FROM PUBLIC;

-- Solo la plataforma ejecuta las funciones del actor: ningún otro rol tiene políticas que las usen.
GRANT EXECUTE ON FUNCTION app_actor_plataforma(), admin_plataforma_con_rol(text[]), plataforma_actor_vigente()
  TO pedernal_plataforma;

-- plataforma: lee a los administradores (para decidir permisos y chequear emails), y deja constancia
-- de lo que hizo con una clave de idempotencia. No escribe en `admin_plataforma`.
GRANT SELECT ON admin_plataforma, idempotencia_plataforma TO pedernal_plataforma;
GRANT INSERT (admin_id, clave, operacion, huella, resultado) ON idempotencia_plataforma TO pedernal_plataforma;

-- Membresías: identidad, no operación (F1). Sin `invitacion_id` ni fechas.
GRANT SELECT (empresa_id, persona_id, rol, activo) ON membresia TO pedernal_plataforma;

-- Referencia de error: la plataforma las busca y las registra; la aplicación y el grupo solo las
-- registran (con el contexto de quien recibe el rechazo). Nadie las lee salvo la plataforma.
GRANT SELECT ON referencia_de_error TO pedernal_plataforma;
GRANT INSERT (referencia, accion, motivo, empresa_id, persona_id)
  ON referencia_de_error TO pedernal_plataforma, pedernal_app, pedernal_grupo;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada en toda tabla nueva; sin política no hay acceso
-- ---------------------------------------------------------------------------------------------
ALTER TABLE admin_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_plataforma FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotencia_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotencia_plataforma FORCE ROW LEVEL SECURITY;
ALTER TABLE referencia_de_error ENABLE ROW LEVEL SECURITY;
ALTER TABLE referencia_de_error FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- Políticas de las tablas nuevas
-- ---------------------------------------------------------------------------------------------

-- Sin recursión: esta política no llama a admin_plataforma_con_rol (que lee esta misma tabla).
CREATE POLICY admin_plataforma_plataforma_leer ON admin_plataforma FOR SELECT TO pedernal_plataforma
  USING ((SELECT app_actor_plataforma()) IS NOT NULL);

-- Cada administrador ve y registra solo sus propias claves, y solo mientras está activo.
CREATE POLICY idempotencia_plataforma_leer ON idempotencia_plataforma FOR SELECT TO pedernal_plataforma
  USING (admin_id::text = (SELECT app_actor_plataforma()));
CREATE POLICY idempotencia_plataforma_alta ON idempotencia_plataforma FOR INSERT TO pedernal_plataforma
  WITH CHECK (
    admin_id::text = (SELECT app_actor_plataforma())
    AND (SELECT admin_plataforma_con_rol(ARRAY['ADMIN', 'SOPORTE']))
  );

-- Referencia de error. Cada contexto registra solo lo suyo (el WITH CHECK de cada política nombra su
-- propio contexto, como en 0002 D8):
--  * OPERATIVO: de su empresa y de su persona (o del sistema). No exige empresa_operable: el motivo
--    del rechazo puede ser, justamente, que la empresa no opera.
--  * INVITACION: sin empresa ni persona; solo con el hash del token de invitación en el contexto.
--  * GRUPO: sin empresa; de la persona del contexto.
--  * PLATAFORMA: de cualquier actor vigente (el motivo de un rechazo de plataforma).
CREATE POLICY referencia_de_error_app_alta ON referencia_de_error FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id())
    AND persona_id IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY referencia_de_error_invitado_alta ON referencia_de_error FOR INSERT TO pedernal_app
  WITH CHECK (
    (SELECT app_token_invitacion()) IS NOT NULL
    AND (SELECT app_empresa_id()) IS NULL
    AND empresa_id IS NULL
    AND persona_id IS NULL
  );
CREATE POLICY referencia_de_error_grupo_alta ON referencia_de_error FOR INSERT TO pedernal_grupo
  WITH CHECK (
    (SELECT app_tenant_id()) IS NOT NULL
    AND empresa_id IS NULL
    AND persona_id IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY referencia_de_error_plataforma_leer ON referencia_de_error FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY referencia_de_error_plataforma_alta ON referencia_de_error FOR INSERT TO pedernal_plataforma
  WITH CHECK ((SELECT plataforma_actor_vigente()));

-- Membresías: la plataforma las lee (solo las 4 columnas del GRANT), como identidad.
CREATE POLICY membresia_plataforma_leer ON membresia FOR SELECT TO pedernal_plataforma USING (true);

-- ---------------------------------------------------------------------------------------------
-- Políticas RESTRICTIVAS sobre las tablas de 0001 y 0002 (se suman con AND a las permisivas).
-- Solo aplican al rol de plataforma: no cambian nada para la aplicación, el grupo ni los trabajos.
-- ---------------------------------------------------------------------------------------------

-- Lectura: sin un actor vigente firmado, 0 filas. Una por tabla que la plataforma puede leer, con el
-- mismo texto (un meta-test las exige).
CREATE POLICY instalacion_plataforma_con_actor ON instalacion AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY tenant_plataforma_con_actor ON tenant AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY empresa_plataforma_con_actor ON empresa AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY persona_plataforma_con_actor ON persona AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY membresia_tenant_plataforma_con_actor ON membresia_tenant AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY membresia_plataforma_con_actor ON membresia AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY invitacion_plataforma_con_actor ON invitacion AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY invitacion_empresa_plataforma_con_actor ON invitacion_empresa AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY trabajo_plataforma_con_actor ON trabajo AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY auditoria_plataforma_con_actor ON auditoria_plataforma AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));

-- Escritura de estructura: solo ADMIN. Una restrictiva FOR UPDATE filtra también la lectura previa
-- del UPDATE: un SOPORTE que intenta cambiar algo afecta 0 filas (el caso de uso lo frena antes con
-- SIN_PERMISO; esta es la segunda barrera).
CREATE POLICY tenant_plataforma_admin_alta ON tenant AS RESTRICTIVE FOR INSERT TO pedernal_plataforma
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY tenant_plataforma_admin_cambiar ON tenant AS RESTRICTIVE FOR UPDATE TO pedernal_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));

CREATE POLICY empresa_plataforma_admin_alta ON empresa AS RESTRICTIVE FOR INSERT TO pedernal_plataforma
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
-- El barrido (actor `sistema`) solo puede cancelar el alta que sigue en PROVISIONING.
CREATE POLICY empresa_plataforma_quien_cambia ON empresa AS RESTRICTIVE FOR UPDATE TO pedernal_plataforma
  USING (
    (SELECT admin_plataforma_con_rol(ARRAY['ADMIN']))
    OR ((SELECT app_actor_plataforma()) = 'sistema' AND estado = 'PROVISIONING')
  )
  WITH CHECK (
    (SELECT admin_plataforma_con_rol(ARRAY['ADMIN']))
    OR ((SELECT app_actor_plataforma()) = 'sistema' AND estado = 'CANCELLED')
  );

CREATE POLICY persona_plataforma_admin_alta ON persona AS RESTRICTIVE FOR INSERT TO pedernal_plataforma
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY persona_plataforma_admin_cambiar ON persona AS RESTRICTIVE FOR UPDATE TO pedernal_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));

CREATE POLICY membresia_tenant_plataforma_admin_alta ON membresia_tenant AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY membresia_tenant_plataforma_admin_cambiar ON membresia_tenant AS RESTRICTIVE FOR UPDATE
  TO pedernal_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));

CREATE POLICY sucursal_plataforma_admin_alta ON sucursal AS RESTRICTIVE FOR INSERT TO pedernal_plataforma
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));

-- Invitaciones. ADMIN: lo de 0002. SOPORTE: solo el alta del gerente (P5). `sistema`: solo revocar
-- las altas pendientes (el barrido de altas vencidas).
CREATE POLICY invitacion_plataforma_quien_emite ON invitacion AS RESTRICTIVE FOR INSERT TO pedernal_plataforma
  WITH CHECK (
    (SELECT admin_plataforma_con_rol(ARRAY['ADMIN']))
    OR ((SELECT admin_plataforma_con_rol(ARRAY['SOPORTE'])) AND tipo = 'ALTA_GERENTE')
  );
CREATE POLICY invitacion_plataforma_quien_cambia ON invitacion AS RESTRICTIVE FOR UPDATE TO pedernal_plataforma
  USING (
    (SELECT admin_plataforma_con_rol(ARRAY['ADMIN']))
    OR ((SELECT admin_plataforma_con_rol(ARRAY['SOPORTE'])) AND tipo = 'ALTA_GERENTE')
    OR ((SELECT app_actor_plataforma()) = 'sistema' AND tipo = 'ALTA_GERENTE' AND estado = 'PENDIENTE')
  )
  WITH CHECK (
    (SELECT admin_plataforma_con_rol(ARRAY['ADMIN']))
    OR ((SELECT admin_plataforma_con_rol(ARRAY['SOPORTE'])) AND tipo = 'ALTA_GERENTE')
    OR ((SELECT app_actor_plataforma()) = 'sistema' AND tipo = 'ALTA_GERENTE' AND estado = 'REVOCADA')
  );
CREATE POLICY invitacion_empresa_plataforma_quien_emite ON invitacion_empresa AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma
  WITH CHECK (
    (SELECT admin_plataforma_con_rol(ARRAY['ADMIN']))
    OR ((SELECT admin_plataforma_con_rol(ARRAY['SOPORTE'])) AND tipo = 'ALTA_GERENTE')
  );

-- Trabajos. ADMIN: lo de 0001. SOPORTE: solo el envío de invitaciones (el valor es
-- TRABAJO_ENVIAR_INVITACION, src/modulos/identidad/casos-de-uso/contrato.ts; un test lo compara).
CREATE POLICY trabajo_plataforma_quien_encola ON trabajo AS RESTRICTIVE FOR INSERT TO pedernal_plataforma
  WITH CHECK (
    (SELECT admin_plataforma_con_rol(ARRAY['ADMIN']))
    OR ((SELECT admin_plataforma_con_rol(ARRAY['SOPORTE'])) AND tipo = 'enviar_invitacion')
  );

-- Auditorías. La de plataforma exige que el actor registrado sea el del contexto firmado: nadie
-- escribe a nombre de otro. La de empresa (constancia en cada empresa afectada) es de ADMIN y sin
-- persona: es la plataforma, no un usuario de la empresa.
CREATE POLICY auditoria_plataforma_actor_firmado ON auditoria_plataforma AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma
  WITH CHECK (actor = (SELECT app_actor_plataforma()) AND (SELECT plataforma_actor_vigente()));
CREATE POLICY auditoria_empresa_plataforma_admin ON auditoria_empresa AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma
  WITH CHECK (actor_persona_id IS NULL AND (SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
