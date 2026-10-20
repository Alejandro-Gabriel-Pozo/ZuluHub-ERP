-- 0007_marcas_y_planes: marcas comerciales, dominios, versiones de marca, planes y sus versiones,
-- asignación de plan por tenant, ajustes de perillas y módulos activados por empresa, más el tramo
-- previo común (hora de corte de la sucursal, nivel de cada control, unicidad de la referencia de error
-- y auditoría de los intentos fallidos de la vista de grupo). Marcas, productos y planes (M3);
-- conciliación de módulos §3 y §4; ADR-004, ADR-011, ADR-014; decisiones del dueño del 2026-10-12.
--
-- Reglas de esta migración (las mismas de 0001 a 0006):
--  * Es ADITIVA, con estas excepciones declaradas y no destructivas:
--      - `tenant.marca_id` (columna nueva, NOT NULL, rellenada con la marca principal de las empresas
--        que ya existen) y `sucursal.hora_de_corte` (columna nueva con valor por defecto constante);
--      - `auditoria_acceso_grupo.resultado` (columna nueva con valor por defecto) y el cambio de su
--        política de alta, para registrar también los intentos fallidos de quien no es propietario;
--      - la restricción única `referencia_de_error_referencia_uk` sobre una tabla existente.
--    Ninguna fila existente se reescribe ni se borra. Su reversión es un script aparte, revisado y
--    DESTRUCTIVO: `migraciones/reversiones/0007_revertir_marcas_y_planes.sql` (el ejecutor no lo
--    aplica: solo toma los archivos `NNNN_nombre.sql` de esta carpeta).
--  * No agrega NINGUNA función SECURITY DEFINER: la única del esquema sigue siendo
--    `contexto_firmado()` (un meta-test lo exige). Todo corre con los permisos de quien consulta.
--  * Toda función nueva fija `search_path = pg_catalog, public, pg_temp`, califica sus tablas con
--    `public.` y nace sin EXECUTE para PUBLIC. Las de validación de datos (IMMUTABLE, sin acceso a
--    tablas) se otorgan solo a quien escribe las columnas que validan.
--  * Nadie recibe DELETE ni TRUNCATE. INSERT y UPDATE van por columna. Los disparadores frenan el
--    borrado y el vaciado de las tablas nuevas aun al dueño de la base.
--  * RLS activa y FORZADA en toda tabla nueva. Toda única de una tabla con `empresa_id` lo incluye,
--    salvo `referencia_de_error_referencia_uk` (excepción explícita, ver P5).
--  * DEPENDE de 0004: la plataforma solo toca las tablas nuevas bajo las políticas RESTRICTIVAS del
--    actor firmado. Se comprueba al empezar.
--  * Crea el sexto rol, `pedernal_publico` (NOLOGIN, solo lectura, SIN contexto): quien administra la
--    base le da LOGIN y contraseña fuera del repositorio. Sin contraseñas, claves ni cadenas de
--    conexión en este archivo.
--
-- Decisiones de diseño (todas probadas por tests; los números son de esta migración):
--
--  P1. La marca es presentación y puerta, no frontera de aislamiento: el aislamiento sigue siendo por
--      empresa. `pedernal_publico` lee solo columnas públicas de marcas ACTIVAS, dominios ACTIVOS (por la
--      vista `resolucion_de_host`) y versiones de marca confirmadas y ya vigentes (jamás módulos
--      iniciales, plan por defecto, motivo ni quién). Ni `empresa` ni `tenant` se le abren: la marca de
--      un host de empresa viaja DENTRO de la fila del dominio. Las únicas relaciones que ese rol puede
--      leer sin contexto son estas tres tablas y la vista.
--  P2. Las funciones de validación repiten en SQL lo que el dominio valida (`normalizarHost`,
--      `validarTextoVisible`, `validarTema`, `validarVocabulario`, `validarVersionDePlan`) como
--      defensa en profundidad: un test compara cada una con su par de TypeScript sobre cientos de
--      casos y, para los caracteres prohibidos, sobre TODOS los puntos de código. No conocen los
--      catálogos (que viven en el código).
--  P3. Versiones y asignaciones nunca se reescriben: una versión de plan PUBLICADA y una de marca
--      CONFIRMADA quedan congeladas (también para el dueño de la base); la asignación de plan y el
--      ajuste de perilla son de solo inserción. «La última decisión manda» (§B.5.6) es de la lectura,
--      no de la base: la base garantiza el número consecutivo por tenant (`numeroEsperado`) con un
--      disparador y una restricción única, que juntos valen en cualquier nivel de aislamiento.
--  P4. `tenant.marca_id` es inmutable (decisión del dueño: el cliente no cambia de marca). El relleno
--      NO usa UPDATE: agrega la columna con la marca principal como valor por defecto constante (no
--      reescribe la tabla ni dispara `fijar_version_y_fecha`) y después quita el valor por defecto.
--      Un alta sin marca falla a propósito: la marca de un tenant la elige quien lo da de alta.
--  P5. `referencia_de_error_referencia_uk` (la espera el reintento de soporte) es global: la referencia
--      la sortea el servidor, no la elige el cliente, y los roles que la escriben no pueden leer la
--      tabla. Un choque de dos referencias iguales de empresas distintas solo revela que un código de
--      32 bits al azar ya existe. Es una excepción explícita al meta-test de únicas con `empresa_id`.
--  P6. Intentos fallidos de la vista de grupo (decisión del dueño): `auditoria_acceso_grupo.resultado`
--      distingue 'PERMITIDO' (propietario activo, como hasta ahora) de 'DENEGADO' (quien NO es
--      propietario activo del tenant del contexto). La política vieja pasa a exigir 'PERMITIDO' y una
--      nueva deja registrar 'DENEGADO'. Cambiar la consulta de grupo para que lo use es un cambio
--      aparte de código.
--  P7. `nivel_de_control`: sin fila vale PERMITIR. La base impone forma, aislamiento y operabilidad de
--      la empresa; que solo el gerente lo cambie y que una sucursal solo pueda endurecer (ADR-008) lo
--      decide el código de `capacidades/controles`.

-- ---------------------------------------------------------------------------------------------
-- Verificaciones previas: se frena con un mensaje claro, sin haber cambiado nada
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_repetidas bigint;
BEGIN
  IF to_regprocedure('public.plataforma_actor_vigente()') IS NULL
     OR to_regprocedure('public.admin_plataforma_con_rol(text[])') IS NULL
     OR to_regprocedure('public.app_actor_plataforma()') IS NULL THEN
    RAISE EXCEPTION '0007 requiere 0004_plataforma aplicada antes (faltan las funciones del actor de plataforma)'
      USING ERRCODE = '55000';
  END IF;
  -- `IS NORMALIZED` (NFC) solo existe para bases UTF8.
  IF pg_catalog.pg_encoding_to_char((SELECT encoding FROM pg_catalog.pg_database WHERE datname = current_database())) <> 'UTF8' THEN
    RAISE EXCEPTION '0007 necesita una base UTF8 (la validación de textos visibles usa la forma NFC)'
      USING ERRCODE = '55000';
  END IF;
  -- La única de la referencia de error no se puede crear si ya hay referencias repetidas: la tabla es
  -- de solo inserción, así que no se limpian solas.
  SELECT count(*) INTO v_repetidas
    FROM (SELECT referencia FROM public.referencia_de_error GROUP BY referencia HAVING count(*) > 1) r;
  IF v_repetidas > 0 THEN
    RAISE EXCEPTION 'hay % referencias de error repetidas: la tabla es de solo inserción, hay que decidir con el dueño qué hacer antes de migrar', v_repetidas
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Sexto rol: lectura pública de marcas, SIN contexto (a nivel de clúster: se crea solo si falta).
-- Mismo bloque que 0001 y 0004: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT, atributos forzados si ya
-- existía, sin pertenencias a otros roles, topes de tiempo y sin objetos temporales.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  r constant text := 'pedernal_publico';
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
-- PARTE 0: tramo previo común
-- ---------------------------------------------------------------------------------------------

-- Hora de corte de la jornada, por sucursal (empresas). `empresa.zona_horaria` ya existe desde 0001.
-- Minutos enteros, de 00:00 a 23:59 (la `HoraDelDia` del dominio): `time '24:00'` es válido para
-- Postgres y equivaldría a 00:00 del día siguiente. El valor por defecto es constante: agregar la
-- columna no reescribe la tabla ni toca la versión de ninguna sucursal.
ALTER TABLE sucursal ADD COLUMN hora_de_corte time NOT NULL DEFAULT '00:00'
  CONSTRAINT sucursal_hora_de_corte_ck
  CHECK (hora_de_corte < time '24:00' AND extract(second FROM hora_de_corte) = 0);
