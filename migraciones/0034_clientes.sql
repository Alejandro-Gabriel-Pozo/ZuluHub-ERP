-- 0034_clientes: el directorio de clientes y proveedores (E9 tramo 3): la «parte» de cada empresa (persona o empresa con la que el negocio tiene
-- relación), sus roles (CUSTOMER y PROVEEDOR, varios a la vez) y los vínculos entre partes (contacto y agente de una empresa), más los dos
-- vocabularios sembrados que los describen. Compras (0037) apunta con clave foránea compuesta a `parte`; nunca al revés.
-- Especificación: Pedernal-docs/11-especificaciones/e9-compras-especificacion.md (§3.1, §4 y §5) y el DDL verificado de `clientes.md` (Anexo C),
-- adoptado tal cual salvo lo que E9 §3.1 cambia: pasaporte de 6 a 9 caracteres (decisión del dueño del 06/11/2026, como 0024), teléfono con la regla
-- de la primitiva `telefono.ts` (la misma de `sucursal_telefono_ck`, 0019), y el estado `ANONIMIZADA` con su disparador pero sin caso de uso (S-3).
--
-- Reglas de esta migración (las mismas de 0001 a 0031):
--  * Es ADITIVA: crea objetos nuevos y siembra dos vocabularios. No toca ninguna tabla existente. Se comprueba al empezar y se frena con un error
--    claro si alguna de estas tablas ya existe.
--  * No agrega NINGUNA función SECURITY DEFINER; toda función fija `search_path = pg_catalog, public, pg_temp`. Ninguna se otorga a la aplicación.
--  * Nadie recibe DELETE ni TRUNCATE (nada se borra: una parte se desactiva). INSERT y UPDATE por columna. RLS activa y FORZADA en toda tabla
--    nueva, una política por comando. Los demás roles no reciben nada de los datos personales.
--  * Toda única de una tabla con `empresa_id` lo incluye y toda clave foránea entre tablas de empresa es COMPUESTA `(x_id, empresa_id)`.
--  * Un documento, una parte por empresa, también entre las desactivadas (`parte_documento_uk`): se reactiva, no se duplica.
--  * Su reversión es un script aparte, revisado y DESTRUCTIVO si hay datos: `migraciones/reversiones/0034_revertir_clientes.sql`.
--  * DEPENDE de 0001 (empresa, persona, `app_empresa_id`, `app_persona_id`, `empresa_operable`, `cuit_valido`, `fijar_version_y_fecha`,
--    `solo_insercion`), de 0006 (provincia), de 0007 (`sin_borrado`) y de 0009 (`texto_fiscal_valido`); se comprueba al empezar.

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.empresa') IS NULL OR to_regclass('public.persona') IS NULL
     OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL OR to_regprocedure('public.solo_insercion()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL OR to_regprocedure('public.app_persona_id()') IS NULL
     OR to_regprocedure('public.app_empresa_id()') IS NULL OR to_regprocedure('public.cuit_valido(text)') IS NULL THEN
    RAISE EXCEPTION 'clientes requiere 0001 (empresa, persona, funciones de contexto, de solo inserción y cuit_valido) aplicada antes'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.provincia') IS NULL OR to_regprocedure('public.sin_borrado()') IS NULL THEN
    RAISE EXCEPTION 'clientes requiere 0006_fiscal y 0007_marcas_y_planes aplicadas antes (faltan provincia o sin_borrado())'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.texto_fiscal_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'clientes requiere 0009_facturacion aplicada antes (falta texto_fiscal_valido)'
      USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['rol_de_parte', 'tipo_de_vinculo', 'parte', 'parte_rol', 'parte_vinculo'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'clientes: la tabla % ya existe; esta migración solo crea objetos nuevos', v_tabla
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- ================================================================================================
-- Vocabularios globales (datos sembrados por la migración, solo lectura para la app, solo inserción para todos)
-- ================================================================================================

-- Qué es una parte para el negocio. EMPLEADO queda fuera de v1 (decisión F6): entra con un INSERT en una extensión, sin tocar `parte_rol`.
CREATE TABLE rol_de_parte (
  codigo      text PRIMARY KEY CONSTRAINT rol_de_parte_codigo_ck CHECK (codigo ~ '^[A-Z][A-Z_]{1,29}$'),
  descripcion text NOT NULL CONSTRAINT rol_de_parte_descripcion_ck CHECK (texto_fiscal_valido(descripcion, 100))
);
INSERT INTO rol_de_parte (codigo, descripcion) VALUES
  ('CUSTOMER', 'A quien el negocio le vende o presta servicios'),
  ('PROVEEDOR', 'Quien le vende al negocio');

-- Qué relación hay entre dos partes. Dos banderas dicen qué naturaleza exige cada punta; un tipo nuevo es una fila, no un CHECK.
CREATE TABLE tipo_de_vinculo (
  codigo            text PRIMARY KEY CONSTRAINT tipo_de_vinculo_codigo_ck CHECK (codigo ~ '^[A-Z][A-Z_]{1,29}$'),
  descripcion       text NOT NULL CONSTRAINT tipo_de_vinculo_descripcion_ck CHECK (texto_fiscal_valido(descripcion, 200)),
  contacto_humana   boolean NOT NULL,   -- la parte que es contacto o agente tiene que ser HUMANA
  de_parte_juridica boolean NOT NULL    -- la parte de la que es contacto o agente tiene que ser JURIDICA
);
INSERT INTO tipo_de_vinculo (codigo, descripcion, contacto_humana, de_parte_juridica) VALUES
  ('CONTACTO', 'Alguien con quien se habla de la otra parte', true, false),
  ('AGENTE_DE', 'Persona que consume por cuenta de una empresa y cuya cuenta paga la empresa', true, true);

-- ================================================================================================
-- parte: el directorio de cada empresa (personas y empresas con las que el negocio tiene relación)
-- ================================================================================================
CREATE TABLE parte (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  idempotencia_alta  uuid NOT NULL,                 -- la manda la pantalla; única por empresa (sin oráculo de existencia entre empresas)
  naturaleza         text NOT NULL CONSTRAINT parte_naturaleza_ck CHECK (naturaleza IN ('HUMANA', 'JURIDICA')),
  nombre             text CONSTRAINT parte_nombre_ck CHECK (nombre IS NULL OR texto_fiscal_valido(nombre, 200)),  -- razón social si es jurídica; NULL solo si está anonimizada
  apellido           text CONSTRAINT parte_apellido_ck CHECK (apellido IS NULL OR (naturaleza = 'HUMANA' AND texto_fiscal_valido(apellido, 100))),
  alias              text CONSTRAINT parte_alias_ck CHECK (alias IS NULL OR texto_fiscal_valido(alias, 100)),
  documento_tipo     text CONSTRAINT parte_documento_tipo_ck
                     CHECK (documento_tipo IN ('CUIT', 'CUIL', 'CDI', 'DNI', 'PASAPORTE', 'ID_EXTRANJERO')),
  documento_pais     char(2),
  documento_numero   text,
  condicion_iva      text CONSTRAINT parte_condicion_iva_ck CHECK (condicion_iva IN (
                       'RESPONSABLE_INSCRIPTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'MONOTRIBUTO', 'NO_CATEGORIZADO',
                       'PROVEEDOR_DEL_EXTERIOR', 'CLIENTE_DEL_EXTERIOR', 'IVA_LIBERADO_LEY_19640',
                       'MONOTRIBUTISTA_SOCIAL', 'IVA_NO_ALCANZADO', 'MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO')),  -- las once de WSFE v4.8 (0009)
  email              text CONSTRAINT parte_email_ck CHECK (email IS NULL OR (email = lower(btrim(email)) AND email LIKE '%_@_%'
                       AND email !~ '\s' AND char_length(email) <= 254)),
  telefono           text CONSTRAINT parte_telefono_ck CHECK (telefono IS NULL OR (telefono = btrim(telefono)
                       AND char_length(telefono) BETWEEN 1 AND 40 AND telefono !~ '[\x01-\x1F\x7F-\x9F]')),
  dom_pais           char(2),
  dom_calle text, dom_numero text, dom_piso text, dom_departamento text,
  dom_localidad text,
  dom_provincia      text CONSTRAINT parte_dom_provincia_fkey REFERENCES provincia (codigo),
  dom_codigo_postal  text,
  dom_texto          text,                          -- domicilio extranjero, texto libre
  nota               text CONSTRAINT parte_nota_ck CHECK (nota IS NULL OR (nota <> '' AND char_length(nota) <= 2000)),
  estado             text NOT NULL DEFAULT 'ACTIVA' CONSTRAINT parte_estado_ck CHECK (estado IN ('ACTIVA', 'INACTIVA', 'ANONIMIZADA')),
  anonimizada_en     timestamptz,                   -- la fija la base al pasar a ANONIMIZADA
  es_atajo           boolean NOT NULL DEFAULT false, -- alta rápida: los pasos de identificación quedaron vacíos y explícitos (dos ejes, 2026-10-23)
  creado_por         uuid REFERENCES persona (id),
  -- Columnas de búsqueda: las calcula la base (el código no las puede falsear). translate() antes de lower() para no depender del locale
  -- (con locale C, lower() no toca las letras con acento). Sin concat_ws (no es inmutable): los blancos de más no se generan.
  nombre_busqueda    text GENERATED ALWAYS AS (lower(translate(
                       coalesce(apellido || ' ', '') || coalesce(nombre, '') || coalesce(' ' || alias, ''),
                       'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
                       'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc'))) STORED,
  documento_normalizado text GENERATED ALWAYS AS (CASE
                       WHEN documento_tipo IN ('CUIT', 'CUIL', 'CDI') THEN 'T' || documento_numero
                       WHEN documento_tipo = 'DNI' THEN 'D' || documento_numero
                       WHEN documento_tipo IN ('PASAPORTE', 'ID_EXTRANJERO')
                         THEN left(documento_tipo, 1) || documento_pais || ':' || documento_numero
                     END) STORED,
  telefono_digitos   text GENERATED ALWAYS AS (regexp_replace(telefono, '[^0-9]', '', 'g')) STORED,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT parte_pkey PRIMARY KEY (id),
  CONSTRAINT parte_id_empresa_uk UNIQUE (id, empresa_id),               -- ancla de las FK compuestas de los módulos de arriba (compras)
  CONSTRAINT parte_idempotencia_uk UNIQUE (empresa_id, idempotencia_alta),
  CONSTRAINT parte_nombre_anonimizada_ck CHECK ((estado = 'ANONIMIZADA') = (nombre IS NULL)),
  -- Todo CHECK compuesto va envuelto en coalesce(..., false): un NULL en una rama haría pasar la fila (una comparación con NULL no falla).
  CONSTRAINT parte_documento_ck CHECK (coalesce(
    (documento_tipo IS NULL AND documento_numero IS NULL AND documento_pais IS NULL)
    OR (documento_tipo IN ('CUIT', 'CUIL', 'CDI') AND cuit_valido(documento_numero) AND documento_pais IS NULL)
    OR (documento_tipo = 'DNI' AND documento_numero ~ '^[1-9][0-9]{5,8}$' AND documento_pais IS NULL)
    OR (documento_tipo IN ('PASAPORTE', 'ID_EXTRANJERO') AND documento_pais ~ '^[A-Z]{2}$'
        AND ((documento_tipo = 'PASAPORTE' AND documento_numero ~ '^[A-Z0-9]{6,9}$')
          OR (documento_tipo = 'ID_EXTRANJERO' AND documento_numero ~ '^[A-Z0-9]{3,20}$'))), false)),
  CONSTRAINT parte_naturaleza_documento_ck CHECK (
    naturaleza = 'HUMANA' OR documento_tipo IS NULL OR documento_tipo IN ('CUIT', 'ID_EXTRANJERO')),
  CONSTRAINT parte_domicilio_ck CHECK (coalesce(
    (dom_pais IS NULL AND num_nonnulls(dom_calle, dom_numero, dom_piso, dom_departamento, dom_localidad,
       dom_provincia, dom_codigo_postal, dom_texto) = 0)
    OR (dom_pais = 'AR' AND dom_texto IS NULL AND texto_fiscal_valido(dom_calle, 100)
        AND (dom_numero ~ '^[0-9]{1,6}$' OR dom_numero = 'S/N')
        AND (dom_piso IS NULL OR texto_fiscal_valido(dom_piso, 20))
        AND (dom_departamento IS NULL OR texto_fiscal_valido(dom_departamento, 20))
        AND texto_fiscal_valido(dom_localidad, 100) AND dom_provincia IS NOT NULL
        AND (dom_codigo_postal IS NULL OR dom_codigo_postal ~ '^[A-Z0-9]{4,8}$'))      -- las mismas reglas que `domicilio` de 0006
    OR (dom_pais <> 'AR' AND dom_pais ~ '^[A-Z]{2}$' AND texto_fiscal_valido(dom_texto, 300)
        AND num_nonnulls(dom_calle, dom_numero, dom_piso, dom_departamento, dom_localidad,
          dom_provincia, dom_codigo_postal) = 0), false)),
  CONSTRAINT parte_anonimizada_ck CHECK ((estado = 'ANONIMIZADA') = (anonimizada_en IS NOT NULL)
    AND (estado <> 'ANONIMIZADA' OR num_nonnulls(apellido, alias, documento_tipo, documento_pais, documento_numero,
      condicion_iva, email, telefono, dom_pais, dom_calle, dom_numero, dom_piso, dom_departamento,
      dom_localidad, dom_provincia, dom_codigo_postal, dom_texto, nota) = 0))
);
-- Invariante: un documento, una parte por empresa. Las inactivas lo conservan (se reactivan, no se duplican); al anonimizar, queda libre.
CREATE UNIQUE INDEX parte_documento_uk ON parte (empresa_id, documento_normalizado)
  WHERE documento_normalizado IS NOT NULL;
CREATE INDEX parte_nombre_ix ON parte (empresa_id, nombre_busqueda text_pattern_ops, id) WHERE estado <> 'ANONIMIZADA';
-- text_pattern_ops: el prefijo (LIKE 'ana%') usa el índice aunque la base no tenga collation C (en Neon: NO VERIFICADO); la igualdad también.
CREATE INDEX parte_email_ix ON parte (empresa_id, email text_pattern_ops) WHERE email IS NOT NULL;
CREATE INDEX parte_telefono_ix ON parte (empresa_id, telefono_digitos) WHERE telefono_digitos IS NOT NULL;
-- «Fichas por completar»: las que se dieron de alta sin documento (el paso de identificación quedó vacío y explícito).
CREATE INDEX parte_sin_documento_ix ON parte (empresa_id, creado_en, id) WHERE documento_tipo IS NULL AND estado <> 'ANONIMIZADA';

-- ================================================================================================
-- parte_rol: qué es cada parte para el negocio (varios a la vez; se apagan, no se borran)
-- ================================================================================================
CREATE TABLE parte_rol (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  parte_id       uuid NOT NULL,
  rol            text NOT NULL CONSTRAINT parte_rol_rol_fkey REFERENCES rol_de_parte (codigo),
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT parte_rol_pkey PRIMARY KEY (empresa_id, parte_id, rol),
  CONSTRAINT parte_rol_parte_fkey FOREIGN KEY (parte_id, empresa_id) REFERENCES parte (id, empresa_id)
);
CREATE INDEX parte_rol_ix ON parte_rol (empresa_id, rol, parte_id) WHERE activo;

-- ================================================================================================
-- parte_vinculo: «X es contacto (o agente) de Y», entre dos partes de la misma empresa
-- ================================================================================================
CREATE TABLE parte_vinculo (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  parte_id       uuid NOT NULL,                    -- el contacto o el agente
  de_parte_id    uuid NOT NULL,                    -- de quién es contacto o agente
  tipo           text NOT NULL CONSTRAINT parte_vinculo_tipo_fkey REFERENCES tipo_de_vinculo (codigo),
  cargo          text CONSTRAINT parte_vinculo_cargo_ck CHECK (cargo IS NULL OR texto_fiscal_valido(cargo, 100)),
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT parte_vinculo_pkey PRIMARY KEY (empresa_id, parte_id, de_parte_id, tipo),
  CONSTRAINT parte_vinculo_parte_fkey FOREIGN KEY (parte_id, empresa_id) REFERENCES parte (id, empresa_id),
  CONSTRAINT parte_vinculo_de_parte_fkey FOREIGN KEY (de_parte_id, empresa_id) REFERENCES parte (id, empresa_id),
  CONSTRAINT parte_vinculo_distintas_ck CHECK (parte_id <> de_parte_id)
);
CREATE INDEX parte_vinculo_de_ix ON parte_vinculo (empresa_id, de_parte_id) WHERE activo;
CREATE INDEX parte_vinculo_parte_ix ON parte_vinculo (empresa_id, parte_id) WHERE activo;

-- ================================================================================================
-- Disparadores: invariantes que la base impone aunque el código se olvide (plpgsql sin SECURITY DEFINER, search_path fijo,
-- ERRCODE 23514 con CONSTRAINT propio, traducidos a los errores de dominio). El nombre ordena `_validar` antes de `_version`.
-- ================================================================================================

-- La identidad no cambia; el estado sigue la tabla de transiciones (la misma que TRANSICIONES_DE_PARTE del dominio); una parte
-- anonimizada no cambia nunca más; la fecha de anonimización la fija la base; y una parte con vínculos no cambia de naturaleza si el
-- vínculo la exige.
CREATE FUNCTION parte_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF OLD.estado = 'ANONIMIZADA' THEN
    RAISE EXCEPTION 'una parte anonimizada no cambia nunca más'
      USING ERRCODE = '23514', CONSTRAINT = 'parte_anonimizada_inmutable';
  END IF;
  IF NEW.id <> OLD.id OR NEW.empresa_id <> OLD.empresa_id OR NEW.idempotencia_alta <> OLD.idempotencia_alta
     OR NEW.creado_por IS DISTINCT FROM OLD.creado_por OR NEW.es_atajo <> OLD.es_atajo OR NEW.creado_en <> OLD.creado_en THEN
    RAISE EXCEPTION 'la identidad de una parte no cambia (id, empresa, clave de alta, autor, atajo y fecha de alta)'
      USING ERRCODE = '23514', CONSTRAINT = 'parte_identidad_inmutable';
  END IF;
  IF NEW.estado <> OLD.estado AND (OLD.estado || '>' || NEW.estado) <> ALL (
       ARRAY['ACTIVA>INACTIVA', 'INACTIVA>ACTIVA', 'ACTIVA>ANONIMIZADA', 'INACTIVA>ANONIMIZADA']) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'parte_transicion_invalida';
  END IF;
  IF NEW.estado = 'ANONIMIZADA' THEN
    NEW.anonimizada_en := now();
  END IF;
  IF NEW.naturaleza <> OLD.naturaleza AND EXISTS (
       SELECT 1 FROM public.parte_vinculo v JOIN public.tipo_de_vinculo t ON t.codigo = v.tipo
        WHERE v.empresa_id = NEW.empresa_id
          AND ((v.parte_id = NEW.id AND t.contacto_humana AND NEW.naturaleza <> 'HUMANA')
            OR (v.de_parte_id = NEW.id AND t.de_parte_juridica AND NEW.naturaleza <> 'JURIDICA'))) THEN
    RAISE EXCEPTION 'la parte tiene vínculos que exigen su naturaleza actual'
      USING ERRCODE = '23514', CONSTRAINT = 'parte_naturaleza_con_vinculos';
  END IF;
  RETURN NEW;
END
$$;

-- Una parte anonimizada no deja roles ni vínculos activos: se verifica al confirmar la transacción (el caso de uso los apaga en la
-- misma transacción; si se olvida, la base no confirma).
CREATE FUNCTION parte_anonimizada_sin_relaciones() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF EXISTS (SELECT 1 FROM public.parte_rol r WHERE r.empresa_id = NEW.empresa_id AND r.parte_id = NEW.id AND r.activo)
     OR EXISTS (SELECT 1 FROM public.parte_vinculo v WHERE v.empresa_id = NEW.empresa_id AND v.activo
                  AND (v.parte_id = NEW.id OR v.de_parte_id = NEW.id)) THEN
    RAISE EXCEPTION 'una parte anonimizada no puede conservar roles ni vínculos activos'
      USING ERRCODE = '23514', CONSTRAINT = 'parte_anonimizada_con_relaciones';
  END IF;
  RETURN NULL;
END
$$;

-- Un rol no se activa (ni se crea) sobre una parte anonimizada; la clave del rol no cambia.
CREATE FUNCTION parte_rol_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.empresa_id <> OLD.empresa_id OR NEW.parte_id <> OLD.parte_id OR NEW.rol <> OLD.rol) THEN
    RAISE EXCEPTION 'la parte y el rol de una fila de parte_rol no cambian'
      USING ERRCODE = '23514', CONSTRAINT = 'parte_rol_clave_inmutable';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.activo) AND EXISTS (
       SELECT 1 FROM public.parte p WHERE p.id = NEW.parte_id AND p.empresa_id = NEW.empresa_id AND p.estado = 'ANONIMIZADA') THEN
    RAISE EXCEPTION 'una parte anonimizada no tiene roles'
      USING ERRCODE = '23514', CONSTRAINT = 'parte_rol_parte_anonimizada';
  END IF;
  RETURN NEW;
