-- 0006_fiscal: emisores (nivel 4), domicilios estructurados, datos fiscales versionados, regla del
-- emisor, puntos de venta y numeración de comprobantes (H7 fiscal base, tramo T3; ADR-004, ADR-011;
-- decisiones del dueño del 2026-10-12: un CUIT por emisor, el gerente edita y confirma los datos
-- fiscales, la plataforma crea los emisores secundarios y corrige el CUIT hasta el primer número).
--
-- Reglas de esta migración (las mismas de 0001 a 0005):
--  * Es ADITIVA: crea tablas, funciones, restricciones, disparadores y políticas. No borra ni
--    reescribe ningún dato, columna, política ni privilegio existente. La única escritura sobre
--    datos es el relleno del emisor principal de cada empresa existente (inserta en la tabla nueva y
--    no modifica ninguna fila vieja). Su reversión es un script aparte, revisado y DESTRUCTIVO para
--    los datos fiscales: `migraciones/reversiones/0006_revertir_fiscal.sql` (el ejecutor no lo
--    aplica: solo toma los archivos `NNNN_nombre.sql` de esta carpeta).
--  * No agrega NINGUNA función SECURITY DEFINER: la única del esquema sigue siendo
--    `contexto_firmado()` (un meta-test lo exige). Todo corre con los permisos de quien consulta.
--  * Toda función nueva fija `search_path = pg_catalog, public, pg_temp`, califica sus tablas con
--    `public.` y nace sin EXECUTE para PUBLIC. Las funciones de disparador no se otorgan a nadie.
--  * Nadie recibe DELETE ni TRUNCATE. INSERT y UPDATE van por columna.
--  * RLS activa y FORZADA en toda tabla nueva. Toda única de una tabla con `empresa_id` lo incluye,
--    salvo `emisor_cuit_uk` (excepción explícita, ver E1).
--  * Sin contraseñas, claves ni cadenas de conexión; no toca ningún rol.
--  * DEPENDE de 0004: la plataforma solo toca las tablas nuevas bajo las políticas RESTRICTIVAS del
--    actor firmado (`plataforma_actor_vigente()`, `admin_plataforma_con_rol()`). Sin ellas la
--    plataforma vería y escribiría sin actor. La especificación decía que 0006 era independiente de
--    0003 a 0005; se cambió a propósito, igual que en 0005 (ver informe).
--  * NO crea la tabla de comprobantes ni la de certificados de ARCA: son de la facturación (spec
--    H7 §A.2 y §B.9). La clave de idempotencia del comprobante `(empresa, origen_tipo, origen_id,
--    emisor, clase)` y el catálogo de tipos de origen viven en esa tabla futura.
--  * Necesita que el dueño que migra evada RLS (superusuario o BYPASSRLS; en Neon, `neondb_owner`): el
--    relleno lee `empresa` y escribe `emisor`, ambas con RLS forzada. Se verifica abajo.
--
-- Decisiones de diseño (todas probadas por tests):
--
--  E1. El CUIT del emisor PRINCIPAL no se copia: la columna `cuit` es NULL y su CUIT es `empresa.cuit`
--      (una sola fuente, sin nada que sincronizar). El del SECUNDARIO es propio, válido, único en toda
--      la instalación (`emisor_cuit_uk`, la ÚNICA única global del esquema de negocio: la detecta el
--      meta-test y la exceptúa por nombre) y distinto de todo `empresa.cuit` no cancelado. La premisa
--      de la excepción: ningún rol salvo la plataforma puede escribir `emisor.cuit`; así un cliente
--      no puede usar el error de duplicado para averiguar CUIT de otras empresas.
--  E2. Los disparadores cruzados (`empresa` <-> `emisor`) toman un bloqueo consultivo por CUIT: dos
--      altas simultáneas con el mismo CUIT se serializan aun bajo READ COMMITTED (la especificación
--      confiaba solo en SERIALIZABLE). Bajo SERIALIZABLE además lo detecta el motor (SSI).
--  E3. «CUIT inmutable tras el primer número» y «el número de un punto de venta no cambia con series
--      usadas» (una serie está usada si `ultimo_numero > 0` o no está `LIBRE`) se imponen con
--      disparadores, aun contra el dueño de la base. Para que no se crucen con una reserva en vuelo:
--      cada reserva (LIBRE -> EN_CURSO) toma el bloqueo consultivo COMPARTIDO del emisor, y quien
--      cambia el CUIT, desactiva el emisor o activa un punto de venta toma el EXCLUSIVO o el
--      compartido según corresponda (nunca se esperan entre sí en círculo: las filas se bloquean
--      siempre antes que el bloqueo consultivo). El cambio de número de un punto de venta, en
--      cambio, bloquea con FOR SHARE las series del punto de venta: así vale también bajo
--      REPEATABLE READ y SERIALIZABLE (Postgres aborta con 40001 si la serie cambió después de la
--      lectura). `zuluhub_plataforma` no puede bloquear filas (no tiene UPDATE sobre las series),
--      por eso el CUIT usa el bloqueo consultivo.
--  E4. Los datos fiscales y la regla del emisor se versionan: BORRADOR (uno por emisor, editable) ->
--      CONFIRMADA (inmutable). La base impone además lo que el dominio hace: la versión confirmada
--      lleva todo lo obligatorio (también `vigente_desde`, `confirmada_en` y `motivo`, que un CHECK
--      con comparaciones sobre NULL dejaría pasar), el borrador no lleva nada de la confirmación, el
--      `numero` es exactamente el máximo + 1 y nada nace ya confirmado.
--  E5. Los límites de texto del domicilio y de los datos fiscales repiten los del dominio
--      (`primitivas/domicilio`, `fiscal/dominio/datos-fiscales`): un test comprueba que todo lo que
--      el dominio acepta la base lo acepta. Son SUPUESTOS del dominio, no requisitos de ARCA.
--  E6. La serie de comprobantes impone con un disparador la misma tabla de transiciones que el
--      dominio (`transicionDeSerieValida`): `ultimo_numero` solo sube de a uno y solo cerrando una
--      EN_CURSO con ese número, nunca baja, y BLOQUEADA no sale (en H7 no hay salida). Un test
--      compara dominio y base sobre todas las combinaciones.
--  E7. El rol de grupo y el de trabajos no reciben nada: fallan cerrados hasta que fiscal publique
--      su consulta de grupo. La plataforma ve emisores y series enteras (los disparadores de CUIT la
--      necesitan) y de los puntos de venta solo 4 columnas; nunca ve domicilios ni datos fiscales.