-- La política `sucursal_app_cambiar` ya acota quién puede cambiarla (la empresa operable).
GRANT UPDATE (hora_de_corte) ON sucursal TO pedernal_app;

-- Nivel de cada control de ADR-008 dentro de la empresa (P7). Sin fila = PERMITIR.
CREATE TABLE nivel_de_control (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  sucursal_id    uuid,  -- NULL: toda la empresa
  control        text NOT NULL CONSTRAINT nivel_de_control_control_ck CHECK (control ~ '^[a-z]+\.[a-z_]+$'),
  nivel          text NOT NULL CONSTRAINT nivel_de_control_nivel_ck CHECK (nivel IN ('PERMITIR', 'AVISAR', 'BLOQUEAR')),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT nivel_de_control_uk UNIQUE NULLS NOT DISTINCT (empresa_id, sucursal_id, control),
  CONSTRAINT nivel_de_control_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id)
    REFERENCES sucursal (id, empresa_id)
);

-- La referencia de error no se repite (P5). El índice común de 0004 sobre la misma columna queda: no
-- se borra nada.
ALTER TABLE referencia_de_error
  ADD CONSTRAINT referencia_de_error_referencia_uk UNIQUE (referencia);

-- Intentos fallidos de la vista de grupo (P6). El valor por defecto conserva el significado de las
-- filas existentes: todas son de un propietario activo.
ALTER TABLE auditoria_acceso_grupo ADD COLUMN resultado text NOT NULL DEFAULT 'PERMITIDO'
  CONSTRAINT auditoria_acceso_grupo_resultado_ck CHECK (resultado IN ('PERMITIDO', 'DENEGADO'));
GRANT INSERT (resultado) ON auditoria_acceso_grupo TO pedernal_grupo;
-- Un propietario activo registra su acceso ('PERMITIDO'), como hasta ahora.
ALTER POLICY auditoria_acceso_grupo_alta ON auditoria_acceso_grupo
  WITH CHECK (
    tenant_id = (SELECT app_tenant_id()) AND persona_id = (SELECT app_persona_id())
    AND resultado = 'PERMITIDO' AND es_propietario_activo(tenant_id)
  );
-- Quien NO es propietario activo del tenant del contexto deja constancia del intento ('DENEGADO'):
-- el tenant y la persona salen del contexto firmado, no los elige quien escribe.
CREATE POLICY auditoria_acceso_grupo_denegado ON auditoria_acceso_grupo FOR INSERT TO pedernal_grupo
  WITH CHECK (
    tenant_id = (SELECT app_tenant_id()) AND persona_id = (SELECT app_persona_id())
    AND resultado = 'DENEGADO' AND NOT es_propietario_activo(tenant_id)
  );

-- ---------------------------------------------------------------------------------------------
-- Funciones de validación de datos (P2): IMMUTABLE, sin acceso a tablas, false ante NULL.
-- ---------------------------------------------------------------------------------------------

-- Un host YA NORMALIZADO, igual que `normalizarHost(h)` devuelve `h` sin cambios (src/modulos/marcas/
-- dominio/host.ts): solo ASCII `[a-z0-9.-]` en minúsculas, sin puerto ni punto final; etiquetas de 1 a
-- 63 sin guion al principio ni al final; de 1 a 253 caracteres; y la ÚLTIMA etiqueta no parece un
-- número (decimal o `0x`), que un navegador tomaría por una dirección IP. El signo Kelvin y demás
-- letras de otros alfabetos no están en `[a-z]` (los rangos de la expresión regular son por punto de
-- código).
CREATE FUNCTION host_valido(h text) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN h IS NULL OR char_length(h) NOT BETWEEN 1 AND 253 THEN false
    ELSE h ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
         AND h !~ '(^|\.)([0-9]+|0x[0-9a-f]*)$'
  END
$$;

-- Un texto que ve el usuario, en su forma canónica (src/capacidades/vocabulario/texto-visible.ts):
-- de 1 a `p_maximo` caracteres, NFC, sin blancos al principio ni al final (los que recorta
-- `String.prototype.trim`), sin caracteres de control (Cc) ni de formato (Cf: ancho cero, marcas
-- bidireccionales, guion blando) y sin `<` ni `>`. Las listas de Cc y Cf son explícitas (no dependen
-- de la versión de Unicode del servidor); un test las compara con las de Node sobre todos los puntos
-- de código y avisa cuando cambian.
CREATE FUNCTION texto_visible_valido(t text, p_maximo integer) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN t IS NULL OR p_maximo IS NULL OR char_length(t) NOT BETWEEN 1 AND p_maximo THEN false
    ELSE t IS NFC NORMALIZED
         AND t !~ ('[\x01-\x1f\x7f-\x9f<>'
                   || '\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u180e\u200b-\u200f'
                   || '\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb'
                   || '\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3'
                   || '\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]')
         AND t !~ '^[ \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]'
         AND t !~ '[ \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$'
  END
$$;