END
$$;

-- Un vínculo no se activa (ni se crea) con una parte anonimizada; el contacto y la empresa tienen la naturaleza que exige el tipo;
-- la clave del vínculo no cambia.
CREATE FUNCTION parte_vinculo_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_t public.tipo_de_vinculo%ROWTYPE;
  v_a text; v_b text; v_ea text; v_eb text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.empresa_id <> OLD.empresa_id OR NEW.parte_id <> OLD.parte_id
                           OR NEW.de_parte_id <> OLD.de_parte_id OR NEW.tipo <> OLD.tipo) THEN
    RAISE EXCEPTION 'las partes y el tipo de un vínculo no cambian'
      USING ERRCODE = '23514', CONSTRAINT = 'parte_vinculo_clave_inmutable';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.activo THEN
    SELECT naturaleza, estado INTO v_a, v_ea FROM public.parte WHERE id = NEW.parte_id AND empresa_id = NEW.empresa_id;
    SELECT naturaleza, estado INTO v_b, v_eb FROM public.parte WHERE id = NEW.de_parte_id AND empresa_id = NEW.empresa_id;
    IF v_a IS NULL OR v_b IS NULL THEN
      RETURN NEW;                              -- una de las partes no existe en esta empresa: lo rechaza la clave foránea compuesta
    END IF;
    IF v_ea = 'ANONIMIZADA' OR v_eb = 'ANONIMIZADA' THEN
      RAISE EXCEPTION 'una parte anonimizada no tiene vínculos'
        USING ERRCODE = '23514', CONSTRAINT = 'parte_vinculo_parte_anonimizada';
    END IF;
    SELECT * INTO v_t FROM public.tipo_de_vinculo WHERE codigo = NEW.tipo;
    IF v_t.contacto_humana AND v_a IS DISTINCT FROM 'HUMANA' THEN
      RAISE EXCEPTION 'el contacto o el agente tiene que ser una persona humana'
        USING ERRCODE = '23514', CONSTRAINT = 'parte_vinculo_contacto_humana';
    END IF;
    IF v_t.de_parte_juridica AND v_b IS DISTINCT FROM 'JURIDICA' THEN
      RAISE EXCEPTION 'este vínculo es con una persona jurídica'
        USING ERRCODE = '23514', CONSTRAINT = 'parte_vinculo_de_parte_juridica';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER parte_validar BEFORE UPDATE ON parte
  FOR EACH ROW EXECUTE FUNCTION parte_validar_cambio();