-- ---------------------------------------------------------------------------------------------
-- Verificaciones previas: se frena con un mensaje claro, sin haber cambiado nada
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.plataforma_actor_vigente()') IS NULL
     OR to_regprocedure('public.admin_plataforma_con_rol(text[])') IS NULL THEN
    RAISE EXCEPTION '0006 necesita 0004_plataforma aplicada antes (faltan las funciones del actor de plataforma)'
      USING ERRCODE = '55000';
  END IF;
  -- El relleno de abajo lee `empresa` y escribe `emisor`, las dos con RLS forzada: sin un dueño que
  -- la evada no vería ninguna empresa y dejaría a todas sin emisor principal, en silencio.
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION '0006 necesita que el rol que migra evada RLS (superusuario o BYPASSRLS) para rellenar el emisor principal de cada empresa'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Provincia: catálogo GLOBAL de jurisdicciones, sembrado acá y de solo lectura
-- ---------------------------------------------------------------------------------------------
CREATE TABLE provincia (
  codigo      text PRIMARY KEY CONSTRAINT provincia_codigo_ck CHECK (codigo ~ '^AR-[A-Z]$'),
  nombre      text NOT NULL CONSTRAINT provincia_nombre_uk UNIQUE,
  codigo_arca smallint CONSTRAINT provincia_codigo_arca_uk UNIQUE  -- NULL hasta verificarlo (NO VERIFICADO)
);

-- ISO 3166-2:AR, las 24 jurisdicciones (coinciden con `primitivas/domicilio/provincias.ts`; un test
-- las compara). El código numérico de ARCA queda vacío hasta confirmarlo contra una fuente oficial.
INSERT INTO provincia (codigo, nombre) VALUES
  ('AR-B', 'Buenos Aires'),
  ('AR-K', 'Catamarca'),
  ('AR-H', 'Chaco'),
  ('AR-U', 'Chubut'),
  ('AR-C', 'Ciudad Autónoma de Buenos Aires'),
  ('AR-X', 'Córdoba'),
  ('AR-W', 'Corrientes'),
  ('AR-E', 'Entre Ríos'),
  ('AR-P', 'Formosa'),
  ('AR-Y', 'Jujuy'),
  ('AR-L', 'La Pampa'),
  ('AR-F', 'La Rioja'),
  ('AR-M', 'Mendoza'),
  ('AR-N', 'Misiones'),
  ('AR-Q', 'Neuquén'),
  ('AR-R', 'Río Negro'),
  ('AR-A', 'Salta'),
  ('AR-J', 'San Juan'),
  ('AR-D', 'San Luis'),
  ('AR-Z', 'Santa Cruz'),
  ('AR-S', 'Santa Fe'),
  ('AR-G', 'Santiago del Estero'),
  ('AR-V', 'Tierra del Fuego'),
  ('AR-T', 'Tucumán');