-- El tema de una versión de marca: un objeto cuyas claves son la lista CERRADA de tokens y cuyos
-- valores son `#rrggbb` en minúsculas (src/modulos/marcas/dominio/tema.ts). Nada de CSS libre.
CREATE FUNCTION tema_valido(t jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN t IS NULL OR jsonb_typeof(t) <> 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_each(t) AS e (token, valor)
       WHERE e.token NOT IN ('primary', 'on-primary', 'secondary', 'accent')
          OR jsonb_typeof(e.valor) <> 'string'
          OR (e.valor #>> '{}') !~ '^#[0-9a-f]{6}$'
    )
  END
$$;

-- El vocabulario de una marca (src/capacidades/vocabulario): un objeto de a lo sumo 500 textos cuya
-- clave tiene la forma `^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$` (en minúsculas; hasta 120 caracteres) y
-- cuyo valor es un texto visible válido de hasta 200 caracteres. La base no conoce el catálogo de
-- claves ni los marcadores: eso lo valida el dominio al guardar el borrador.
CREATE FUNCTION vocabulario_valido(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'object' THEN false
    ELSE (SELECT count(*) FROM jsonb_object_keys(v)) <= 500
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(v) AS e (texto, valor)
            WHERE char_length(e.texto) > 120
               OR e.texto !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$'
               OR jsonb_typeof(e.valor) <> 'string'
               OR NOT public.texto_visible_valido(e.valor #>> '{}', 200)
         )
  END
$$;

-- Los valores de perillas de una versión de plan: un objeto `perilla -> valor` donde la perilla tiene
-- la forma `^[a-z][a-z0-9_.]{1,63}$` y el valor es el `ValorDePerilla` del dominio, con su etiqueta:
-- `{"tipo":"INTERRUPTOR","encendida":bool}` o `{"tipo":"LIMITE","limite":n}` con `n` entero de 0 a
-- 999999999 o el texto "ILIMITADO" (src/capacidades/planes/valores.ts). Con `p_admite_del_plan` el
-- texto "DEL_PLAN" (volver al valor del plan) también vale. A lo sumo 200 perillas. La base no conoce el
-- catálogo: que la perilla exista y que el tipo coincida con su definición lo valida el dominio.
CREATE FUNCTION perillas_validas(p jsonb, p_admite_del_plan boolean) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN p IS NULL OR p_admite_del_plan IS NULL OR jsonb_typeof(p) <> 'object' THEN false
    ELSE (SELECT count(*) FROM jsonb_object_keys(p)) <= 200
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(p) AS e (perilla, valor)
            WHERE e.perilla !~ '^[a-z][a-z0-9_.]{1,63}$'
               OR NOT coalesce(  -- un campo que falta da NULL: cuenta como inválido
                 CASE jsonb_typeof(e.valor)
                   WHEN 'string' THEN p_admite_del_plan AND e.valor = '"DEL_PLAN"'::jsonb
                   WHEN 'object' THEN
                     (SELECT count(*) FROM jsonb_object_keys(e.valor)) = 2
                     AND (
                       (e.valor ->> 'tipo' = 'INTERRUPTOR' AND jsonb_typeof(e.valor -> 'encendida') = 'boolean')
                       OR (
                         e.valor ->> 'tipo' = 'LIMITE'
                         AND (
                           e.valor -> 'limite' = '"ILIMITADO"'::jsonb
                           OR (jsonb_typeof(e.valor -> 'limite') = 'number'
                               AND (e.valor ->> 'limite') ~ '^(0|[1-9][0-9]{0,8})$')
                         )
                       )
                     )
                   ELSE false
                 END,
                 false
               )
         )
  END
$$;

-- Una lista de módulos del catálogo: sin NULL, sin repetidos, de una dimensión, de a lo sumo 100, cada
-- clave con la forma `^[a-z][a-z0-9_]{1,39}$`. Vacía vale (solo los obligatorios).
CREATE FUNCTION claves_de_modulo_validas(m text[]) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN m IS NULL THEN false
    WHEN cardinality(m) = 0 THEN true
    ELSE array_ndims(m) = 1
         AND cardinality(m) <= 100
         AND NOT EXISTS (SELECT 1 FROM unnest(m) AS x WHERE x IS NULL OR x !~ '^[a-z][a-z0-9_]{1,39}$')
         AND cardinality(m) = (SELECT count(DISTINCT x) FROM unnest(m) AS x)
  END
$$;

-- ---------------------------------------------------------------------------------------------
-- PARTE 1: marcas, planes y módulos activados
-- ---------------------------------------------------------------------------------------------

-- La marca comercial. La principal (`pedernal`, nombre técnico fijo) nace acá; las demás las crea la
-- plataforma. Sin versión confirmada, la principal todavía no se resuelve (página neutra).
CREATE TABLE marca (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         text NOT NULL CONSTRAINT marca_codigo_ck CHECK (codigo ~ '^[a-z][a-z0-9-]{1,39}$'),
  es_principal   boolean NOT NULL DEFAULT false,
  marca_padre_id uuid REFERENCES marca (id),
  nivel          smallint NOT NULL DEFAULT 0 CONSTRAINT marca_nivel_ck CHECK (nivel BETWEEN 0 AND 2),
  estado         text NOT NULL DEFAULT 'ACTIVA' CONSTRAINT marca_estado_ck CHECK (estado IN ('ACTIVA', 'RETIRADA')),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT marca_codigo_uk UNIQUE (codigo),
  CONSTRAINT marca_principal_ck CHECK (NOT es_principal OR (marca_padre_id IS NULL AND estado = 'ACTIVA'))
);
-- A lo sumo una marca principal en toda la instalación.
CREATE UNIQUE INDEX marca_principal_uk ON marca ((true)) WHERE es_principal;

-- Dominios por superficie (decisión del dueño, 2026-10-12): el nombre de host EXACTO por el que se entra
-- (§B.2) y qué se sirve ahí. Un host tiene UNA superficie y UN dueño: una marca (host compartido, p. ej.
-- la carta de muchas empresas) o una empresa (host dedicado, p. ej. la carta de una sola). La resolución
-- es host -> (dueño, superficie): quien sirve una superficie solo acepta un host de ESA superficie; cualquier
-- otra combinación es la página neutra (esa comparación es de la puerta; la base garantiza que un host
-- tiene una sola superficie y un solo dueño).
--   * `duenio_marca_id` / `duenio_empresa_id`: exactamente uno de los dos.
--   * `marca_id`: la marca por cuya puerta se entra. En un host de marca es la marca dueña; en un host de
--     empresa la fija el disparador desde el tenant de la empresa (el tenant no cambia de marca). Está
--     acá para que el rol público resuelva el host sin leer `empresa` ni `tenant`.
--   * `titular`: quién es el titular del dominio en el registrador (el cliente, o el operador cuando es
--     del dueño de Pedernal). Pedernal no guarda credenciales del registrador ni del DNS.
--   * Estados: PENDIENTE_VERIFICACION (registrado; sirve la página neutra) -> VERIFICADO (la
--     comprobación dio bien) -> ACTIVO (sirve su superficie). Si la comprobación falla después, vuelve a
--     PENDIENTE_VERIFICACION (página neutra, sin tocar datos). RETIRADO es terminal y se puede ir ahí
--     desde cualquier estado, con motivo. Solo se activa con `verificado_en`.
--   * `es_canonico`: el host que arma los enlaces de la marca para esa superficie (el host APP en los
--     mails de invitación); solo en hosts de marca, a lo sumo uno vigente por (marca, superficie).
-- Un dominio retirado no se vuelve a activar: se registra otro. El host es único mientras no esté
-- retirado (uno retirado puede registrarse de nuevo, por ejemplo cuando se va el cliente y otro lo toma).
CREATE TABLE dominio (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host             text NOT NULL CONSTRAINT dominio_host_ck CHECK (host_valido(host)),
  superficie       text NOT NULL CONSTRAINT dominio_superficie_ck
                   CHECK (superficie IN ('APP', 'CARTA', 'LANDING', 'CONSOLA')),
  duenio_marca_id   uuid REFERENCES marca (id),
  duenio_empresa_id uuid REFERENCES empresa (id),
  marca_id         uuid NOT NULL REFERENCES marca (id),
  titular          text NOT NULL CONSTRAINT dominio_titular_ck CHECK (titular IN ('CLIENTE', 'OPERADOR')),
  es_canonico      boolean NOT NULL DEFAULT false,
  estado           text NOT NULL DEFAULT 'PENDIENTE_VERIFICACION' CONSTRAINT dominio_estado_ck
                   CHECK (estado IN ('PENDIENTE_VERIFICACION', 'VERIFICADO', 'ACTIVO', 'RETIRADO')),
  verificado_en    timestamptz,
  motivo           text,
  registrado_por   text NOT NULL CONSTRAINT dominio_registrado_por_ck CHECK (registrado_por <> ''),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT dominio_duenio_ck CHECK ((duenio_marca_id IS NOT NULL) <> (duenio_empresa_id IS NOT NULL)),
  CONSTRAINT dominio_marca_duena_ck CHECK (duenio_marca_id IS NULL OR marca_id = duenio_marca_id),
  -- Una empresa tiene su aplicación o su carta; la landing y la consola son de una marca.
  CONSTRAINT dominio_superficie_duenio_ck CHECK (duenio_empresa_id IS NULL OR superficie IN ('APP', 'CARTA')),
  CONSTRAINT dominio_canonico_ck CHECK (NOT es_canonico OR duenio_marca_id IS NOT NULL),
  CONSTRAINT dominio_verificacion_ck CHECK (
    (estado = 'PENDIENTE_VERIFICACION' AND verificado_en IS NULL)
    OR (estado IN ('VERIFICADO', 'ACTIVO') AND verificado_en IS NOT NULL)
    OR (estado = 'RETIRADO' AND motivo IS NOT NULL AND btrim(motivo) <> '')
  )
);
CREATE UNIQUE INDEX dominio_host_uk ON dominio (host) WHERE estado <> 'RETIRADO';
CREATE UNIQUE INDEX dominio_canonico_uk ON dominio (duenio_marca_id, superficie)
  WHERE es_canonico AND estado <> 'RETIRADO';

-- Plan: un nombre comercial para un preset de perillas. Global de la fábrica, sin precio.
CREATE TABLE plan (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         text NOT NULL CONSTRAINT plan_codigo_ck CHECK (codigo ~ '^[a-z][a-z0-9-]{1,39}$'),
  estado         text NOT NULL DEFAULT 'ACTIVO' CONSTRAINT plan_estado_ck CHECK (estado IN ('ACTIVO', 'RETIRADO')),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT plan_codigo_uk UNIQUE (codigo)
);

-- Versión de un plan: BORRADOR (editable, una por plan) -> PUBLICADA (congelada). El borrador no lleva
-- nada de la publicación; la publicada lleva todo.
CREATE TABLE version_de_plan (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES plan (id),
  numero           integer CONSTRAINT version_de_plan_numero_ck CHECK (numero > 0),  -- NULL en borrador
  estado           text NOT NULL DEFAULT 'BORRADOR'
                   CONSTRAINT version_de_plan_estado_ck CHECK (estado IN ('BORRADOR', 'PUBLICADA')),
  nombre_comercial text NOT NULL CONSTRAINT version_de_plan_nombre_ck CHECK (texto_visible_valido(nombre_comercial, 60)),
  modulos          text[] NOT NULL DEFAULT '{}' CONSTRAINT version_de_plan_modulos_ck CHECK (claves_de_modulo_validas(modulos)),
  perillas         jsonb NOT NULL DEFAULT '{}' CONSTRAINT version_de_plan_perillas_ck CHECK (perillas_validas(perillas, false)),
  motivo           text,
  publicada_en     timestamptz,
  publicada_por    text,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT version_de_plan_numero_uk UNIQUE (plan_id, numero),
  CONSTRAINT version_de_plan_publicada_ck CHECK (
    (estado = 'PUBLICADA'
       AND numero IS NOT NULL AND publicada_en IS NOT NULL AND publicada_por IS NOT NULL
       AND motivo IS NOT NULL AND btrim(motivo) <> '')
    OR (estado = 'BORRADOR'
       AND numero IS NULL AND publicada_en IS NULL AND publicada_por IS NULL AND motivo IS NULL)
  )
);
CREATE UNIQUE INDEX version_de_plan_borrador_uk ON version_de_plan (plan_id) WHERE estado = 'BORRADOR';

-- Versión de una marca (la definición de producto): BORRADOR -> CONFIRMADA con vigencia. Campo vacío
-- (NULL o `{}`) = hereda de la marca padre. Vigente, futura o sin efecto se CALCULAN (la última
-- decisión manda: rige la de mayor número entre las que ya empezaron).
CREATE TABLE version_de_marca (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marca_id             uuid NOT NULL REFERENCES marca (id),
  numero               integer CONSTRAINT version_de_marca_numero_ck CHECK (numero > 0),  -- NULL en borrador
  estado               text NOT NULL DEFAULT 'BORRADOR'
                       CONSTRAINT version_de_marca_estado_ck CHECK (estado IN ('BORRADOR', 'CONFIRMADA')),
  vigente_desde        timestamptz,
  nombre_visible       text CONSTRAINT version_de_marca_nombre_ck
                       CHECK (nombre_visible IS NULL OR texto_visible_valido(nombre_visible, 60)),
  tema                 jsonb NOT NULL DEFAULT '{}' CONSTRAINT version_de_marca_tema_ck CHECK (tema_valido(tema)),
  logo                 text CONSTRAINT version_de_marca_logo_ck
                       CHECK (logo IS NULL OR logo ~ '^/marcas/[a-z0-9-]+/[a-z0-9-]+\.(png|webp)$'),
  vocabulario          jsonb NOT NULL DEFAULT '{}' CONSTRAINT version_de_marca_vocabulario_ck CHECK (vocabulario_valido(vocabulario)),
  modulos_iniciales    text[] CONSTRAINT version_de_marca_modulos_ck
                       CHECK (modulos_iniciales IS NULL OR claves_de_modulo_validas(modulos_iniciales)),
  plan_por_defecto_id  uuid REFERENCES plan (id),
  reemplaza_programada boolean NOT NULL DEFAULT false,
  motivo               text,
  confirmada_en        timestamptz,
  confirmada_por       text,
  creado_en            timestamptz NOT NULL DEFAULT now(),
  actualizado_en       timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  CONSTRAINT version_de_marca_numero_uk UNIQUE (marca_id, numero),
  CONSTRAINT version_de_marca_confirmada_ck CHECK (
    (estado = 'CONFIRMADA'
       AND numero IS NOT NULL AND vigente_desde IS NOT NULL AND confirmada_en IS NOT NULL
       AND confirmada_por IS NOT NULL AND motivo IS NOT NULL AND btrim(motivo) <> '')
    OR (estado = 'BORRADOR'
       AND numero IS NULL AND vigente_desde IS NULL AND confirmada_en IS NULL AND confirmada_por IS NULL
       AND motivo IS NULL AND NOT reemplaza_programada)
  ),
  -- Sin vigencia retroactiva, con un minuto de tolerancia de reloj entre servidores (como H5).
  CONSTRAINT version_de_marca_vigencia_ck CHECK (vigente_desde IS NULL OR vigente_desde >= confirmada_en - interval '1 minute')
);
CREATE UNIQUE INDEX version_de_marca_borrador_uk ON version_de_marca (marca_id) WHERE estado = 'BORRADOR';

-- La marca principal (P4). Se inserta antes de activar RLS: el dueño que migra no necesita evadirla.
INSERT INTO marca (codigo, es_principal) VALUES ('pedernal', true);

-- tenant.marca_id (P4): columna nueva, NOT NULL, rellenada con la principal SIN reescribir filas.
DO $$
DECLARE
  v_principal uuid;
BEGIN
  SELECT id INTO STRICT v_principal FROM public.marca WHERE es_principal;
  EXECUTE format(
    'ALTER TABLE public.tenant ADD COLUMN marca_id uuid NOT NULL DEFAULT %L '
    'CONSTRAINT tenant_marca_id_fkey REFERENCES public.marca (id)',
    v_principal
  );
  -- A partir de acá un alta sin marca falla: la elige quien da de alta al tenant.
  ALTER TABLE public.tenant ALTER COLUMN marca_id DROP DEFAULT;
END
$$;

-- Qué plan rige para un tenant y desde cuándo: solo inserción, con número consecutivo por tenant. Cambiar
-- de plan es insertar otra fila; vigente, programada o sin efecto se calculan.
CREATE TABLE plan_de_tenant (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant (id),
  numero               integer NOT NULL CONSTRAINT plan_de_tenant_numero_ck CHECK (numero > 0),
  version_de_plan_id   uuid NOT NULL REFERENCES version_de_plan (id),
  vigente_desde        timestamptz NOT NULL,
  origen               text NOT NULL CONSTRAINT plan_de_tenant_origen_ck
                       CHECK (origen IN ('ALTA', 'CAMBIO', 'MIGRACION_DE_VERSION')),
  reemplaza_programada boolean NOT NULL DEFAULT false,
  motivo               text NOT NULL CONSTRAINT plan_de_tenant_motivo_ck CHECK (btrim(motivo) <> ''),
  asignado_por         text NOT NULL CONSTRAINT plan_de_tenant_asignado_por_ck CHECK (asignado_por <> ''),
  creado_en            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_de_tenant_numero_uk UNIQUE (tenant_id, numero),
  CONSTRAINT plan_de_tenant_vigencia_ck CHECK (vigente_desde >= creado_en - interval '1 minute')
);
CREATE INDEX plan_de_tenant_version_ix ON plan_de_tenant (version_de_plan_id);

-- El extra (o la excepción) de un cliente: reemplaza el valor del plan para un tenant o una empresa.
-- Solo inserción; `DEL_PLAN` vuelve al valor del plan.
CREATE TABLE ajuste_de_perilla (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant (id),
  empresa_id           uuid REFERENCES empresa (id),  -- NULL: todo el tenant
  perilla              text NOT NULL CONSTRAINT ajuste_de_perilla_perilla_ck CHECK (perilla ~ '^[a-z][a-z0-9_.]{1,63}$'),
  numero               integer NOT NULL CONSTRAINT ajuste_de_perilla_numero_ck CHECK (numero > 0),
  valor                text NOT NULL CONSTRAINT ajuste_de_perilla_valor_ck
                       CHECK (valor ~ '^(0|[1-9][0-9]{0,8}|ILIMITADO|DEL_PLAN)$'),
  vigente_desde        timestamptz NOT NULL,
  reemplaza_programada boolean NOT NULL DEFAULT false,
  motivo               text NOT NULL CONSTRAINT ajuste_de_perilla_motivo_ck CHECK (btrim(motivo) <> ''),
  asignado_por         text NOT NULL CONSTRAINT ajuste_de_perilla_asignado_por_ck CHECK (asignado_por <> ''),
  creado_en            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ajuste_de_perilla_numero_uk UNIQUE NULLS NOT DISTINCT (tenant_id, empresa_id, perilla, numero),
  CONSTRAINT ajuste_de_perilla_vigencia_ck CHECK (vigente_desde >= creado_en - interval '1 minute')
);

-- Módulos activados por empresa (decisión 19). Los obligatorios no se guardan. Solo la plataforma
-- activa o desactiva; nada se borra.
CREATE TABLE modulo_de_empresa (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  modulo         text NOT NULL CONSTRAINT modulo_de_empresa_modulo_ck CHECK (modulo ~ '^[a-z][a-z0-9_]{1,39}$'),
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT modulo_de_empresa_pkey PRIMARY KEY (empresa_id, modulo)
);

-- La resolución de la puerta: host -> (dueño, superficie, marca). Es lo único de `dominio` que el rol
-- público necesita, y la única forma de leerlo sin contexto: solo dominios ACTIVOS de marcas ACTIVAS, y
-- de cada uno solo el host, su superficie, el dueño (marca o empresa, como identificadores opacos) y la
-- marca de entrada. Nunca el titular, el motivo, quién lo registró ni dato alguno de una empresa o de un
-- tenant. `security_invoker`: se ejecuta con los privilegios y las políticas de quien la consulta, así que
-- no abre nada que ese rol no pueda leer ya en las tablas. Quien sirve una superficie consulta
-- `WHERE host = $1 AND superficie = $2`: el mismo host en otra superficie no devuelve nada.
CREATE VIEW resolucion_de_host WITH (security_invoker = true) AS
  SELECT d.host, d.superficie, d.duenio_marca_id, d.duenio_empresa_id, d.marca_id
    FROM dominio d
    JOIN marca m ON m.id = d.marca_id   -- la política pública de `marca` deja pasar solo las ACTIVAS
   WHERE d.estado = 'ACTIVO';

-- ---------------------------------------------------------------------------------------------
-- Disparadores: invariantes que la base impone aunque el código se olvide
-- ---------------------------------------------------------------------------------------------

-- Ninguna fila de estas tablas se borra: el borrado y el vaciado se frenan hasta para el dueño. (Las
-- de solo inserción usan `solo_insercion()` de 0001.)
CREATE FUNCTION sin_borrado() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION 'la tabla % no admite borrados', TG_TABLE_NAME
    USING ERRCODE = '42501';
END
$$;

-- Una versión congelada (publicada o confirmada) tampoco se borra; el borrador sí lo puede borrar el dueño.
CREATE FUNCTION version_congelada_no_se_borra() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF OLD.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'una versión % no se borra', lower(OLD.estado)
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END
$$;

-- Marca: el nivel se deriva del padre (0 sin padre, padre + 1); el padre tiene que estar ACTIVA; un nivel
-- mayor que 2 lo rechaza `marca_nivel_ck`. En una marca existente no cambian ni el id, ni el código, ni
-- «principal», ni el padre, ni el nivel (así no hay ciclos), y el estado solo va de ACTIVA a RETIRADA.
CREATE FUNCTION marca_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_nivel  smallint;
  v_estado text;
BEGIN
  IF NEW.marca_padre_id IS NULL THEN
    NEW.nivel := 0;
  ELSE
    -- FOR SHARE: retirar el padre a la vez que se le crea una hija espera a que termine una de las dos
    -- (como `empresa_validar_alta` con el tenant); sin él, la hija podría nacer bajo un padre ya retirado.
    SELECT m.nivel, m.estado INTO v_nivel, v_estado
      FROM public.marca m WHERE m.id = NEW.marca_padre_id FOR SHARE;
    -- Un padre inexistente lo rechaza la clave foránea (marca_marca_padre_id_fkey).
    IF FOUND THEN
      IF v_estado <> 'ACTIVA' THEN
        RAISE EXCEPTION 'la marca padre está retirada'
          USING ERRCODE = '23514', CONSTRAINT = 'marca_padre_retirada';
      END IF;
      NEW.nivel := v_nivel + 1;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION marca_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.codigo IS DISTINCT FROM OLD.codigo
     OR NEW.es_principal IS DISTINCT FROM OLD.es_principal
     OR NEW.marca_padre_id IS DISTINCT FROM OLD.marca_padre_id
     OR NEW.nivel IS DISTINCT FROM OLD.nivel
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'el código, la marca padre y «principal» de una marca no se pueden cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'marca_inmutable';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado = 'ACTIVA' AND NEW.estado = 'RETIRADA') THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'marca_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

-- Dominio: nace PENDIENTE_VERIFICACION, de una marca ACTIVA (la dueña, o la del tenant de la empresa
-- dueña, que el disparador copia a `marca_id`). Después no cambian ni el host, ni la superficie, ni el
-- dueño, ni la marca, ni el titular, ni el canónico, ni quién lo registró. El estado solo avanza por
-- PENDIENTE_VERIFICACION -> VERIFICADO -> ACTIVO; de VERIFICADO o ACTIVO se vuelve a
-- PENDIENTE_VERIFICACION (la comprobación falló); a RETIRADO se va desde cualquier estado menos el
-- canónico, y de RETIRADO no se sale. `verificado_en` se fija al verificar, se conserva al activar y se
-- borra al volver a pendiente.
CREATE FUNCTION dominio_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_marca  uuid;
  v_estado text;
BEGIN
  IF NEW.estado <> 'PENDIENTE_VERIFICACION' THEN
    RAISE EXCEPTION 'un dominio nace pendiente de verificación'
      USING ERRCODE = '23514', CONSTRAINT = 'dominio_nace_pendiente';
  END IF;
  IF NEW.duenio_marca_id IS NULL AND NEW.duenio_empresa_id IS NULL THEN
    RAISE EXCEPTION 'un dominio tiene una marca o una empresa dueña'
      USING ERRCODE = '23514', CONSTRAINT = 'dominio_duenio_ck';
  END IF;
  IF NEW.duenio_marca_id IS NOT NULL THEN
    v_marca := NEW.duenio_marca_id;
    SELECT m.estado INTO v_estado FROM public.marca m WHERE m.id = v_marca FOR SHARE;
    -- Una marca inexistente la rechaza la clave foránea (dominio_duenio_marca_id_fkey).
  ELSIF NEW.duenio_empresa_id IS NOT NULL THEN
    -- La marca de una empresa es la de su tenant. FOR SHARE: retirar la marca a la vez que se le
    -- registra un host espera a que termine una de las dos operaciones.
    SELECT t.marca_id INTO v_marca
      FROM public.empresa e JOIN public.tenant t ON t.id = e.tenant_id
     WHERE e.id = NEW.duenio_empresa_id;
    IF v_marca IS NULL THEN
      RAISE EXCEPTION 'la empresa dueña del dominio no existe'
        USING ERRCODE = '23503', CONSTRAINT = 'dominio_duenio_empresa_id_fkey';
    END IF;
    SELECT m.estado INTO v_estado FROM public.marca m WHERE m.id = v_marca FOR SHARE;
  END IF;
  IF FOUND AND v_estado <> 'ACTIVA' THEN
    RAISE EXCEPTION 'la marca está retirada: no admite dominios nuevos'
      USING ERRCODE = '23514', CONSTRAINT = 'dominio_marca_retirada';
  END IF;
  -- El dueño y la marca de entrada no los elige quien registra: la marca sale del dueño.
  NEW.marca_id := v_marca;
  RETURN NEW;
END
$$;

CREATE FUNCTION dominio_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.host IS DISTINCT FROM OLD.host
     OR NEW.superficie IS DISTINCT FROM OLD.superficie
     OR NEW.duenio_marca_id IS DISTINCT FROM OLD.duenio_marca_id
     OR NEW.duenio_empresa_id IS DISTINCT FROM OLD.duenio_empresa_id
     OR NEW.marca_id IS DISTINCT FROM OLD.marca_id
     OR NEW.titular IS DISTINCT FROM OLD.titular
     OR NEW.es_canonico IS DISTINCT FROM OLD.es_canonico
     OR NEW.registrado_por IS DISTINCT FROM OLD.registrado_por
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'el host, la superficie, el dueño y el titular de un dominio no se pueden cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'dominio_inmutable';
  END IF;
  IF OLD.estado = 'RETIRADO' THEN
    RAISE EXCEPTION 'un dominio retirado no se modifica: se registra otro'
      USING ERRCODE = '23514', CONSTRAINT = 'dominio_retirado_inmutable';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
       (OLD.estado = 'PENDIENTE_VERIFICACION' AND NEW.estado IN ('VERIFICADO', 'RETIRADO'))
    OR (OLD.estado = 'VERIFICADO' AND NEW.estado IN ('ACTIVO', 'PENDIENTE_VERIFICACION', 'RETIRADO'))
    OR (OLD.estado = 'ACTIVO' AND NEW.estado IN ('PENDIENTE_VERIFICACION', 'RETIRADO'))
  ) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'dominio_transicion_invalida';
  END IF;
  IF OLD.es_canonico AND NEW.estado = 'RETIRADO' THEN
    RAISE EXCEPTION 'el dominio canónico no se retira'
      USING ERRCODE = '23514', CONSTRAINT = 'dominio_canonico_no_se_retira';
  END IF;
  -- La fecha de verificación solo se escribe al verificar y solo se borra al volver a pendiente: activar
  -- o retirar no la tocan (sin ella, un host se «activaría» con otra prueba de titularidad).
  IF NEW.verificado_en IS DISTINCT FROM OLD.verificado_en
     AND NOT (OLD.estado = 'PENDIENTE_VERIFICACION' AND NEW.estado = 'VERIFICADO')
     AND NEW.estado <> 'PENDIENTE_VERIFICACION'
  THEN
    RAISE EXCEPTION 'la fecha de verificación del dominio solo cambia al verificarlo o al volver a pendiente'
      USING ERRCODE = '23514', CONSTRAINT = 'dominio_verificacion_inmutable';
  END IF;
  RETURN NEW;