CREATE TRIGGER parte_version BEFORE UPDATE ON parte
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE CONSTRAINT TRIGGER parte_anonimizada_relaciones AFTER UPDATE OF estado ON parte
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.estado = 'ANONIMIZADA' AND OLD.estado <> 'ANONIMIZADA')
  EXECUTE FUNCTION parte_anonimizada_sin_relaciones();
CREATE TRIGGER parte_sin_borrado BEFORE DELETE ON parte
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER parte_sin_truncate BEFORE TRUNCATE ON parte
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER parte_rol_validar BEFORE INSERT OR UPDATE ON parte_rol
  FOR EACH ROW EXECUTE FUNCTION parte_rol_validar();
CREATE TRIGGER parte_rol_version BEFORE UPDATE ON parte_rol
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER parte_rol_sin_borrado BEFORE DELETE ON parte_rol
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER parte_rol_sin_truncate BEFORE TRUNCATE ON parte_rol
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER parte_vinculo_validar BEFORE INSERT OR UPDATE ON parte_vinculo
  FOR EACH ROW EXECUTE FUNCTION parte_vinculo_validar();
CREATE TRIGGER parte_vinculo_version BEFORE UPDATE ON parte_vinculo
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER parte_vinculo_sin_borrado BEFORE DELETE ON parte_vinculo
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER parte_vinculo_sin_truncate BEFORE TRUNCATE ON parte_vinculo
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER rol_de_parte_solo_insercion BEFORE UPDATE OR DELETE ON rol_de_parte
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER rol_de_parte_sin_truncate BEFORE TRUNCATE ON rol_de_parte
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER tipo_de_vinculo_solo_insercion BEFORE UPDATE OR DELETE ON tipo_de_vinculo
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER tipo_de_vinculo_sin_truncate BEFORE TRUNCATE ON tipo_de_vinculo
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ================================================================================================
-- Privilegios y RLS. Todo cerrado para PUBLIC; solo pedernal_app recibe algo (plataforma, grupo, trabajos, público, autenticación y
-- captación: nada, fallan cerrados hasta que clientes publique su consulta de grupo; el rol de respaldo, de solo lectura y con
-- BYPASSRLS, recibe SELECT por los privilegios por defecto de 0012). INSERT y UPDATE por columna; nadie recibe DELETE, TRUNCATE,
-- REFERENCES ni TRIGGER. Las columnas que fija la base (id, estado inicial, fechas, versión, columnas generadas) no se escriben.
-- ================================================================================================
REVOKE ALL ON rol_de_parte, tipo_de_vinculo, parte, parte_rol, parte_vinculo FROM PUBLIC;