-- ---------------------------------------------------------------------------------------------
-- Emisor: cada CUIT con el que una empresa factura
-- ---------------------------------------------------------------------------------------------
CREATE TABLE emisor (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  es_principal   boolean NOT NULL,
  activo         boolean NOT NULL DEFAULT true,
  cuit           text,  -- NULL en el principal: su CUIT es empresa.cuit
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  -- Para las claves foráneas compuestas de las tablas hijas (y de las futuras: depósito, producto,
  -- línea de venta, cuenta de cobro y comprobante).
  CONSTRAINT emisor_id_empresa_uk UNIQUE (id, empresa_id),
  -- Principal <=> sin CUIT propio; el secundario trae uno válido.
  CONSTRAINT emisor_cuit_ck CHECK (es_principal = (cuit IS NULL) AND (cuit IS NULL OR cuit_valido(cuit))),
  CONSTRAINT emisor_principal_activo_ck CHECK (NOT es_principal OR activo)
);
-- Un solo principal por empresa.
CREATE UNIQUE INDEX emisor_principal_uk ON emisor (empresa_id) WHERE es_principal;
-- Única GLOBAL a propósito (E1): excepción explícita del meta-test «toda única incluye empresa_id».
CREATE UNIQUE INDEX emisor_cuit_uk ON emisor (cuit) WHERE cuit IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- Domicilio: estructurado, de solo inserción (cambiar un domicilio es crear otro)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE domicilio (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES empresa (id),
  calle        text NOT NULL
               CONSTRAINT domicilio_calle_ck CHECK (
                 calle !~ '^\s|\s$' AND calle !~ '[\x01-\x1F\x7F-\x9F]' AND char_length(calle) BETWEEN 1 AND 100
               ),
  numero       text NOT NULL CONSTRAINT domicilio_numero_ck CHECK (numero ~ '^[0-9]{1,6}$' OR numero = 'S/N'),
  piso         text CONSTRAINT domicilio_piso_ck CHECK (
                 piso IS NULL OR (piso !~ '^\s|\s$' AND piso !~ '[\x01-\x1F\x7F-\x9F]' AND char_length(piso) BETWEEN 1 AND 20)
               ),
  departamento text CONSTRAINT domicilio_departamento_ck CHECK (
                 departamento IS NULL OR (departamento !~ '^\s|\s$' AND departamento !~ '[\x01-\x1F\x7F-\x9F]'
                                          AND char_length(departamento) BETWEEN 1 AND 20)
               ),
  localidad    text NOT NULL
               CONSTRAINT domicilio_localidad_ck CHECK (
                 localidad !~ '^\s|\s$' AND localidad !~ '[\x01-\x1F\x7F-\x9F]' AND char_length(localidad) BETWEEN 1 AND 100
               ),
  provincia    text NOT NULL CONSTRAINT domicilio_provincia_fkey REFERENCES provincia (codigo),
  codigo_postal text CONSTRAINT domicilio_codigo_postal_ck CHECK (codigo_postal IS NULL OR codigo_postal ~ '^[A-Z0-9]{4,8}$'),
  creado_en    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domicilio_id_empresa_uk UNIQUE (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- Datos fiscales de cada emisor, versionados con vigencia
-- ---------------------------------------------------------------------------------------------
CREATE TABLE datos_fiscales (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- la aplicación puede mandarlo: idempotencia del borrador
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  emisor_id           uuid NOT NULL,
  estado              text NOT NULL DEFAULT 'BORRADOR'
                      CONSTRAINT datos_fiscales_estado_ck CHECK (estado IN ('BORRADOR', 'CONFIRMADA')),
  numero              integer,
  razon_social        text CONSTRAINT datos_fiscales_razon_social_ck CHECK (
                        razon_social IS NULL OR (razon_social !~ '^\s|\s$' AND razon_social !~ '[\x01-\x1F\x7F-\x9F]'
                                                 AND char_length(razon_social) BETWEEN 1 AND 200)
                      ),
  condicion_iva       text,
  domicilio_fiscal_id uuid,
  inicio_actividades  date CONSTRAINT datos_fiscales_inicio_actividades_ck CHECK (inicio_actividades >= DATE '0001-01-01'),
  iibb_numero         text CONSTRAINT datos_fiscales_iibb_numero_ck CHECK (
                        iibb_numero IS NULL OR (iibb_numero !~ '^\s|\s$' AND iibb_numero !~ '[\x01-\x1F\x7F-\x9F]'
                                                AND char_length(iibb_numero) BETWEEN 1 AND 30)
                      ),
  iibb_condicion      text,
  vigente_desde       timestamptz,
  confirmada_en       timestamptz,
  confirmada_por      uuid REFERENCES persona (id),
  motivo              text CONSTRAINT datos_fiscales_motivo_ck CHECK (
                        motivo IS NULL OR (motivo !~ '^\s|\s$' AND motivo !~ '[\x01-\x1F\x7F-\x9F]' AND char_length(motivo) > 0)
                      ),
  creado_por          uuid NOT NULL REFERENCES persona (id),
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT datos_fiscales_emisor_fkey FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor (id, empresa_id),
  CONSTRAINT datos_fiscales_domicilio_fkey FOREIGN KEY (domicilio_fiscal_id, empresa_id)
    REFERENCES domicilio (id, empresa_id),
  CONSTRAINT datos_fiscales_numero_uk UNIQUE (empresa_id, emisor_id, numero),
  -- Valores NO VERIFICADOS contra ARCA (supuesto del diseño; los repite el dominio).
  CONSTRAINT datos_fiscales_condicion_iva_ck CHECK (condicion_iva IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO')),
  CONSTRAINT datos_fiscales_iibb_condicion_ck CHECK (iibb_condicion IN ('LOCAL', 'CONVENIO_MULTILATERAL', 'EXENTO')),
  -- Confirmada <=> con número. La confirmada trae todo lo obligatorio y la vigencia no es retroactiva;
  -- el borrador no trae nada de la confirmación. Cada columna se pregunta con IS NOT NULL: una
  -- comparación con NULL no es falsa y el CHECK la dejaría pasar.
  CONSTRAINT datos_fiscales_confirmada_ck CHECK (
    (estado = 'CONFIRMADA') = (numero IS NOT NULL)
    AND (estado = 'BORRADOR' OR (
      numero > 0 AND razon_social IS NOT NULL AND condicion_iva IS NOT NULL AND domicilio_fiscal_id IS NOT NULL
      AND inicio_actividades IS NOT NULL AND vigente_desde IS NOT NULL AND confirmada_en IS NOT NULL
      AND vigente_desde >= confirmada_en AND confirmada_por IS NOT NULL AND motivo IS NOT NULL
    ))
    AND (estado = 'CONFIRMADA' OR (
      vigente_desde IS NULL AND confirmada_en IS NULL AND confirmada_por IS NULL AND motivo IS NULL
    ))
  )
);
-- Un solo borrador por emisor.
CREATE UNIQUE INDEX datos_fiscales_borrador_uk ON datos_fiscales (empresa_id, emisor_id) WHERE estado = 'BORRADOR';

-- ---------------------------------------------------------------------------------------------
-- Regla del emisor (por empresa), versionada igual que los datos fiscales
-- ---------------------------------------------------------------------------------------------
CREATE TABLE regla_emisor (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                uuid NOT NULL REFERENCES empresa (id),
  estado                    text NOT NULL DEFAULT 'BORRADOR'
                            CONSTRAINT regla_emisor_estado_ck CHECK (estado IN ('BORRADOR', 'CONFIRMADA')),
  numero                    integer,
  permitir_eleccion_manual  boolean NOT NULL DEFAULT true,
  vigente_desde             timestamptz,
  confirmada_en             timestamptz,
  confirmada_por            uuid REFERENCES persona (id),
  motivo                    text CONSTRAINT regla_emisor_motivo_ck CHECK (
                              motivo IS NULL OR (motivo !~ '^\s|\s$' AND motivo !~ '[\x01-\x1F\x7F-\x9F]' AND char_length(motivo) > 0)
                            ),
  creado_por                uuid NOT NULL REFERENCES persona (id),
  creado_en                 timestamptz NOT NULL DEFAULT now(),
  actualizado_en            timestamptz NOT NULL DEFAULT now(),
  version                   integer NOT NULL DEFAULT 1,
  CONSTRAINT regla_emisor_numero_uk UNIQUE (empresa_id, numero),
  CONSTRAINT regla_emisor_confirmada_ck CHECK (
    (estado = 'CONFIRMADA') = (numero IS NOT NULL)
    AND (estado = 'BORRADOR' OR (
      numero > 0 AND vigente_desde IS NOT NULL AND confirmada_en IS NOT NULL
      AND vigente_desde >= confirmada_en AND confirmada_por IS NOT NULL AND motivo IS NOT NULL
    ))
    AND (estado = 'CONFIRMADA' OR (
      vigente_desde IS NULL AND confirmada_en IS NULL AND confirmada_por IS NULL AND motivo IS NULL
    ))
  )
);
CREATE UNIQUE INDEX regla_emisor_borrador_uk ON regla_emisor (empresa_id) WHERE estado = 'BORRADOR';

-- ---------------------------------------------------------------------------------------------
-- Punto de venta: de un emisor y de una sucursal de la misma empresa
-- ---------------------------------------------------------------------------------------------
CREATE TABLE punto_de_venta (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES empresa (id),
  emisor_id         uuid NOT NULL,
  sucursal_id       uuid NOT NULL,
  domicilio_id      uuid,
  numero            integer NOT NULL CONSTRAINT punto_de_venta_numero_ck CHECK (numero BETWEEN 1 AND 99999),  -- rango NO VERIFICADO
  estado            text NOT NULL DEFAULT 'INACTIVO'
                    CONSTRAINT punto_de_venta_estado_ck CHECK (estado IN ('INACTIVO', 'ACTIVO')),
  verificacion_arca text NOT NULL DEFAULT 'NO_VERIFICADO'
                    CONSTRAINT punto_de_venta_verificacion_ck CHECK (verificacion_arca IN ('NO_VERIFICADO')),
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT punto_de_venta_emisor_fkey FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor (id, empresa_id),
  CONSTRAINT punto_de_venta_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT punto_de_venta_domicilio_fkey FOREIGN KEY (domicilio_id, empresa_id) REFERENCES domicilio (id, empresa_id),
  -- Dos CUIT pueden tener cada uno su punto de venta 1: la unicidad es por emisor.
  CONSTRAINT punto_de_venta_numero_uk UNIQUE (empresa_id, emisor_id, numero),
  -- Para que la serie ate emisor y punto de venta con una sola clave foránea compuesta.
  CONSTRAINT punto_de_venta_serie_uk UNIQUE (id, emisor_id, empresa_id),
  CONSTRAINT punto_de_venta_domicilio_ck CHECK (estado <> 'ACTIVO' OR domicilio_id IS NOT NULL)
);
CREATE INDEX punto_de_venta_sucursal_ix ON punto_de_venta (empresa_id, sucursal_id);

-- ---------------------------------------------------------------------------------------------
-- Serie de comprobantes: una fila por (punto de venta, tipo), con su numeración sin huecos
-- ---------------------------------------------------------------------------------------------
CREATE TABLE serie_comprobante (
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  punto_de_venta_id  uuid NOT NULL,
  emisor_id          uuid NOT NULL,
  -- Los nueve tipos del dominio (`TIPOS_DE_COMPROBANTE`); los códigos de ARCA son NO VERIFICADOS.
  tipo_comprobante   text NOT NULL CONSTRAINT serie_tipo_ck CHECK (tipo_comprobante IN (
                       'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'NOTA_DEBITO_A', 'NOTA_DEBITO_B', 'NOTA_DEBITO_C',
                       'NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C')),
  ultimo_numero      bigint NOT NULL CONSTRAINT serie_ultimo_ck CHECK (ultimo_numero >= 0),
  estado             text NOT NULL DEFAULT 'LIBRE'
                     CONSTRAINT serie_estado_ck CHECK (estado IN ('LIBRE', 'EN_CURSO', 'BLOQUEADA')),
  numero_en_curso    bigint,
  solicitud_en_curso uuid,
  en_curso_hasta     timestamptz,
  motivo_bloqueo     text,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT serie_pkey PRIMARY KEY (empresa_id, punto_de_venta_id, tipo_comprobante),
  -- Una serie no mezcla emisor y punto de venta.
  CONSTRAINT serie_punto_de_venta_fkey FOREIGN KEY (punto_de_venta_id, emisor_id, empresa_id)
    REFERENCES punto_de_venta (id, emisor_id, empresa_id),
  -- EN_CURSO <=> hay número reservado, y es exactamente el siguiente, con su solicitud y su plazo.
  -- Fuera de EN_CURSO no queda ni solicitud ni plazo.
  CONSTRAINT serie_en_curso_ck CHECK (
    (estado = 'EN_CURSO') = (numero_en_curso IS NOT NULL)
    AND (numero_en_curso IS NULL OR (
      numero_en_curso = ultimo_numero + 1 AND solicitud_en_curso IS NOT NULL AND en_curso_hasta IS NOT NULL
    ))
    AND (numero_en_curso IS NOT NULL OR (solicitud_en_curso IS NULL AND en_curso_hasta IS NULL))
  ),
  -- BLOQUEADA <=> con motivo (y un motivo no es solo blancos).
  CONSTRAINT serie_bloqueo_ck CHECK (
    (estado = 'BLOQUEADA') = (motivo_bloqueo IS NOT NULL)
    AND (motivo_bloqueo IS NULL OR btrim(motivo_bloqueo) <> '')
  )
);
CREATE INDEX serie_comprobante_emisor_ix ON serie_comprobante (empresa_id, emisor_id);

-- ---------------------------------------------------------------------------------------------
-- Relleno: toda empresa existente (también las canceladas) recibe su emisor principal. No modifica
-- ninguna fila existente. El bloqueo frena altas de empresas a mitad de camino: una empresa que
-- entrara entre el relleno y el disparador de más abajo se quedaría sin principal.
-- ---------------------------------------------------------------------------------------------
LOCK TABLE empresa IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO emisor (empresa_id, es_principal) SELECT id, true FROM empresa;

DO $$
DECLARE
  v_sin_principal integer;
BEGIN
  SELECT count(*) INTO v_sin_principal
    FROM public.empresa e
   WHERE NOT EXISTS (SELECT 1 FROM public.emisor x WHERE x.empresa_id = e.id AND x.es_principal);
  IF v_sin_principal > 0 THEN
    RAISE EXCEPTION 'el relleno dejó % empresas sin emisor principal', v_sin_principal
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Funciones y disparadores
-- ---------------------------------------------------------------------------------------------

-- Una empresa nueva recibe su emisor principal, con los permisos de quien da el alta (la plataforma):
-- por eso ella tiene INSERT (empresa_id, es_principal) sobre `emisor`.
CREATE FUNCTION empresa_crear_emisor_principal() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  INSERT INTO public.emisor (empresa_id, es_principal) VALUES (NEW.id, true);
  RETURN NULL;
END
$$;

-- El CUIT de una empresa: no puede ser el de un emisor secundario, y el del principal no cambia una
-- vez usado el primer número. El bloqueo por CUIT serializa las altas simultáneas con el mismo CUIT
-- (E2); el del emisor, el cambio contra una reserva en vuelo (E3). Siempre en ese orden: CUIT y
-- después emisor.
CREATE FUNCTION empresa_validar_cuit_fiscal() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_principal uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cuit IS NOT DISTINCT FROM OLD.cuit THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('zuluhub.fiscal.cuit:' || coalesce(NEW.cuit, ''), 0));
  IF EXISTS (SELECT 1 FROM public.emisor x WHERE x.cuit = NEW.cuit) THEN
    RAISE EXCEPTION 'el CUIT ya es el de un emisor secundario'
      USING ERRCODE = '23514', CONSTRAINT = 'empresa_cuit_es_emisor';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT x.id INTO v_principal
      FROM public.emisor x WHERE x.empresa_id = OLD.id AND x.es_principal;
    IF FOUND THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('zuluhub.fiscal.emisor:' || v_principal::text, 0));
      IF EXISTS (
        SELECT 1 FROM public.serie_comprobante s
         WHERE s.empresa_id = OLD.id AND s.emisor_id = v_principal
           AND (s.ultimo_numero > 0 OR s.estado <> 'LIBRE')
      ) THEN
        RAISE EXCEPTION 'el CUIT de la empresa no cambia una vez usado el primer número de comprobante'
          USING ERRCODE = '23514', CONSTRAINT = 'empresa_cuit_inmutable';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION emisor_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.es_principal IS DISTINCT FROM OLD.es_principal
       OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
    THEN
      RAISE EXCEPTION 'la empresa y el carácter de principal de un emisor no se pueden cambiar'
        USING ERRCODE = '23514', CONSTRAINT = 'emisor_inmutable';
    END IF;
  END IF;

  -- CUIT propio (secundario) al crearlo o al corregirlo.
  IF NOT NEW.es_principal AND (TG_OP = 'INSERT' OR NEW.cuit IS DISTINCT FROM OLD.cuit) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('zuluhub.fiscal.cuit:' || coalesce(NEW.cuit, ''), 0));
    IF TG_OP = 'INSERT' THEN
      SELECT e.estado INTO v_estado FROM public.empresa e WHERE e.id = NEW.empresa_id;
      -- Una empresa inexistente la rechaza la clave foránea (emisor_empresa_id_fkey), no esta función.
      IF FOUND AND v_estado NOT IN ('ACTIVE', 'SUSPENDED') THEN
        RAISE EXCEPTION 'un emisor secundario solo se crea en una empresa activa o suspendida'
          USING ERRCODE = '23514', CONSTRAINT = 'emisor_empresa_no_operable';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.empresa e WHERE e.cuit = NEW.cuit AND e.estado <> 'CANCELLED') THEN
      RAISE EXCEPTION 'el CUIT ya es el de una empresa'
        USING ERRCODE = '23514', CONSTRAINT = 'emisor_cuit_es_empresa';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.cuit IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('zuluhub.fiscal.emisor:' || OLD.id::text, 0));
      IF EXISTS (
        SELECT 1 FROM public.serie_comprobante s
         WHERE s.empresa_id = OLD.empresa_id AND s.emisor_id = OLD.id
           AND (s.ultimo_numero > 0 OR s.estado <> 'LIBRE')
      ) THEN
        RAISE EXCEPTION 'el CUIT del emisor no cambia una vez usado el primer número de comprobante'
          USING ERRCODE = '23514', CONSTRAINT = 'emisor_cuit_inmutable';
      END IF;
    END IF;
  END IF;

  -- Desactivar un secundario: sin puntos de venta activos. (El principal nunca se desactiva: lo
  -- dice el CHECK `emisor_principal_activo_ck`.)
  IF TG_OP = 'UPDATE' AND NOT OLD.es_principal AND OLD.activo AND NOT NEW.activo THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('zuluhub.fiscal.emisor:' || OLD.id::text, 0));
    IF EXISTS (
      SELECT 1 FROM public.punto_de_venta p
       WHERE p.empresa_id = OLD.empresa_id AND p.emisor_id = OLD.id AND p.estado = 'ACTIVO'
    ) THEN
      RAISE EXCEPTION 'el emisor tiene puntos de venta activos'
        USING ERRCODE = '23514', CONSTRAINT = 'emisor_con_pv_activos';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION punto_de_venta_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_activo boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.emisor_id IS DISTINCT FROM OLD.emisor_id
       OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
    THEN
      RAISE EXCEPTION 'el emisor de un punto de venta no se puede cambiar'
        USING ERRCODE = '23514', CONSTRAINT = 'punto_de_venta_inmutable';
    END IF;

    -- Con números usados el punto de venta no cambia de número. Se bloquean con FOR SHARE todas sus
    -- series ANTES de mirarlas (E3): una reserva concurrente espera, o este cambio ve su reserva.
    IF NEW.numero IS DISTINCT FROM OLD.numero THEN
      PERFORM 1 FROM public.serie_comprobante s
       WHERE s.empresa_id = OLD.empresa_id AND s.punto_de_venta_id = OLD.id
         FOR SHARE;
      IF EXISTS (
        SELECT 1 FROM public.serie_comprobante s
         WHERE s.empresa_id = OLD.empresa_id AND s.punto_de_venta_id = OLD.id
           AND (s.ultimo_numero > 0 OR s.estado <> 'LIBRE')
      ) THEN
        RAISE EXCEPTION 'el punto de venta tiene números usados: su número no cambia'
          USING ERRCODE = '23514', CONSTRAINT = 'punto_de_venta_numero_inmutable';
      END IF;
    END IF;
  END IF;

  -- Activar exige un emisor activo. El bloqueo compartido del emisor lo cruza con su desactivación.
  IF NEW.estado = 'ACTIVO' AND (TG_OP = 'INSERT' OR OLD.estado <> 'ACTIVO') THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('zuluhub.fiscal.emisor:' || NEW.emisor_id::text, 0));
    SELECT x.activo INTO v_activo FROM public.emisor x WHERE x.id = NEW.emisor_id AND x.empresa_id = NEW.empresa_id;
    -- Un emisor inexistente lo rechaza la clave foránea (punto_de_venta_emisor_fkey).
    IF FOUND AND NOT v_activo THEN
      RAISE EXCEPTION 'el emisor está inactivo: no se puede activar un punto de venta'
        USING ERRCODE = '23514', CONSTRAINT = 'punto_de_venta_emisor_inactivo';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Versiones: BORRADOR -> CONFIRMADA, nunca al revés; la confirmada está congelada entera. El número