END
$$;

-- Plan: el código no cambia y el estado solo va de ACTIVO a RETIRADO.
CREATE FUNCTION plan_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.codigo IS DISTINCT FROM OLD.codigo
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'el código de un plan no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'plan_inmutable';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado = 'ACTIVO' AND NEW.estado = 'RETIRADO') THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'plan_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

-- Versión de plan: nace en borrador y de un plan ACTIVO. Una PUBLICADA queda congelada (todo UPDATE se
-- rechaza, también al dueño); de borrador solo se pasa a publicada, con el número siguiente del plan
-- (como la regla del emisor en 0006, P3).
CREATE FUNCTION version_de_plan_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
BEGIN
  IF NEW.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'una versión de plan nace en borrador'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_plan_transicion_invalida';
  END IF;
  SELECT p.estado INTO v_estado FROM public.plan p WHERE p.id = NEW.plan_id FOR SHARE;
  -- Un plan inexistente lo rechaza la clave foránea (version_de_plan_plan_id_fkey).
  IF FOUND AND v_estado <> 'ACTIVO' THEN
    RAISE EXCEPTION 'el plan está retirado: no admite versiones nuevas'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_plan_plan_retirado';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION version_de_plan_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_siguiente integer;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'la identidad de una versión de plan no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_plan_inmutable';
  END IF;
  IF OLD.estado = 'PUBLICADA' THEN
    RAISE EXCEPTION 'una versión de plan publicada no se puede modificar: se publica una nueva'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_plan_publicada_inmutable';
  END IF;
  -- Solo al publicar (de borrador a publicada): a una versión ya publicada no se le llega acá.
  IF OLD.estado = 'BORRADOR' AND NEW.estado = 'PUBLICADA' THEN
    SELECT coalesce(max(v.numero), 0) + 1 INTO v_siguiente
      FROM public.version_de_plan v WHERE v.plan_id = OLD.plan_id;
    IF NEW.numero IS DISTINCT FROM v_siguiente THEN
      RAISE EXCEPTION 'el número de la versión publicada tiene que ser %', v_siguiente
        USING ERRCODE = '23514', CONSTRAINT = 'version_de_plan_numero_invalido';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Versión de marca: lo mismo, para una marca ACTIVA y con el número siguiente de la marca.
