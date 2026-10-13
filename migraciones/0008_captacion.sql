-- 0008_captacion: la solicitud de alta (nivel 2 de la escalera de alta), sus contadores contra el abuso,
-- y el séptimo rol de base, `zuluhub_captacion`, con el que la landing —la superficie más expuesta, sin
-- sesión— escribe una solicitud, la verifica y encola sus correos. Alta por solicitud y landing, §2
-- (L1); ADR-004, ADR-007, ADR-011; decisión del dueño del 2026-10-13 (el producto se ofrece «en frío»).
-- EL NÚMERO 0008 ES PROVISORIO: se renumera al integrar si otra migración entra antes (el nombre
-- `*_captacion.sql` y las pruebas no dependen del número).
--
-- Reglas de esta migración (las mismas de 0001 a 0007):
--  * Es ADITIVA: crea tablas, funciones, disparadores, políticas y un rol. No modifica ni borra ninguna
--    fila, política, privilegio ni objeto existente. Lo único que toca de lo ya creado son concesiones
--    nuevas a `zuluhub_captacion` y a `zuluhub_plataforma` (ejecutar las funciones de validación que usan
--    los CHECK de las tablas nuevas, y escribir en `trabajo` y `auditoria_plataforma` el primero). Su
--    reversión es un script aparte, revisado y DESTRUCTIVO (borra solicitudes: datos personales de
--    interesados): `migraciones/reversiones/0008_revertir_captacion.sql`. El ejecutor no lo aplica.
--  * No agrega NINGUNA función SECURITY DEFINER: la única del esquema sigue siendo `contexto_firmado()`
--    (un meta-test lo exige). Todo corre con los permisos de quien consulta.
--  * Toda función nueva fija `search_path = pg_catalog, public, pg_temp`, califica sus tablas con
--    `public.` y nace sin EXECUTE para PUBLIC; solo se otorga a quien la necesita.
--  * Nadie recibe TRUNCATE. DELETE lo recibe UN solo rol sobre UNA sola tabla (los contadores vencidos
--    de la landing, P7); las solicitudes no se borran nunca: se anonimizan. INSERT y UPDATE van por
--    columna. Los disparadores frenan el borrado y el vaciado aun al dueño de la base.
--  * RLS activa y FORZADA en toda tabla nueva. Ninguna política `FOR ALL`: cada comando tiene la suya.
--  * DEPENDE de 0004 (el actor firmado de plataforma) y de 0007 (la marca y `sin_borrado()`); se
--    comprueba al empezar.
--  * Crea el séptimo rol (NOLOGIN): quien administra la base le da LOGIN y contraseña fuera del
--    repositorio. Sin contraseñas, claves ni cadenas de conexión en este archivo.
--
-- Decisiones de diseño (todas probadas por tests; los números son de esta migración):
--
--  P1. La solicitud es un dato de la plataforma: sin empresa ni tenant de alcance. Su estado cambia solo
--      por la tabla de transiciones del disparador `solicitud_cambio` (la misma de
--      `TRANSICIONES_DE_SOLICITUD` en el dominio; una prueba compara ambas contra la base) y las
--      políticas dicen QUIÉN hace cada una: la landing solo `NUEVA → VERIFICADA`; un ADMIN decide, con su
--      id; el actor `sistema` solo vence y anonimiza; SOPORTE y los demás roles, nada.
--  P2. El contexto de la landing viaja FIRMADO (claim `c`, junto a `a` de plataforma): `{"s": <id de la
--      solicitud>}` o `{"m": <marca>, "e": <correo>}`. Las políticas exigen ese claim: sin la clave de
--      contexto, una cadena de conexión de captación filtrada no lee ni escribe nada, y con ella solo
--      ve la fila que el servidor le firmó.
--  P3. Una sola solicitud ABIERTA (`NUEVA`, `VERIFICADA` o `APROBADA`) por correo y marca: índice único
--      parcial `solicitud_abierta_uk`. Repetir el envío cae en la misma solicitud.
--  P4. Datos personales y consentimiento: la finalidad, las versiones de los textos aceptados y el
--      consentimiento de medición se congelan al crear (el disparador los vuelve inmutables); sin
--      consentimiento de medición la base rechaza guardar el identificador o el `fbclid`
--      (`solicitud_medicion_ck`). Nada se borra: anonimizar pone en NULL los datos personales y quita el
--      `fbclid`, y deja el rubro, la provincia, los `utm_*`, los estados y las fechas (sirven para el
--      embudo). Una fila anonimizada no cambia más.
--  P5. La landing escribe en `trabajo` y en `auditoria_plataforma` solo lo que su flujo necesita, atado a
--      la solicitud que su contexto ve: tres tipos de trabajo, claves con la forma exacta, `datos` con
--      una lista cerrada de claves (sin datos personales), un correo de verificación por cada envío
--      contado (a lo sumo 5), un evento solo con consentimiento, y una constancia con claves y valores de
--      la lista blanca (R-C3) cuyo `accion` corresponde al estado de la solicitud, una sola vez por
--      solicitud y acción. Un código de la landing equivocado o comprometido no puede dejar datos
--      personales en las dos tablas que no se anonimizan, ni llenarlas de repeticiones.
--  P6. Contadores del abuso: seudónimos (HMAC de la IP o del correo) por clave, ventana y comienzo. La
--      cuenta solo sube, de a uno (un código equivocado no puede ponerla a cero). Es la excepción
--      declarada a «auditoría en la misma transacción»: son datos técnicos sin valor de negocio.
--  P7. La ÚNICA excepción a «nadie borra»: la landing borra contadores con más de 8 días (la ventana
--      más larga es una semana). Previene retener seudónimos de IP y correo más allá de su uso. Se
--      impone con la política de DELETE (`limite_captacion_purgar`): un contador reciente no se borra ni
--      por SQL directo.
--  P8. Sin `SECURITY DEFINER` nuevo: el contexto de captación (`app_captacion()`) es una función común
--      que lee el payload que verifica `contexto_firmado()`.