-- de la confirmación es el máximo + 1 de su emisor (E4).
CREATE FUNCTION datos_fiscales_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'los datos fiscales nacen en borrador'
      USING ERRCODE = '23514', CONSTRAINT = 'datos_fiscales_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION datos_fiscales_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_siguiente integer;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.emisor_id IS DISTINCT FROM OLD.emisor_id
     OR NEW.creado_por IS DISTINCT FROM OLD.creado_por
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'la identidad de unos datos fiscales no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'datos_fiscales_inmutable';
  END IF;

  IF OLD.estado = 'CONFIRMADA' THEN
    IF NEW.estado <> OLD.estado THEN
      RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
        USING ERRCODE = '23514', CONSTRAINT = 'datos_fiscales_transicion_invalida';
    END IF;
    RAISE EXCEPTION 'unos datos fiscales confirmados no se pueden modificar: se confirma una versión nueva'
      USING ERRCODE = '23514', CONSTRAINT = 'datos_fiscales_confirmada_inmutable';
  END IF;

  IF NEW.estado = 'CONFIRMADA' THEN
    SELECT coalesce(max(d.numero), 0) + 1 INTO v_siguiente
      FROM public.datos_fiscales d WHERE d.empresa_id = OLD.empresa_id AND d.emisor_id = OLD.emisor_id;
    IF NEW.numero IS DISTINCT FROM v_siguiente THEN
      RAISE EXCEPTION 'el número de la versión confirmada tiene que ser %', v_siguiente
        USING ERRCODE = '23514', CONSTRAINT = 'datos_fiscales_numero_invalido';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION regla_emisor_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'la regla del emisor nace en borrador'
      USING ERRCODE = '23514', CONSTRAINT = 'regla_emisor_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION regla_emisor_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_siguiente integer;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.creado_por IS DISTINCT FROM OLD.creado_por
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'la identidad de una regla del emisor no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'regla_emisor_inmutable';
  END IF;

  IF OLD.estado = 'CONFIRMADA' THEN
    IF NEW.estado <> OLD.estado THEN
      RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
        USING ERRCODE = '23514', CONSTRAINT = 'regla_emisor_transicion_invalida';
    END IF;
    RAISE EXCEPTION 'una regla del emisor confirmada no se puede modificar: se confirma una versión nueva'
      USING ERRCODE = '23514', CONSTRAINT = 'regla_emisor_confirmada_inmutable';
  END IF;

  IF NEW.estado = 'CONFIRMADA' THEN
    SELECT coalesce(max(r.numero), 0) + 1 INTO v_siguiente
      FROM public.regla_emisor r WHERE r.empresa_id = OLD.empresa_id;
    IF NEW.numero IS DISTINCT FROM v_siguiente THEN
      RAISE EXCEPTION 'el número de la versión confirmada tiene que ser %', v_siguiente
        USING ERRCODE = '23514', CONSTRAINT = 'regla_emisor_numero_invalido';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Serie: la misma tabla de transiciones que `transicionDeSerieValida` del dominio (E6). La reserva