CREATE FUNCTION version_de_marca_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
BEGIN
  IF NEW.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'una versión de marca nace en borrador'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_marca_transicion_invalida';
  END IF;
  SELECT m.estado INTO v_estado FROM public.marca m WHERE m.id = NEW.marca_id FOR SHARE;
  -- Una marca inexistente la rechaza la clave foránea (version_de_marca_marca_id_fkey).
  IF FOUND AND v_estado <> 'ACTIVA' THEN
    RAISE EXCEPTION 'la marca está retirada: no admite versiones nuevas'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_marca_marca_retirada';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION version_de_marca_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_siguiente integer;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.marca_id IS DISTINCT FROM OLD.marca_id
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'la identidad de una versión de marca no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_marca_inmutable';
  END IF;
  IF OLD.estado = 'CONFIRMADA' THEN
    RAISE EXCEPTION 'una versión de marca confirmada no se puede modificar: se confirma una nueva'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_marca_confirmada_inmutable';
  END IF;
  -- Solo al confirmar (de borrador a confirmada): a una versión ya confirmada no se le llega acá.
  IF OLD.estado = 'BORRADOR' AND NEW.estado = 'CONFIRMADA' THEN
    SELECT coalesce(max(v.numero), 0) + 1 INTO v_siguiente
      FROM public.version_de_marca v WHERE v.marca_id = OLD.marca_id;
    IF NEW.numero IS DISTINCT FROM v_siguiente THEN
      RAISE EXCEPTION 'el número de la versión confirmada tiene que ser %', v_siguiente
        USING ERRCODE = '23514', CONSTRAINT = 'version_de_marca_numero_invalido';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Asignación de plan: el número es exactamente el siguiente del tenant (el `numeroEsperado` + 1 del
-- caso de uso) y la versión referida está PUBLICADA. Dos asignaciones simultáneas desde el mismo punto
-- chocan en `plan_de_tenant_numero_uk`; la que reintenta ve el número nuevo y falla acá.
CREATE FUNCTION plan_de_tenant_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_siguiente integer;
  v_estado    text;