-- ---------------------------------------------------------------------------------------------
-- Verificaciones previas: se frena con un mensaje claro, sin haber cambiado nada
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.plataforma_actor_vigente()') IS NULL
     OR to_regprocedure('public.admin_plataforma_con_rol(text[])') IS NULL
     OR to_regprocedure('public.app_actor_plataforma()') IS NULL THEN
    RAISE EXCEPTION 'captación requiere 0004_plataforma aplicada antes (faltan las funciones del actor de plataforma)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.marca') IS NULL OR to_regprocedure('public.sin_borrado()') IS NULL THEN
    RAISE EXCEPTION 'captación requiere 0007_marcas_y_planes aplicada antes (faltan la marca y sin_borrado())'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Séptimo rol: la landing, con contexto firmado propio (a nivel de clúster: se crea solo si falta).
-- Mismo bloque que 0001, 0004 y 0007: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT, atributos forzados si
-- ya existía, sin pertenencias a otros roles, topes de tiempo y sin objetos temporales.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  r constant text := 'zuluhub_captacion';
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
    RAISE EXCEPTION 'los roles de ZuluHub no pueden ser miembros de otros roles (%): revocar la pertenencia y repetir', ajenas
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
-- Funciones
-- ---------------------------------------------------------------------------------------------

-- El contexto firmado de la landing (claim `c`): un objeto JSON, o NULL. Un `c` que no sea un objeto
-- (un `null` de JSON, un texto, un número) no cuenta como contexto: así «hay contexto» es `IS NOT NULL`.
-- No es SECURITY DEFINER: solo lee lo que `contexto_firmado()` ya verificó.
CREATE FUNCTION app_captacion() RETURNS jsonb LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT x.c
  FROM (SELECT public.contexto_firmado()->'c' AS c) AS x
  WHERE jsonb_typeof(x.c) = 'object'
$$;