-- (LIBRE -> EN_CURSO) toma el bloqueo compartido del emisor (E3).
CREATE FUNCTION serie_comprobante_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.punto_de_venta_id IS DISTINCT FROM OLD.punto_de_venta_id
     OR NEW.emisor_id IS DISTINCT FROM OLD.emisor_id
     OR NEW.tipo_comprobante IS DISTINCT FROM OLD.tipo_comprobante
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'la identidad de una serie no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'serie_inmutable';
  END IF;

  -- El último número nunca baja, y solo sube de a uno cerrando la EN_CURSO que lo reservó.
  IF NEW.ultimo_numero < OLD.ultimo_numero THEN
    RAISE EXCEPTION 'el último número de una serie no baja'
      USING ERRCODE = '23514', CONSTRAINT = 'serie_numero_invalido';
  ELSIF NEW.ultimo_numero > OLD.ultimo_numero
        AND NOT (OLD.estado = 'EN_CURSO' AND NEW.estado = 'LIBRE' AND NEW.ultimo_numero = OLD.numero_en_curso)
  THEN
    RAISE EXCEPTION 'el último número solo sube de a uno, al cerrar la reserva de ese número'
      USING ERRCODE = '23514', CONSTRAINT = 'serie_numero_invalido';
  END IF;

  IF NEW.estado <> OLD.estado THEN
    IF NOT (
      (OLD.estado = 'LIBRE' AND NEW.estado = 'EN_CURSO')
      OR (OLD.estado = 'EN_CURSO' AND NEW.estado IN ('LIBRE', 'BLOQUEADA'))
    ) THEN
      RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
        USING ERRCODE = '23514', CONSTRAINT = 'serie_transicion_invalida';
    END IF;
    IF OLD.estado = 'LIBRE' THEN
      PERFORM pg_advisory_xact_lock_shared(hashtextextended('zuluhub.fiscal.emisor:' || OLD.emisor_id::text, 0));
    END IF;
  ELSIF OLD.estado = 'EN_CURSO' THEN
    -- Una reserva incierta sigue EN_CURSO sin cambios.
    IF NEW.numero_en_curso IS DISTINCT FROM OLD.numero_en_curso
       OR NEW.solicitud_en_curso IS DISTINCT FROM OLD.solicitud_en_curso
       OR NEW.en_curso_hasta IS DISTINCT FROM OLD.en_curso_hasta
    THEN
      RAISE EXCEPTION 'una serie EN_CURSO no cambia su reserva'
        USING ERRCODE = '23514', CONSTRAINT = 'serie_transicion_invalida';
    END IF;
  ELSIF OLD.estado = 'BLOQUEADA' THEN
    IF NEW.motivo_bloqueo IS DISTINCT FROM OLD.motivo_bloqueo THEN
      RAISE EXCEPTION 'una serie BLOQUEADA no sale de ese estado ni cambia su motivo'
        USING ERRCODE = '23514', CONSTRAINT = 'serie_transicion_invalida';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Los nombres ordenan los disparadores: `_cambio` valida con OLD/NEW antes de que `_version` los toque.