BEGIN
  SELECT coalesce(max(p.numero), 0) + 1 INTO v_siguiente
    FROM public.plan_de_tenant p WHERE p.tenant_id = NEW.tenant_id;
  IF NEW.numero IS DISTINCT FROM v_siguiente THEN
    RAISE EXCEPTION 'el número de la asignación tiene que ser %', v_siguiente
      USING ERRCODE = '23514', CONSTRAINT = 'plan_de_tenant_numero_invalido';
  END IF;
  SELECT v.estado INTO v_estado FROM public.version_de_plan v WHERE v.id = NEW.version_de_plan_id;
  -- Una versión inexistente la rechaza la clave foránea (plan_de_tenant_version_de_plan_id_fkey).
  IF FOUND AND v_estado <> 'PUBLICADA' THEN
    RAISE EXCEPTION 'la versión de plan asignada no está publicada'
      USING ERRCODE = '23514', CONSTRAINT = 'plan_de_tenant_version_no_publicada';
  END IF;
  RETURN NEW;
END
$$;

-- Ajuste de perilla: la empresa (si hay) es del tenant, y el número es el siguiente de (tenant, empresa,
-- perilla).
CREATE FUNCTION ajuste_de_perilla_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_siguiente integer;
  v_tenant    uuid;
BEGIN
  IF NEW.empresa_id IS NOT NULL THEN
    SELECT e.tenant_id INTO v_tenant FROM public.empresa e WHERE e.id = NEW.empresa_id;
    -- Una empresa inexistente la rechaza la clave foránea (ajuste_de_perilla_empresa_id_fkey).
    IF FOUND AND v_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'la empresa no pertenece al tenant del ajuste'
        USING ERRCODE = '23514', CONSTRAINT = 'ajuste_de_perilla_empresa_de_otro_tenant';
    END IF;
  END IF;
  SELECT coalesce(max(a.numero), 0) + 1 INTO v_siguiente
    FROM public.ajuste_de_perilla a
   WHERE a.tenant_id = NEW.tenant_id
     AND a.empresa_id IS NOT DISTINCT FROM NEW.empresa_id
     AND a.perilla = NEW.perilla;
  IF NEW.numero IS DISTINCT FROM v_siguiente THEN
    RAISE EXCEPTION 'el número del ajuste tiene que ser %', v_siguiente
      USING ERRCODE = '23514', CONSTRAINT = 'ajuste_de_perilla_numero_invalido';
  END IF;
  RETURN NEW;
END
$$;

-- El tenant no cambia de marca (decisión del dueño: para «pasar» de producto se le suman módulos).
CREATE FUNCTION tenant_validar_marca() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION 'el tenant no cambia de marca'
    USING ERRCODE = '23514', CONSTRAINT = 'tenant_marca_inmutable';
END
$$;

CREATE TRIGGER marca_alta BEFORE INSERT ON marca
  FOR EACH ROW EXECUTE FUNCTION marca_validar_alta();
CREATE TRIGGER marca_cambio BEFORE UPDATE ON marca
  FOR EACH ROW EXECUTE FUNCTION marca_validar_cambio();
CREATE TRIGGER marca_version BEFORE UPDATE ON marca
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER marca_sin_borrado BEFORE DELETE ON marca
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER marca_sin_truncate BEFORE TRUNCATE ON marca
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER dominio_alta BEFORE INSERT ON dominio
  FOR EACH ROW EXECUTE FUNCTION dominio_validar_alta();
CREATE TRIGGER dominio_cambio BEFORE UPDATE ON dominio
  FOR EACH ROW EXECUTE FUNCTION dominio_validar_cambio();
CREATE TRIGGER dominio_version BEFORE UPDATE ON dominio
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER dominio_sin_borrado BEFORE DELETE ON dominio
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER dominio_sin_truncate BEFORE TRUNCATE ON dominio
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER plan_cambio BEFORE UPDATE ON plan
  FOR EACH ROW EXECUTE FUNCTION plan_validar_cambio();
CREATE TRIGGER plan_version BEFORE UPDATE ON plan
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER plan_sin_borrado BEFORE DELETE ON plan
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER plan_sin_truncate BEFORE TRUNCATE ON plan
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER version_de_plan_alta BEFORE INSERT ON version_de_plan
  FOR EACH ROW EXECUTE FUNCTION version_de_plan_validar_alta();
CREATE TRIGGER version_de_plan_cambio BEFORE UPDATE ON version_de_plan
  FOR EACH ROW EXECUTE FUNCTION version_de_plan_validar_cambio();
CREATE TRIGGER version_de_plan_version BEFORE UPDATE ON version_de_plan
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER version_de_plan_sin_borrado BEFORE DELETE ON version_de_plan
  FOR EACH ROW EXECUTE FUNCTION version_congelada_no_se_borra();
CREATE TRIGGER version_de_plan_sin_truncate BEFORE TRUNCATE ON version_de_plan
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER version_de_marca_alta BEFORE INSERT ON version_de_marca
  FOR EACH ROW EXECUTE FUNCTION version_de_marca_validar_alta();