GRANT SELECT ON rol_de_parte, tipo_de_vinculo, parte, parte_rol, parte_vinculo TO pedernal_app;
GRANT INSERT (empresa_id, idempotencia_alta, naturaleza, nombre, apellido, alias, documento_tipo, documento_pais, documento_numero,
              condicion_iva, email, telefono, dom_pais, dom_calle, dom_numero, dom_piso, dom_departamento, dom_localidad,
              dom_provincia, dom_codigo_postal, dom_texto, nota, es_atajo, creado_por) ON parte TO pedernal_app;
GRANT UPDATE (naturaleza, nombre, apellido, alias, documento_tipo, documento_pais, documento_numero, condicion_iva, email, telefono,
              dom_pais, dom_calle, dom_numero, dom_piso, dom_departamento, dom_localidad, dom_provincia, dom_codigo_postal,
              dom_texto, nota, estado) ON parte TO pedernal_app;
GRANT INSERT (empresa_id, parte_id, rol) ON parte_rol TO pedernal_app;
GRANT UPDATE (activo) ON parte_rol TO pedernal_app;
GRANT INSERT (empresa_id, parte_id, de_parte_id, tipo, cargo) ON parte_vinculo TO pedernal_app;
GRANT UPDATE (activo, cargo) ON parte_vinculo TO pedernal_app;