CREATE TRIGGER empresa_crear_emisor_principal AFTER INSERT ON empresa
  FOR EACH ROW EXECUTE FUNCTION empresa_crear_emisor_principal();
CREATE TRIGGER empresa_validar_cuit_fiscal BEFORE INSERT OR UPDATE OF cuit ON empresa
  FOR EACH ROW EXECUTE FUNCTION empresa_validar_cuit_fiscal();

CREATE TRIGGER emisor_cambio BEFORE INSERT OR UPDATE ON emisor
  FOR EACH ROW EXECUTE FUNCTION emisor_validar_cambio();
CREATE TRIGGER emisor_version BEFORE UPDATE ON emisor
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

CREATE TRIGGER domicilio_solo_insercion BEFORE UPDATE OR DELETE ON domicilio
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER domicilio_sin_truncate BEFORE TRUNCATE ON domicilio
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

CREATE TRIGGER datos_fiscales_alta BEFORE INSERT ON datos_fiscales
  FOR EACH ROW EXECUTE FUNCTION datos_fiscales_validar_alta();
CREATE TRIGGER datos_fiscales_cambio BEFORE UPDATE ON datos_fiscales
  FOR EACH ROW EXECUTE FUNCTION datos_fiscales_validar_cambio();
CREATE TRIGGER datos_fiscales_version BEFORE UPDATE ON datos_fiscales
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