CREATE TRIGGER version_de_marca_cambio BEFORE UPDATE ON version_de_marca
  FOR EACH ROW EXECUTE FUNCTION version_de_marca_validar_cambio();
CREATE TRIGGER version_de_marca_version BEFORE UPDATE ON version_de_marca
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER version_de_marca_sin_borrado BEFORE DELETE ON version_de_marca
  FOR EACH ROW EXECUTE FUNCTION version_congelada_no_se_borra();
CREATE TRIGGER version_de_marca_sin_truncate BEFORE TRUNCATE ON version_de_marca
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER plan_de_tenant_alta BEFORE INSERT ON plan_de_tenant
  FOR EACH ROW EXECUTE FUNCTION plan_de_tenant_validar_alta();
CREATE TRIGGER plan_de_tenant_solo_insercion BEFORE UPDATE OR DELETE ON plan_de_tenant
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER plan_de_tenant_sin_truncate BEFORE TRUNCATE ON plan_de_tenant
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

CREATE TRIGGER ajuste_de_perilla_alta BEFORE INSERT ON ajuste_de_perilla
  FOR EACH ROW EXECUTE FUNCTION ajuste_de_perilla_validar_alta();
CREATE TRIGGER ajuste_de_perilla_solo_insercion BEFORE UPDATE OR DELETE ON ajuste_de_perilla
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER ajuste_de_perilla_sin_truncate BEFORE TRUNCATE ON ajuste_de_perilla
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

CREATE TRIGGER modulo_de_empresa_version BEFORE UPDATE ON modulo_de_empresa
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER modulo_de_empresa_sin_borrado BEFORE DELETE ON modulo_de_empresa
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER modulo_de_empresa_sin_truncate BEFORE TRUNCATE ON modulo_de_empresa
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER nivel_de_control_version BEFORE UPDATE ON nivel_de_control
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER nivel_de_control_sin_borrado BEFORE DELETE ON nivel_de_control
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER nivel_de_control_sin_truncate BEFORE TRUNCATE ON nivel_de_control
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- La marca del tenant no cambia: solo se dispara si el valor cambia (un UPDATE de otra columna no la toca).
CREATE TRIGGER tenant_marca_inmutable BEFORE UPDATE OF marca_id ON tenant
  FOR EACH ROW WHEN (NEW.marca_id IS DISTINCT FROM OLD.marca_id)
  EXECUTE FUNCTION tenant_validar_marca();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON marca, dominio, resolucion_de_host, plan, version_de_plan, version_de_marca, plan_de_tenant,
              ajuste_de_perilla, modulo_de_empresa, nivel_de_control
  FROM PUBLIC;

-- Las funciones de validación las ejecuta quien escribe las columnas que validan.
GRANT EXECUTE ON FUNCTION
  host_valido(text), texto_visible_valido(text, integer), tema_valido(jsonb), vocabulario_valido(jsonb),
  perillas_validas(jsonb, boolean), claves_de_modulo_validas(text[])
TO pedernal_plataforma;

-- público (sin contexto): solo las columnas que la puerta necesita para resolver la marca (P1).
GRANT USAGE ON SCHEMA public TO pedernal_publico;
GRANT SELECT (id, codigo, marca_padre_id, nivel, es_principal) ON marca TO pedernal_publico;
GRANT SELECT (host, superficie, estado, duenio_marca_id, duenio_empresa_id, marca_id) ON dominio TO pedernal_publico;
GRANT SELECT ON resolucion_de_host TO pedernal_publico;
GRANT SELECT (marca_id, numero, vigente_desde, nombre_visible, tema, logo, vocabulario)
  ON version_de_marca TO pedernal_publico;

-- app (contexto de empresa): la marca y su cadena (para heredar y para los mails), el dominio canónico,
-- lo asignado a su tenant (sin el motivo ni quién lo decidió) y los módulos y niveles de su empresa.
GRANT SELECT ON marca, modulo_de_empresa, nivel_de_control TO pedernal_app;
GRANT SELECT (host, superficie, marca_id, es_canonico) ON dominio TO pedernal_app;
GRANT SELECT (marca_id, numero, vigente_desde, nombre_visible, tema, logo, vocabulario)
  ON version_de_marca TO pedernal_app;
GRANT SELECT (id, plan_id, numero, nombre_comercial, modulos, perillas) ON version_de_plan TO pedernal_app;
GRANT SELECT (id, tenant_id, numero, version_de_plan_id, vigente_desde, origen, creado_en)
  ON plan_de_tenant TO pedernal_app;
GRANT SELECT (id, tenant_id, empresa_id, perilla, numero, valor, vigente_desde, creado_en)
  ON ajuste_de_perilla TO pedernal_app;
GRANT INSERT (empresa_id, sucursal_id, control, nivel) ON nivel_de_control TO pedernal_app;
GRANT UPDATE (nivel) ON nivel_de_control TO pedernal_app;

-- plataforma (actor firmado): lee todo lo nuevo (salvo los niveles de control, que son de la empresa) y
-- escribe marcas, dominios, planes, asignaciones, ajustes y módulos; solo un ADMIN, por las restrictivas.
GRANT SELECT ON marca, dominio, plan, version_de_plan, version_de_marca, plan_de_tenant,
                ajuste_de_perilla, modulo_de_empresa
  TO pedernal_plataforma;
GRANT INSERT (codigo, marca_padre_id) ON marca TO pedernal_plataforma;
GRANT UPDATE (estado) ON marca TO pedernal_plataforma;
GRANT INSERT (host, superficie, duenio_marca_id, duenio_empresa_id, titular, es_canonico, registrado_por)
  ON dominio TO pedernal_plataforma;
GRANT UPDATE (estado, verificado_en, motivo) ON dominio TO pedernal_plataforma;
GRANT INSERT (codigo) ON plan TO pedernal_plataforma;
GRANT UPDATE (estado) ON plan TO pedernal_plataforma;
GRANT INSERT (plan_id, nombre_comercial, modulos, perillas) ON version_de_plan TO pedernal_plataforma;
GRANT UPDATE (nombre_comercial, modulos, perillas, estado, numero, motivo, publicada_en, publicada_por)
  ON version_de_plan TO pedernal_plataforma;
GRANT INSERT (marca_id, nombre_visible, tema, logo, vocabulario, modulos_iniciales, plan_por_defecto_id)
  ON version_de_marca TO pedernal_plataforma;
GRANT UPDATE (nombre_visible, tema, logo, vocabulario, modulos_iniciales, plan_por_defecto_id,
              estado, numero, vigente_desde, reemplaza_programada, motivo, confirmada_en, confirmada_por)
  ON version_de_marca TO pedernal_plataforma;
GRANT INSERT (tenant_id, numero, version_de_plan_id, vigente_desde, origen, reemplaza_programada, motivo, asignado_por)
  ON plan_de_tenant TO pedernal_plataforma;
GRANT INSERT (tenant_id, empresa_id, perilla, numero, valor, vigente_desde, reemplaza_programada, motivo, asignado_por)
  ON ajuste_de_perilla TO pedernal_plataforma;
GRANT INSERT (empresa_id, modulo) ON modulo_de_empresa TO pedernal_plataforma;
GRANT UPDATE (activo) ON modulo_de_empresa TO pedernal_plataforma;
-- El tenant nuevo nace con su marca (P4); después no se cambia: no hay UPDATE (marca_id).
GRANT INSERT (marca_id) ON tenant TO pedernal_plataforma;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada en toda tabla nueva; sin política no hay acceso
-- ---------------------------------------------------------------------------------------------
ALTER TABLE marca ENABLE ROW LEVEL SECURITY;
ALTER TABLE marca FORCE ROW LEVEL SECURITY;
ALTER TABLE dominio ENABLE ROW LEVEL SECURITY;
ALTER TABLE dominio FORCE ROW LEVEL SECURITY;
ALTER TABLE plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan FORCE ROW LEVEL SECURITY;
ALTER TABLE version_de_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE version_de_plan FORCE ROW LEVEL SECURITY;
ALTER TABLE version_de_marca ENABLE ROW LEVEL SECURITY;
ALTER TABLE version_de_marca FORCE ROW LEVEL SECURITY;
ALTER TABLE plan_de_tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_de_tenant FORCE ROW LEVEL SECURITY;
ALTER TABLE ajuste_de_perilla ENABLE ROW LEVEL SECURITY;
ALTER TABLE ajuste_de_perilla FORCE ROW LEVEL SECURITY;
ALTER TABLE modulo_de_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE modulo_de_empresa FORCE ROW LEVEL SECURITY;
ALTER TABLE nivel_de_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE nivel_de_control FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- Políticas. Sin `FOR ALL`: cada comando tiene la suya. Sin ciclos: las de `version_de_plan` miran
-- `plan_de_tenant`, cuyas políticas miran `empresa` (por `tenant_de_empresa`), que no mira ninguna de
-- estas tablas.
-- ---------------------------------------------------------------------------------------------