ALTER TABLE rol_de_parte ENABLE ROW LEVEL SECURITY;
ALTER TABLE rol_de_parte FORCE ROW LEVEL SECURITY;
ALTER TABLE tipo_de_vinculo ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipo_de_vinculo FORCE ROW LEVEL SECURITY;
ALTER TABLE parte ENABLE ROW LEVEL SECURITY;
ALTER TABLE parte FORCE ROW LEVEL SECURITY;
ALTER TABLE parte_rol ENABLE ROW LEVEL SECURITY;
ALTER TABLE parte_rol FORCE ROW LEVEL SECURITY;
ALTER TABLE parte_vinculo ENABLE ROW LEVEL SECURITY;
ALTER TABLE parte_vinculo FORCE ROW LEVEL SECURITY;

-- Vocabularios globales: se leen, no se escriben.
CREATE POLICY rol_de_parte_app_leer ON rol_de_parte FOR SELECT TO pedernal_app USING (true);
CREATE POLICY tipo_de_vinculo_app_leer ON tipo_de_vinculo FOR SELECT TO pedernal_app USING (true);

-- parte: lectura de la empresa del contexto; alta y cambio solo si la empresa opera; el autor es la persona del contexto; una anonimizada
-- no se edita (la política no la deja ni ver como «a cambiar»; el disparador lo impide también al dueño de la base).
CREATE POLICY parte_app_leer ON parte FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY parte_app_alta ON parte FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
              AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id()));
CREATE POLICY parte_app_cambiar ON parte FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND estado <> 'ANONIMIZADA')
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY parte_rol_app_leer ON parte_rol FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY parte_rol_app_alta ON parte_rol FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY parte_rol_app_cambiar ON parte_rol FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY parte_vinculo_app_leer ON parte_vinculo FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY parte_vinculo_app_alta ON parte_vinculo FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY parte_vinculo_app_cambiar ON parte_vinculo FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