-- Atribución (de dónde vino el interesado): lista cerrada de claves y valores cortos sin espacios. El
-- dominio (`normalizarAtribucion`) normaliza antes; esto es la segunda barrera.
CREATE FUNCTION atribucion_valida(a jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE WHEN jsonb_typeof(a) = 'object' THEN NOT EXISTS (
    SELECT 1 FROM jsonb_each(a) AS e
    WHERE e.key <> ALL (ARRAY['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'])
       OR jsonb_typeof(e.value) <> 'string'
       OR (e.value #>> '{}') !~ '^[A-Za-z0-9._~-]{1,200}$'
  ) ELSE false END
$$;

-- Lo que la landing puede dejar en la auditoría (R-C3): solo estas claves, y solo valores con forma de
-- identificador (sin arroba ni espacios ni texto libre) o números, booleanos y nulos. La auditoría es de
-- solo inserción y NO se anonimiza: un dato personal que entrara acá sobreviviría para siempre. La lista es
-- `CLAVES_DE_AUDITORIA` del dominio; una prueba compara ambas.
CREATE FUNCTION datos_de_auditoria_de_captacion_validos(d jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT d IS NULL OR CASE WHEN jsonb_typeof(d) = 'object' THEN NOT EXISTS (
    SELECT 1 FROM jsonb_each(d) AS e
    WHERE e.key <> ALL (ARRAY[
            'estado', 'motivo', 'marcaId', 'rubro', 'provincia', 'campania', 'empresaId', 'numeroDeEnvio',
            'medicionConsentida', 'versionDeTerminos', 'versionDePrivacidad', 'versionDeAvisoDeMedicion',
            'correoDelGerenteEsElVerificado'])
       OR NOT (
            (jsonb_typeof(e.value) = 'string' AND (e.value #>> '{}') ~ '^[A-Za-z0-9._~:-]{1,200}$')
         OR jsonb_typeof(e.value) IN ('number', 'boolean', 'null'))
       -- el número de envío es del 1 al 5 (MAXIMO_DE_ENVIOS): acota las constancias de reenvío de cada solicitud
       OR (e.key = 'numeroDeEnvio' AND NOT (jsonb_typeof(e.value) = 'number' AND (e.value #>> '{}') ~ '^[1-5]$'))
  ) ELSE false END
$$;

-- ---------------------------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------------------------

-- La solicitud de alta. Sin `empresa_id`: no es de ninguna empresa. `empresa_creada_id` es un RESULTADO
-- (la empresa que nace al aprobarla), no un alcance: por eso se llama distinto (hallazgo K6).
CREATE TABLE solicitud_de_alta (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marca_id              uuid NOT NULL REFERENCES marca (id),
  estado                text NOT NULL DEFAULT 'NUEVA' CONSTRAINT solicitud_estado_ck
                        CHECK (estado IN ('NUEVA', 'VERIFICADA', 'APROBADA', 'ALTA_CREADA', 'RECHAZADA', 'SPAM')),
  -- Datos personales: quedan NULL al anonimizar (`solicitud_personales_ck`).
  email                 text CONSTRAINT solicitud_email_ck
                        CHECK (email ~ '^[!-~]{3,254}$' AND email = lower(email) AND email LIKE '%_@_%'),
  nombre_contacto       text CONSTRAINT solicitud_nombre_ck
                        CHECK (nombre_contacto !~ '^\s|\s$' AND char_length(nombre_contacto) BETWEEN 1 AND 80),
  nombre_negocio        text CONSTRAINT solicitud_negocio_ck
                        CHECK (nombre_negocio !~ '^\s|\s$' AND char_length(nombre_negocio) BETWEEN 1 AND 100),
  telefono              text CONSTRAINT solicitud_telefono_ck CHECK (telefono ~ '^\+?[0-9]{8,15}$'),
  -- El CUIT es opcional: `cuit_valido(NULL)` es false, así que sin el `IS NULL` la CHECK rechazaría toda solicitud
  -- sin CUIT (y la anonimización, que lo pone en NULL).
  cuit                  text CONSTRAINT solicitud_cuit_ck CHECK (cuit IS NULL OR cuit_valido(cuit)),
  id_de_medicion        uuid,
  nota_interna          text CONSTRAINT solicitud_nota_ck CHECK (char_length(btrim(nota_interna)) BETWEEN 1 AND 300),
  -- Datos que se conservan (embudo).
  rubro                 text NOT NULL CONSTRAINT solicitud_rubro_ck CHECK (rubro ~ '^[a-z][a-z_]{1,39}$'),
  provincia             text CONSTRAINT solicitud_provincia_ck CHECK (provincia ~ '^AR-[A-Z]$'),
  atribucion            jsonb NOT NULL DEFAULT '{}'::jsonb
                        CONSTRAINT solicitud_atribucion_ck CHECK (atribucion_valida(atribucion)),
  -- Consentimiento y finalidad (inmutables).
  finalidad             text NOT NULL DEFAULT 'EVALUAR_ALTA' CONSTRAINT solicitud_finalidad_ck
                        CHECK (finalidad IN ('EVALUAR_ALTA')),
  version_de_terminos   text NOT NULL CONSTRAINT solicitud_terminos_ck
                        CHECK (version_de_terminos ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$'),
  version_de_privacidad text NOT NULL CONSTRAINT solicitud_privacidad_ck
                        CHECK (version_de_privacidad ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$'),
  medicion_consentida   boolean NOT NULL DEFAULT false,
  version_de_aviso_de_medicion text CONSTRAINT solicitud_aviso_medicion_ck
                        CHECK (version_de_aviso_de_medicion ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$'),
  -- Verificación.
  numero_de_envios      smallint NOT NULL DEFAULT 1 CONSTRAINT solicitud_envios_ck
                        CHECK (numero_de_envios BETWEEN 1 AND 5),
  ultimo_envio_en       timestamptz NOT NULL,
  verificada_en         timestamptz,
  -- Decisión (la última; la historia completa está en la auditoría).
  decidida_por          text CONSTRAINT solicitud_decidida_por_ck
                        CHECK (decidida_por = 'sistema'
                               OR decidida_por ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  decidida_en           timestamptz,
  motivo_de_rechazo     text CONSTRAINT solicitud_motivo_ck
                        CHECK (motivo_de_rechazo IN ('NO_VERIFICADA', 'FUERA_DE_ALCANCE', 'DATOS_INCOMPLETOS',
                                                     'NO_CONTACTABLE', 'OTRO')),
  empresa_creada_id     uuid REFERENCES empresa (id),
  anonimizada_en        timestamptz,
  creada_en             timestamptz NOT NULL,
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  CONSTRAINT solicitud_empresa_uk UNIQUE (empresa_creada_id),
  CONSTRAINT solicitud_ultimo_envio_ck CHECK (ultimo_envio_en >= creada_en),
  -- Hay empresa creada si y solo si se creó el alta.
  CONSTRAINT solicitud_alta_ck CHECK ((estado = 'ALTA_CREADA') = (empresa_creada_id IS NOT NULL)),
  -- Verificada solo si pasó por la verificación: una NUEVA nunca tiene fecha de verificación, y las que
  -- avanzaron de VERIFICADA siempre. Una cerrada puede o no haberla tenido (rechazada o spam desde NUEVA).
  CONSTRAINT solicitud_verificada_ck CHECK (
    CASE estado
      WHEN 'NUEVA' THEN verificada_en IS NULL
      WHEN 'RECHAZADA' THEN true
      WHEN 'SPAM' THEN true
      ELSE verificada_en IS NOT NULL
    END),
  -- Quién y cuándo decidió: las dos cosas juntas, y solo desde que dejó de estar a la espera.
  CONSTRAINT solicitud_decision_ck CHECK (
    ((estado IN ('NUEVA', 'VERIFICADA')) = (decidida_por IS NULL))
    AND ((decidida_por IS NULL) = (decidida_en IS NULL))),
  CONSTRAINT solicitud_rechazo_ck CHECK ((estado = 'RECHAZADA') = (motivo_de_rechazo IS NOT NULL)),
  -- `NO_VERIFICADA` es del sistema, a los 7 días, y solo de una solicitud que nunca se verificó.
  CONSTRAINT solicitud_no_verificada_ck CHECK (
    motivo_de_rechazo IS DISTINCT FROM 'NO_VERIFICADA' OR (decidida_por = 'sistema' AND verificada_en IS NULL)),
  CONSTRAINT solicitud_personales_ck CHECK (
    (anonimizada_en IS NULL AND email IS NOT NULL AND nombre_contacto IS NOT NULL AND nombre_negocio IS NOT NULL)
    OR (anonimizada_en IS NOT NULL AND estado IN ('ALTA_CREADA', 'RECHAZADA', 'SPAM')
        AND email IS NULL AND nombre_contacto IS NULL AND nombre_negocio IS NULL AND telefono IS NULL
        AND cuit IS NULL AND id_de_medicion IS NULL AND nota_interna IS NULL
        AND NOT (atribucion ? 'fbclid'))),
  -- Sin consentimiento de medición no se guarda lo que identifica al navegador.
  CONSTRAINT solicitud_medicion_ck CHECK (
    medicion_consentida = (version_de_aviso_de_medicion IS NOT NULL)
    AND (medicion_consentida OR (id_de_medicion IS NULL AND NOT (atribucion ? 'fbclid'))))
);
CREATE UNIQUE INDEX solicitud_abierta_uk ON solicitud_de_alta (marca_id, email)
  WHERE estado IN ('NUEVA', 'VERIFICADA', 'APROBADA');
CREATE INDEX solicitud_bandeja_ix ON solicitud_de_alta (estado, creada_en);
CREATE INDEX solicitud_correo_ix ON solicitud_de_alta (marca_id, email, creada_en DESC) WHERE email IS NOT NULL;

-- Contadores del abuso. Claves seudónimas: HMAC del servidor sobre la IP o el correo; nunca la IP en claro.
CREATE TABLE limite_de_captacion (
  clave          text NOT NULL CONSTRAINT limite_clave_ck
                 CHECK (clave ~ '^(ip|correo):[0-9a-f]{64}$' OR clave IN ('global:solicitudes', 'global:verificaciones')),
  ventana        text NOT NULL CONSTRAINT limite_ventana_ck CHECK (ventana IN ('HORA', 'DIA', 'SEMANA')),
  ventana_inicio timestamptz NOT NULL,
  cuenta         integer NOT NULL CONSTRAINT limite_cuenta_ck CHECK (cuenta >= 1),
  CONSTRAINT limite_de_captacion_pkey PRIMARY KEY (clave, ventana, ventana_inicio)
);

-- ---------------------------------------------------------------------------------------------
-- Disparadores: las invariantes que la base impone aunque el código se olvide
-- ---------------------------------------------------------------------------------------------

-- Qué puede cambiar en una solicitud y cuándo. Lo que las políticas no pueden decir (no ven la fila
-- vieja en el WITH CHECK) lo dice acá; QUIÉN lo hace lo dicen las políticas.
CREATE FUNCTION solicitud_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  -- (1) Una fila anonimizada no cambia más.
  IF OLD.anonimizada_en IS NOT NULL THEN
    RAISE EXCEPTION 'una solicitud anonimizada no se modifica'
      USING ERRCODE = '23514', CONSTRAINT = 'solicitud_anonimizada_inmutable';
  END IF;

  -- (2) Lo que se congela al crearla: identidad, marca, consentimiento, finalidad, rubro y provincia.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.marca_id IS DISTINCT FROM OLD.marca_id
     OR NEW.creada_en IS DISTINCT FROM OLD.creada_en
     OR NEW.finalidad IS DISTINCT FROM OLD.finalidad
     OR NEW.version_de_terminos IS DISTINCT FROM OLD.version_de_terminos
     OR NEW.version_de_privacidad IS DISTINCT FROM OLD.version_de_privacidad
     OR NEW.medicion_consentida IS DISTINCT FROM OLD.medicion_consentida
     OR NEW.version_de_aviso_de_medicion IS DISTINCT FROM OLD.version_de_aviso_de_medicion
     OR NEW.rubro IS DISTINCT FROM OLD.rubro
     OR NEW.provincia IS DISTINCT FROM OLD.provincia THEN
    RAISE EXCEPTION 'la identidad, la marca, el consentimiento, el rubro y la provincia de una solicitud no cambian'
      USING ERRCODE = '23514', CONSTRAINT = 'solicitud_inmutable';
  END IF;

  -- (3) El estado cambia solo por esta tabla (la de `TRANSICIONES_DE_SOLICITUD`).
  IF NEW.estado <> OLD.estado AND NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('NUEVA', 'VERIFICADA'),
      ('NUEVA', 'RECHAZADA'),
      ('NUEVA', 'SPAM'),
      ('VERIFICADA', 'APROBADA'),
      ('VERIFICADA', 'RECHAZADA'),
      ('VERIFICADA', 'SPAM'),
      ('APROBADA', 'ALTA_CREADA'),
      ('APROBADA', 'RECHAZADA')
    ) AS permitida (desde, hasta)
    WHERE permitida.desde = OLD.estado AND permitida.hasta = NEW.estado
  ) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'solicitud_transicion_invalida';
  END IF;

  -- (4) La decisión (quién, cuándo, por qué, la empresa y la nota) cambia solo junto con el estado.
  IF NEW.estado = OLD.estado AND (
       NEW.decidida_por IS DISTINCT FROM OLD.decidida_por
       OR NEW.decidida_en IS DISTINCT FROM OLD.decidida_en
       OR NEW.motivo_de_rechazo IS DISTINCT FROM OLD.motivo_de_rechazo
       OR NEW.empresa_creada_id IS DISTINCT FROM OLD.empresa_creada_id
       OR (NEW.nota_interna IS DISTINCT FROM OLD.nota_interna AND NEW.anonimizada_en IS NULL)) THEN
    RAISE EXCEPTION 'la decisión de una solicitud cambia solo junto con su estado'
      USING ERRCODE = '23514', CONSTRAINT = 'solicitud_decision_sin_cambio';
  END IF;

  -- (5) Los envíos: solo una NUEVA que sigue NUEVA, de a uno (el tope de 5 lo pone el CHECK), y el último
  -- envío cambia junto con la cuenta y nunca hacia atrás.
  IF NEW.numero_de_envios IS DISTINCT FROM OLD.numero_de_envios THEN
    IF OLD.estado <> 'NUEVA' OR NEW.estado <> 'NUEVA' OR NEW.numero_de_envios <> OLD.numero_de_envios + 1 THEN
      RAISE EXCEPTION 'los envíos de una solicitud suben de a uno y solo mientras está NUEVA'
        USING ERRCODE = '23514', CONSTRAINT = 'solicitud_envios';
    END IF;
  ELSIF NEW.ultimo_envio_en IS DISTINCT FROM OLD.ultimo_envio_en THEN
    RAISE EXCEPTION 'el último envío cambia solo junto con la cuenta de envíos'
      USING ERRCODE = '23514', CONSTRAINT = 'solicitud_envios';
  END IF;
  IF NEW.ultimo_envio_en < OLD.ultimo_envio_en THEN
    RAISE EXCEPTION 'el último envío no retrocede'
      USING ERRCODE = '23514', CONSTRAINT = 'solicitud_envios';
  END IF;

  -- (6) La fecha de verificación se fija una vez, en el paso NUEVA -> VERIFICADA, y no se toca más.
  IF NEW.verificada_en IS DISTINCT FROM OLD.verificada_en
     AND NOT (OLD.estado = 'NUEVA' AND NEW.estado = 'VERIFICADA' AND OLD.verificada_en IS NULL) THEN
    RAISE EXCEPTION 'la fecha de verificación se fija una sola vez, al verificar'
      USING ERRCODE = '23514', CONSTRAINT = 'solicitud_decision_sin_cambio';
  END IF;

  -- (7) Los datos personales y la atribución solo cambian al anonimizar, y anonimizar no toca nada más:
  -- pone en NULL lo personal y quita el `fbclid`.
  IF NEW.anonimizada_en IS NOT NULL THEN
    IF NEW.estado IS DISTINCT FROM OLD.estado
       OR NEW.decidida_por IS DISTINCT FROM OLD.decidida_por
       OR NEW.decidida_en IS DISTINCT FROM OLD.decidida_en
       OR NEW.motivo_de_rechazo IS DISTINCT FROM OLD.motivo_de_rechazo
       OR NEW.empresa_creada_id IS DISTINCT FROM OLD.empresa_creada_id
       OR NEW.verificada_en IS DISTINCT FROM OLD.verificada_en
       OR NEW.numero_de_envios IS DISTINCT FROM OLD.numero_de_envios
       OR NEW.ultimo_envio_en IS DISTINCT FROM OLD.ultimo_envio_en
       OR NEW.atribucion IS DISTINCT FROM (OLD.atribucion - 'fbclid') THEN
      RAISE EXCEPTION 'anonimizar una solicitud no toca nada más que los datos personales y el fbclid'
        USING ERRCODE = '23514', CONSTRAINT = 'solicitud_personales_inmutables';
    END IF;
  ELSIF NEW.email IS DISTINCT FROM OLD.email
     OR NEW.nombre_contacto IS DISTINCT FROM OLD.nombre_contacto
     OR NEW.nombre_negocio IS DISTINCT FROM OLD.nombre_negocio
     OR NEW.telefono IS DISTINCT FROM OLD.telefono
     OR NEW.cuit IS DISTINCT FROM OLD.cuit
     OR NEW.id_de_medicion IS DISTINCT FROM OLD.id_de_medicion
     OR NEW.atribucion IS DISTINCT FROM OLD.atribucion THEN
    RAISE EXCEPTION 'los datos personales y la atribución de una solicitud no cambian (solo se anonimizan)'
      USING ERRCODE = '23514', CONSTRAINT = 'solicitud_personales_inmutables';
  END IF;

  RETURN NEW;
END
$$;

-- Los contadores solo suben, de a uno, y el resto de la fila no cambia: ni la landing equivocada ni una
-- comprometida puede poner un tope en cero.
CREATE FUNCTION limite_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.clave IS DISTINCT FROM OLD.clave
     OR NEW.ventana IS DISTINCT FROM OLD.ventana
     OR NEW.ventana_inicio IS DISTINCT FROM OLD.ventana_inicio
     OR NEW.cuenta <> OLD.cuenta + 1 THEN
    RAISE EXCEPTION 'un contador de captación solo sube de a uno'
      USING ERRCODE = '23514', CONSTRAINT = 'limite_cuenta_solo_sube';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER solicitud_cambio BEFORE UPDATE ON solicitud_de_alta
  FOR EACH ROW EXECUTE FUNCTION solicitud_validar_cambio();
-- Se dispara después de `solicitud_cambio` (orden alfabético): la versión sube solo si el cambio es válido.
CREATE TRIGGER solicitud_version BEFORE UPDATE ON solicitud_de_alta
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
-- Nadie borra una solicitud, ni el dueño de la tabla: se anonimiza (`sin_borrado()` es de 0007).
CREATE TRIGGER solicitud_sin_borrado BEFORE DELETE ON solicitud_de_alta
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER solicitud_sin_truncate BEFORE TRUNCATE ON solicitud_de_alta
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER limite_cuenta BEFORE UPDATE ON limite_de_captacion
  FOR EACH ROW EXECUTE FUNCTION limite_validar_cambio();
CREATE TRIGGER limite_sin_truncate BEFORE TRUNCATE ON limite_de_captacion
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y el DELETE de los contadores es la única excepción (P7)
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON solicitud_de_alta, limite_de_captacion FROM PUBLIC;

-- Las funciones de validación las ejecuta quien escribe las columnas que validan (un CHECK corre con los
-- permisos de quien escribe, en cada INSERT y UPDATE de la fila).
GRANT EXECUTE ON FUNCTION atribucion_valida(jsonb) TO zuluhub_captacion, zuluhub_plataforma;
GRANT EXECUTE ON FUNCTION datos_de_auditoria_de_captacion_validos(jsonb) TO zuluhub_captacion;
GRANT EXECUTE ON FUNCTION app_captacion() TO zuluhub_captacion;
-- Ya las tenían los otros cuatro roles desde 0001: la landing necesita el contexto firmado y el CUIT.
GRANT EXECUTE ON FUNCTION contexto_firmado(), cuit_valido(text) TO zuluhub_captacion;
GRANT USAGE ON SCHEMA public TO zuluhub_captacion;

-- Captación: crear, leer la propia, verificar; encolar sus correos; dejar su constancia; contar.
-- Sin nombre, negocio, teléfono, CUIT ni nota: no los necesita (el correo de verificación va a la dirección).
GRANT INSERT (marca_id, email, nombre_contacto, nombre_negocio, telefono, cuit, id_de_medicion, rubro,
              provincia, atribucion, version_de_terminos, version_de_privacidad, medicion_consentida,
              version_de_aviso_de_medicion, ultimo_envio_en, creada_en)
  ON solicitud_de_alta TO zuluhub_captacion;
GRANT SELECT (id, marca_id, estado, email, numero_de_envios, ultimo_envio_en, verificada_en, decidida_en,
              motivo_de_rechazo, medicion_consentida, id_de_medicion, atribucion, rubro, provincia,
              anonimizada_en, version, creada_en)
  ON solicitud_de_alta TO zuluhub_captacion;
GRANT UPDATE (estado, verificada_en, numero_de_envios, ultimo_envio_en)
  ON solicitud_de_alta TO zuluhub_captacion;
GRANT INSERT (empresa_id, tipo, datos, clave_idempotencia) ON trabajo TO zuluhub_captacion;
GRANT INSERT (actor, accion, entidad, entidad_id, antes, despues) ON auditoria_plataforma TO zuluhub_captacion;
GRANT SELECT, DELETE ON limite_de_captacion TO zuluhub_captacion;
GRANT INSERT (clave, ventana, ventana_inicio, cuenta) ON limite_de_captacion TO zuluhub_captacion;
GRANT UPDATE (cuenta) ON limite_de_captacion TO zuluhub_captacion;

-- Plataforma: leer todo; decidir (solo un ADMIN, con su id); vencer y anonimizar (el actor `sistema`).
GRANT SELECT ON solicitud_de_alta TO zuluhub_plataforma;
GRANT UPDATE (estado, decidida_por, decidida_en, motivo_de_rechazo, nota_interna, empresa_creada_id,
              anonimizada_en, email, nombre_contacto, nombre_negocio, telefono, cuit, id_de_medicion,
              atribucion)
  ON solicitud_de_alta TO zuluhub_plataforma;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada en toda tabla nueva; sin política no hay acceso
-- ---------------------------------------------------------------------------------------------
ALTER TABLE solicitud_de_alta ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitud_de_alta FORCE ROW LEVEL SECURITY;
ALTER TABLE limite_de_captacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE limite_de_captacion FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- Políticas de la landing: solo la fila que el contexto firmado nombra
-- ---------------------------------------------------------------------------------------------
CREATE POLICY solicitud_captacion_leer ON solicitud_de_alta FOR SELECT TO zuluhub_captacion
  USING (
    anonimizada_en IS NULL
    AND (
      id::text = (SELECT app_captacion()->>'s')
      OR (marca_id::text = (SELECT app_captacion()->>'m') AND email = (SELECT app_captacion()->>'e'))
    )
  );
-- No repite `estado = 'NUEVA'`: la columna no está en el GRANT INSERT y toma el valor por defecto.
CREATE POLICY solicitud_captacion_alta ON solicitud_de_alta FOR INSERT TO zuluhub_captacion
  WITH CHECK (
    marca_id::text = (SELECT app_captacion()->>'m') AND email = (SELECT app_captacion()->>'e')
  );
-- Solo una NUEVA de su contexto, y solo para dejarla NUEVA (reenvío) o pasarla a VERIFICADA.
CREATE POLICY solicitud_captacion_verificar ON solicitud_de_alta FOR UPDATE TO zuluhub_captacion
  USING (
    estado = 'NUEVA'
    AND anonimizada_en IS NULL
    AND (
      id::text = (SELECT app_captacion()->>'s')
      OR (marca_id::text = (SELECT app_captacion()->>'m') AND email = (SELECT app_captacion()->>'e'))
    )
  )
  WITH CHECK (estado IN ('NUEVA', 'VERIFICADA'));

-- Trabajos (P5). Tres políticas, una por tipo: ámbito plataforma (sin empresa), clave de idempotencia con la
-- forma exacta y la del id de la solicitud que el contexto ve, `datos` con una lista cerrada de claves.
--  * Verificación: la solicitud sigue NUEVA y el número del correo (1 a 5) no pasa de los envíos contados:
--    cada correo sale de un envío que subió el contador, que el CHECK y el disparador acotan a 5.
--  * Aviso al dueño: la solicitud ya está VERIFICADA (nadie avisa de lo no verificado).
--  * Evento a terceros: la solicitud dio su consentimiento de medición, y el nombre del evento va en la clave.
CREATE POLICY trabajo_captacion_verificacion ON trabajo FOR INSERT TO zuluhub_captacion
  WITH CHECK (
    empresa_id IS NULL
    AND tipo = 'enviar_verificacion_de_solicitud'
    AND jsonb_typeof(datos) = 'object'
    AND datos - 'solicitudId' = '{}'::jsonb
    AND clave_idempotencia = ANY (ARRAY[
          'solicitud:' || (datos->>'solicitudId') || ':verificacion:1',
          'solicitud:' || (datos->>'solicitudId') || ':verificacion:2',
          'solicitud:' || (datos->>'solicitudId') || ':verificacion:3',
          'solicitud:' || (datos->>'solicitudId') || ':verificacion:4',
          'solicitud:' || (datos->>'solicitudId') || ':verificacion:5'])
    AND EXISTS (
      SELECT 1 FROM solicitud_de_alta s
      WHERE s.id::text = datos->>'solicitudId'
        AND s.estado = 'NUEVA'
        AND (regexp_match(clave_idempotencia, ':verificacion:([1-5])$'))[1]::int <= s.numero_de_envios
    )
  );
CREATE POLICY trabajo_captacion_aviso ON trabajo FOR INSERT TO zuluhub_captacion
  WITH CHECK (
    empresa_id IS NULL
    AND tipo = 'avisar_solicitud_verificada'
    AND jsonb_typeof(datos) = 'object'
    AND datos - 'solicitudId' = '{}'::jsonb
    AND clave_idempotencia = 'solicitud:' || (datos->>'solicitudId') || ':aviso'
    AND EXISTS (
      SELECT 1 FROM solicitud_de_alta s
      WHERE s.id::text = datos->>'solicitudId' AND s.estado = 'VERIFICADA'
    )
  );
CREATE POLICY trabajo_captacion_evento ON trabajo FOR INSERT TO zuluhub_captacion
  WITH CHECK (
    empresa_id IS NULL
    AND tipo = 'evento_de_captacion'
    AND jsonb_typeof(datos) = 'object'
    AND datos - ARRAY['solicitudId', 'evento'] = '{}'::jsonb
    AND datos->>'evento' ~ '^[a-z_]{1,40}$'
    AND clave_idempotencia = 'solicitud:' || (datos->>'solicitudId') || ':evento:' || (datos->>'evento')
    AND EXISTS (
      SELECT 1 FROM solicitud_de_alta s
      WHERE s.id::text = datos->>'solicitudId' AND s.medicion_consentida
    )
  );

-- Auditoría (P5): la constancia de lo que hizo la landing, como actor `captacion`, solo de las tres acciones
-- que le corresponden, con claves y valores de la lista blanca, y solo sobre una solicitud visible para su
-- contexto cuyo estado corresponde a la acción (nadie fabrica una verificación que no ocurrió).
CREATE POLICY auditoria_plataforma_captacion ON auditoria_plataforma FOR INSERT TO zuluhub_captacion
  WITH CHECK (
    actor = 'captacion'
    AND entidad = 'solicitud_de_alta'
    AND accion IN ('SOLICITUD_RECIBIDA', 'SOLICITUD_REENVIO', 'SOLICITUD_VERIFICADA')
    AND datos_de_auditoria_de_captacion_validos(antes)
    AND datos_de_auditoria_de_captacion_validos(despues)
    AND EXISTS (
      SELECT 1 FROM solicitud_de_alta s
      WHERE s.id::text = entidad_id
        AND (
          (accion = 'SOLICITUD_RECIBIDA' AND s.estado = 'NUEVA')
          OR (accion = 'SOLICITUD_REENVIO' AND s.estado = 'NUEVA' AND s.numero_de_envios > 1)
          OR (accion = 'SOLICITUD_VERIFICADA' AND s.estado = 'VERIFICADA')
        )
    )
  );

-- Acota lo que la landing puede escribir en la auditoría, que no se borra: a lo sumo una constancia de cada acción
-- por solicitud (y de cada reenvío por su número, del 1 al 5). Sin esto, una landing equivocada o comprometida
-- podría llenar la tabla con constancias repetidas de una solicitud que ve. Es un índice sobre una tabla vieja
-- (aditivo): las constancias de la plataforma (otro actor) no entran.
CREATE UNIQUE INDEX auditoria_plataforma_captacion_uk ON auditoria_plataforma
  (entidad_id, accion, (coalesce(despues->>'numeroDeEnvio', '')))
  WHERE actor = 'captacion';

-- Contadores: con un contexto de captación firmado, usar los suyos; borrar solo los de más de 8 días (P7).
CREATE POLICY limite_captacion_leer ON limite_de_captacion FOR SELECT TO zuluhub_captacion
  USING ((SELECT app_captacion()) IS NOT NULL);
CREATE POLICY limite_captacion_alta ON limite_de_captacion FOR INSERT TO zuluhub_captacion
  WITH CHECK ((SELECT app_captacion()) IS NOT NULL);
CREATE POLICY limite_captacion_contar ON limite_de_captacion FOR UPDATE TO zuluhub_captacion
  USING ((SELECT app_captacion()) IS NOT NULL)
  WITH CHECK ((SELECT app_captacion()) IS NOT NULL);
CREATE POLICY limite_captacion_purgar ON limite_de_captacion FOR DELETE TO zuluhub_captacion
  USING ((SELECT app_captacion()) IS NOT NULL AND ventana_inicio < now() - interval '8 days');

-- ---------------------------------------------------------------------------------------------
-- Políticas de la plataforma: leer con un actor vigente; decidir solo un ADMIN; vencer y anonimizar solo
-- `sistema`. Mismo esquema que 0007: una permisiva simple y la restrictiva del actor (se suman con AND).
-- ---------------------------------------------------------------------------------------------
CREATE POLICY solicitud_plataforma_leer ON solicitud_de_alta FOR SELECT TO zuluhub_plataforma USING (true);
CREATE POLICY solicitud_plataforma_cambiar ON solicitud_de_alta FOR UPDATE TO zuluhub_plataforma
  USING (true) WITH CHECK (true);

CREATE POLICY solicitud_plataforma_con_actor ON solicitud_de_alta AS RESTRICTIVE FOR SELECT
  TO zuluhub_plataforma USING ((SELECT plataforma_actor_vigente()));
-- Un SOPORTE no decide: su UPDATE afecta 0 filas (el caso de uso lo frena antes con SIN_PERMISO). Un ADMIN
-- decide a su nombre (`decidida_por` es el actor firmado: nadie decide a nombre de otro). `sistema` solo
-- puede rechazar por `NO_VERIFICADA` o anonimizar; nunca aprobar ni rechazar con otro motivo.
CREATE POLICY solicitud_plataforma_quien_cambia ON solicitud_de_alta AS RESTRICTIVE FOR UPDATE
  TO zuluhub_plataforma
  USING (
    (SELECT admin_plataforma_con_rol(ARRAY['ADMIN']))
    OR (SELECT app_actor_plataforma()) = 'sistema'
  )
  WITH CHECK (
    (
      (SELECT admin_plataforma_con_rol(ARRAY['ADMIN']))
      AND decidida_por = (SELECT app_actor_plataforma())
      AND anonimizada_en IS NULL
    )
    OR (
      (SELECT app_actor_plataforma()) = 'sistema'
      AND (
        (estado = 'RECHAZADA' AND motivo_de_rechazo = 'NO_VERIFICADA' AND decidida_por = 'sistema')
        OR anonimizada_en IS NOT NULL
      )
    )
  );