-- público: sin contexto, solo lo declarado (P1).
CREATE POLICY marca_publico_leer ON marca FOR SELECT TO pedernal_publico
  USING (estado = 'ACTIVA');
CREATE POLICY dominio_publico_leer ON dominio FOR SELECT TO pedernal_publico
  USING (estado = 'ACTIVO');
CREATE POLICY version_de_marca_publico_leer ON version_de_marca FOR SELECT TO pedernal_publico
  USING (estado = 'CONFIRMADA' AND vigente_desde <= now());

-- app: con un contexto firmado válido (no hay filas sin contexto, como en el resto del esquema).
CREATE POLICY marca_app_leer ON marca FOR SELECT TO pedernal_app
  USING ((SELECT contexto_firmado()) IS NOT NULL);
CREATE POLICY dominio_app_leer ON dominio FOR SELECT TO pedernal_app
  USING (estado = 'ACTIVO' AND es_canonico AND (SELECT contexto_firmado()) IS NOT NULL);
CREATE POLICY version_de_marca_app_leer ON version_de_marca FOR SELECT TO pedernal_app
  USING (estado = 'CONFIRMADA' AND vigente_desde <= now() AND (SELECT contexto_firmado()) IS NOT NULL);
-- Solo las versiones que el tenant de la empresa tiene asignadas.
CREATE POLICY version_de_plan_app_leer ON version_de_plan FOR SELECT TO pedernal_app
  USING (
    estado = 'PUBLICADA'
    AND EXISTS (SELECT 1 FROM plan_de_tenant p WHERE p.version_de_plan_id = version_de_plan.id)
  );
CREATE POLICY plan_de_tenant_app_leer ON plan_de_tenant FOR SELECT TO pedernal_app
  USING (tenant_id = (SELECT tenant_de_empresa((SELECT app_empresa_id()))));
-- Los del tenant y, de los de una empresa, solo los de la propia.
CREATE POLICY ajuste_de_perilla_app_leer ON ajuste_de_perilla FOR SELECT TO pedernal_app
  USING (
    tenant_id = (SELECT tenant_de_empresa((SELECT app_empresa_id())))
    AND (empresa_id IS NULL OR empresa_id = (SELECT app_empresa_id()))
  );
-- Los módulos no los escribe la empresa (solo la plataforma los activa): no hay política de escritura.
CREATE POLICY modulo_de_empresa_app_leer ON modulo_de_empresa FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY nivel_de_control_app_leer ON nivel_de_control FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY nivel_de_control_app_alta ON nivel_de_control FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY nivel_de_control_app_cambiar ON nivel_de_control FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

-- plataforma: permisivas abiertas, acotadas por las restrictivas de más abajo (actor vigente para leer;
-- ADMIN para escribir). Quien crea o confirma es el actor del contexto firmado, nunca otro.
CREATE POLICY marca_plataforma_leer ON marca FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY marca_plataforma_alta ON marca FOR INSERT TO pedernal_plataforma WITH CHECK (true);
CREATE POLICY marca_plataforma_cambiar ON marca FOR UPDATE TO pedernal_plataforma USING (true) WITH CHECK (true);

CREATE POLICY dominio_plataforma_leer ON dominio FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY dominio_plataforma_alta ON dominio FOR INSERT TO pedernal_plataforma
  WITH CHECK (registrado_por = (SELECT app_actor_plataforma()));
CREATE POLICY dominio_plataforma_cambiar ON dominio FOR UPDATE TO pedernal_plataforma
  USING (true) WITH CHECK (true);

CREATE POLICY plan_plataforma_leer ON plan FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY plan_plataforma_alta ON plan FOR INSERT TO pedernal_plataforma WITH CHECK (true);
CREATE POLICY plan_plataforma_cambiar ON plan FOR UPDATE TO pedernal_plataforma USING (true) WITH CHECK (true);

-- Se edita solo el borrador; al publicar, quien publica es el actor del contexto.
CREATE POLICY version_de_plan_plataforma_leer ON version_de_plan FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY version_de_plan_plataforma_alta ON version_de_plan FOR INSERT TO pedernal_plataforma WITH CHECK (true);
CREATE POLICY version_de_plan_plataforma_cambiar ON version_de_plan FOR UPDATE TO pedernal_plataforma
  USING (estado = 'BORRADOR')
  WITH CHECK (estado = 'BORRADOR' OR publicada_por = (SELECT app_actor_plataforma()));

CREATE POLICY version_de_marca_plataforma_leer ON version_de_marca FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY version_de_marca_plataforma_alta ON version_de_marca FOR INSERT TO pedernal_plataforma WITH CHECK (true);
CREATE POLICY version_de_marca_plataforma_cambiar ON version_de_marca FOR UPDATE TO pedernal_plataforma
  USING (estado = 'BORRADOR')
  WITH CHECK (estado = 'BORRADOR' OR confirmada_por = (SELECT app_actor_plataforma()));

CREATE POLICY plan_de_tenant_plataforma_leer ON plan_de_tenant FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY plan_de_tenant_plataforma_alta ON plan_de_tenant FOR INSERT TO pedernal_plataforma
  WITH CHECK (asignado_por = (SELECT app_actor_plataforma()));

CREATE POLICY ajuste_de_perilla_plataforma_leer ON ajuste_de_perilla FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY ajuste_de_perilla_plataforma_alta ON ajuste_de_perilla FOR INSERT TO pedernal_plataforma
  WITH CHECK (asignado_por = (SELECT app_actor_plataforma()));

CREATE POLICY modulo_de_empresa_plataforma_leer ON modulo_de_empresa FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY modulo_de_empresa_plataforma_alta ON modulo_de_empresa FOR INSERT TO pedernal_plataforma
  WITH CHECK (true);
CREATE POLICY modulo_de_empresa_plataforma_cambiar ON modulo_de_empresa FOR UPDATE TO pedernal_plataforma
  USING (true) WITH CHECK (true);

-- Políticas RESTRICTIVAS de la plataforma (como las de 0004 a 0006): sin un actor vigente no ve nada,
-- y solo un ADMIN escribe (un SOPORTE ve, no cambia estructura).
CREATE POLICY marca_plataforma_con_actor ON marca AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY dominio_plataforma_con_actor ON dominio AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY plan_plataforma_con_actor ON plan AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY version_de_plan_plataforma_con_actor ON version_de_plan AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY version_de_marca_plataforma_con_actor ON version_de_marca AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY plan_de_tenant_plataforma_con_actor ON plan_de_tenant AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY ajuste_de_perilla_plataforma_con_actor ON ajuste_de_perilla AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY modulo_de_empresa_plataforma_con_actor ON modulo_de_empresa AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));

CREATE POLICY marca_plataforma_admin_alta ON marca AS RESTRICTIVE FOR INSERT TO pedernal_plataforma
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY marca_plataforma_admin_cambiar ON marca AS RESTRICTIVE FOR UPDATE TO pedernal_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY dominio_plataforma_admin_alta ON dominio AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY dominio_plataforma_admin_cambiar ON dominio AS RESTRICTIVE FOR UPDATE
  TO pedernal_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY plan_plataforma_admin_alta ON plan AS RESTRICTIVE FOR INSERT TO pedernal_plataforma
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY plan_plataforma_admin_cambiar ON plan AS RESTRICTIVE FOR UPDATE TO pedernal_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY version_de_plan_plataforma_admin_alta ON version_de_plan AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY version_de_plan_plataforma_admin_cambiar ON version_de_plan AS RESTRICTIVE FOR UPDATE
  TO pedernal_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY version_de_marca_plataforma_admin_alta ON version_de_marca AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY version_de_marca_plataforma_admin_cambiar ON version_de_marca AS RESTRICTIVE FOR UPDATE
  TO pedernal_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY plan_de_tenant_plataforma_admin_alta ON plan_de_tenant AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY ajuste_de_perilla_plataforma_admin_alta ON ajuste_de_perilla AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY modulo_de_empresa_plataforma_admin_alta ON modulo_de_empresa AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY modulo_de_empresa_plataforma_admin_cambiar ON modulo_de_empresa AS RESTRICTIVE FOR UPDATE
  TO pedernal_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