CREATE TRIGGER regla_emisor_alta BEFORE INSERT ON regla_emisor
  FOR EACH ROW EXECUTE FUNCTION regla_emisor_validar_alta();
CREATE TRIGGER regla_emisor_cambio BEFORE UPDATE ON regla_emisor
  FOR EACH ROW EXECUTE FUNCTION regla_emisor_validar_cambio();
CREATE TRIGGER regla_emisor_version BEFORE UPDATE ON regla_emisor
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

CREATE TRIGGER punto_de_venta_cambio BEFORE INSERT OR UPDATE ON punto_de_venta
  FOR EACH ROW EXECUTE FUNCTION punto_de_venta_validar_cambio();
CREATE TRIGGER punto_de_venta_version BEFORE UPDATE ON punto_de_venta
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

CREATE TRIGGER serie_comprobante_cambio BEFORE UPDATE ON serie_comprobante
  FOR EACH ROW EXECUTE FUNCTION serie_comprobante_validar_cambio();
CREATE TRIGGER serie_comprobante_version BEFORE UPDATE ON serie_comprobante
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE (E7)
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON provincia, emisor, domicilio, datos_fiscales, regla_emisor, punto_de_venta, serie_comprobante
  FROM PUBLIC;

-- app: opera dentro de su empresa
GRANT SELECT ON provincia, emisor, domicilio, datos_fiscales, regla_emisor, punto_de_venta, serie_comprobante
  TO zuluhub_app;
GRANT INSERT (id, empresa_id, calle, numero, piso, departamento, localidad, provincia, codigo_postal)
  ON domicilio TO zuluhub_app;
GRANT INSERT (id, empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id, inicio_actividades,
              iibb_numero, iibb_condicion, creado_por)
  ON datos_fiscales TO zuluhub_app;
GRANT UPDATE (razon_social, condicion_iva, domicilio_fiscal_id, inicio_actividades, iibb_numero, iibb_condicion,
              estado, numero, vigente_desde, confirmada_en, confirmada_por, motivo)
  ON datos_fiscales TO zuluhub_app;
GRANT INSERT (id, empresa_id, permitir_eleccion_manual, creado_por) ON regla_emisor TO zuluhub_app;
GRANT UPDATE (permitir_eleccion_manual, estado, numero, vigente_desde, confirmada_en, confirmada_por, motivo)
  ON regla_emisor TO zuluhub_app;
GRANT INSERT (id, empresa_id, emisor_id, sucursal_id, numero, domicilio_id) ON punto_de_venta TO zuluhub_app;
GRANT UPDATE (numero, sucursal_id, domicilio_id, estado) ON punto_de_venta TO zuluhub_app;
GRANT INSERT (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero)
  ON serie_comprobante TO zuluhub_app;
GRANT UPDATE (ultimo_numero, estado, numero_en_curso, solicitud_en_curso, en_curso_hasta, motivo_bloqueo)
  ON serie_comprobante TO zuluhub_app;

-- plataforma: crea y corrige emisores; ve las series (los disparadores de CUIT las leen) y, de los
-- puntos de venta, solo lo que el disparador de desactivación necesita. Nunca domicilios ni datos.
GRANT SELECT ON emisor, serie_comprobante TO zuluhub_plataforma;
GRANT SELECT (id, empresa_id, emisor_id, estado) ON punto_de_venta TO zuluhub_plataforma;
GRANT INSERT (empresa_id, es_principal, cuit) ON emisor TO zuluhub_plataforma;
GRANT UPDATE (cuit, activo) ON emisor TO zuluhub_plataforma;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada en toda tabla nueva; sin política no hay acceso
-- ---------------------------------------------------------------------------------------------
ALTER TABLE provincia ENABLE ROW LEVEL SECURITY;
ALTER TABLE provincia FORCE ROW LEVEL SECURITY;
ALTER TABLE emisor ENABLE ROW LEVEL SECURITY;
ALTER TABLE emisor FORCE ROW LEVEL SECURITY;
ALTER TABLE domicilio ENABLE ROW LEVEL SECURITY;
ALTER TABLE domicilio FORCE ROW LEVEL SECURITY;
ALTER TABLE datos_fiscales ENABLE ROW LEVEL SECURITY;
ALTER TABLE datos_fiscales FORCE ROW LEVEL SECURITY;
ALTER TABLE regla_emisor ENABLE ROW LEVEL SECURITY;
ALTER TABLE regla_emisor FORCE ROW LEVEL SECURITY;
ALTER TABLE punto_de_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE punto_de_venta FORCE ROW LEVEL SECURITY;
ALTER TABLE serie_comprobante ENABLE ROW LEVEL SECURITY;
ALTER TABLE serie_comprobante FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- Políticas. La aplicación siempre con `empresa_id = (SELECT app_empresa_id())` y, en altas y
-- cambios, `empresa_operable(empresa_id)`; los autores con `IS NOT DISTINCT FROM` la persona del
-- contexto. Sin `FOR ALL`: cada comando tiene su política.
-- ---------------------------------------------------------------------------------------------
CREATE POLICY provincia_app_leer ON provincia FOR SELECT TO zuluhub_app USING (true);

-- emisor: la empresa lo ve; solo la plataforma (y solo un ADMIN, por las restrictivas) lo escribe.
CREATE POLICY emisor_app_leer ON emisor FOR SELECT TO zuluhub_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY emisor_plataforma_leer ON emisor FOR SELECT TO zuluhub_plataforma USING (true);
CREATE POLICY emisor_plataforma_alta ON emisor FOR INSERT TO zuluhub_plataforma WITH CHECK (true);
CREATE POLICY emisor_plataforma_cambiar ON emisor FOR UPDATE TO zuluhub_plataforma USING (true) WITH CHECK (true);

CREATE POLICY domicilio_app_leer ON domicilio FOR SELECT TO zuluhub_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY domicilio_app_alta ON domicilio FOR INSERT TO zuluhub_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

-- datos_fiscales y regla_emisor: se edita solo el borrador; al confirmar, el autor es la persona del contexto.
CREATE POLICY datos_fiscales_app_leer ON datos_fiscales FOR SELECT TO zuluhub_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY datos_fiscales_app_alta ON datos_fiscales FOR INSERT TO zuluhub_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY datos_fiscales_app_cambiar ON datos_fiscales FOR UPDATE TO zuluhub_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND estado = 'BORRADOR')
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND (estado = 'BORRADOR' OR confirmada_por IS NOT DISTINCT FROM (SELECT app_persona_id()))
  );

CREATE POLICY regla_emisor_app_leer ON regla_emisor FOR SELECT TO zuluhub_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY regla_emisor_app_alta ON regla_emisor FOR INSERT TO zuluhub_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY regla_emisor_app_cambiar ON regla_emisor FOR UPDATE TO zuluhub_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND estado = 'BORRADOR')
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND (estado = 'BORRADOR' OR confirmada_por IS NOT DISTINCT FROM (SELECT app_persona_id()))
  );

CREATE POLICY punto_de_venta_app_leer ON punto_de_venta FOR SELECT TO zuluhub_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY punto_de_venta_app_alta ON punto_de_venta FOR INSERT TO zuluhub_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY punto_de_venta_app_cambiar ON punto_de_venta FOR UPDATE TO zuluhub_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
-- La plataforma ve los puntos de venta de todas las empresas, pero el GRANT por columna solo le
-- deja `id`, `empresa_id`, `emisor_id` y `estado`.
CREATE POLICY punto_de_venta_plataforma_leer ON punto_de_venta FOR SELECT TO zuluhub_plataforma USING (true);

CREATE POLICY serie_comprobante_app_leer ON serie_comprobante FOR SELECT TO zuluhub_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY serie_comprobante_app_alta ON serie_comprobante FOR INSERT TO zuluhub_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY serie_comprobante_app_cambiar ON serie_comprobante FOR UPDATE TO zuluhub_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY serie_comprobante_plataforma_leer ON serie_comprobante FOR SELECT TO zuluhub_plataforma USING (true);

-- Políticas RESTRICTIVAS de la plataforma (como las de 0004 y 0005): sin un actor vigente no ve
-- nada, y solo un ADMIN crea o corrige un emisor (un SOPORTE no toca los CUIT de una empresa).
CREATE POLICY emisor_plataforma_con_actor ON emisor AS RESTRICTIVE FOR SELECT TO zuluhub_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY punto_de_venta_plataforma_con_actor ON punto_de_venta AS RESTRICTIVE FOR SELECT
  TO zuluhub_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY serie_comprobante_plataforma_con_actor ON serie_comprobante AS RESTRICTIVE FOR SELECT
  TO zuluhub_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY emisor_plataforma_admin_alta ON emisor AS RESTRICTIVE FOR INSERT TO zuluhub_plataforma
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY emisor_plataforma_admin_cambiar ON emisor AS RESTRICTIVE FOR UPDATE TO zuluhub_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
