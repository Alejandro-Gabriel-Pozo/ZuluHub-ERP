-- 0026_cierre: módulo «Cierre del día» (E3b; decisiones 158, 160, 161, 163, 167 y 168 del dueño). Dos tablas nuevas: la JORNADA de una
-- sucursal (`jornada_de_sucursal`: ABIERTA → EN_AUDITORIA ⇄ ABIERTA, EN_AUDITORIA → CERRADA) y la foto de los controles que se vieron al
-- cerrarla (`control_de_jornada_cerrada`, solo inserción). Diseño: Pedernal-docs/11-especificaciones/e3b-cierre-del-dia-especificacion.md
-- §3.2 y §3.7. Es ANTERIOR a la migración de caja (0027), que lee `jornada_de_sucursal` desde sus disparadores.
--
-- Reglas de esta migración (las mismas de 0001 a 0024):
--  * Es ADITIVA: dos tablas, cuatro funciones y sus disparadores, políticas y privilegios. No toca ninguna tabla, fila ni función
--    existente. Nada se rellena: no hay jornadas de antes (la jornada nace con la primera actividad del día, la crea quien la tiene).
--  * Su reversión es un script aparte, revisado, que SOLO corre con las dos tablas VACÍAS (una jornada o una foto de controles
--    registran un cierre que no se puede recomputar): `migraciones/reversiones/0026_revertir_cierre.sql`. El ejecutor no la aplica.
--  * Nadie recibe DELETE ni TRUNCATE. INSERT y UPDATE van por columna. RLS activa y FORZADA; sin política no hay acceso. Ninguna
--    función SECURITY DEFINER. La plataforma, el grupo y los trabajos no reciben nada.
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro).
--
-- Decisiones de diseño (probadas por `test/integracion/cierre-migracion.test.ts`):
--
--  J1. La clave de la jornada es `(empresa, sucursal, fecha de negocio)`: UNA jornada por sucursal y fecha (decisión 168). La fecha es la
--      que sella cada módulo en su actividad (`fechaDeNegocio`, zona de la empresa y hora de corte de la sucursal); `cierre` no la
--      recalcula y cambiar la hora de corte no mueve jornadas existentes. La jornada NO se cierra sola al llegar el corte (decisión 160).
--  J2. Máquina de estados en la base (`jornada_validar_cambio`): ABIERTA → EN_AUDITORIA, EN_AUDITORIA → ABIERTA y EN_AUDITORIA →
--      CERRADA, y nada más. CERRADA queda congelada: ni el dueño de la base la cambia (un error posterior se corrige con un ajuste del
--      día en curso, e3 §3.11.3). Quien inicia la auditoría y quien cierra son la persona del contexto firmado (`app_persona_id()`):
--      la aplicación no puede poner a otra.
--  J3. El estado manda sobre las marcas de tiempo (CHECK `jornada_estado_marcas_ck`): ABIERTA ⇔ sin inicio de auditoría; CERRADA ⇔ con
--      cierre. Cancelar la auditoría borra el inicio de la fila (el rastro queda en `auditoria_empresa`, que es de solo inserción).
--  J4. La foto de controles solo entra con la jornada pasando a CERRADA en ESTA transacción (`control_de_jornada_validar_alta`:
--      estado CERRADA y `xmin` = transacción en curso, el mismo recurso de 0005 para el traspaso de gerencia). Con SQL directo no se
--      puede sembrar una foto en una jornada abierta ni agregar controles a una cerrada de antes. Solo inserción: ni UPDATE ni DELETE ni
--      TRUNCATE, tampoco para el dueño.
--  J5. `reconocido` implica un control RECONOCIBLE con hallazgos, con quién y cuándo (CHECK): constancia de la decisión 167.
--  J6. La base NO sabe nada de los módulos que aportan controles (caja, ventas...): ninguna regla mira tablas de otro módulo. Los
--      nombres `modulo` y `clave` solo se validan por forma, con la lista de permitidos `[a-z_]` (la clave es `modulo.control`).

DO $$
BEGIN
  IF to_regclass('public.sucursal') IS NULL OR to_regclass('public.persona') IS NULL
     OR to_regprocedure('public.solo_insercion()') IS NULL OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL OR to_regprocedure('public.app_persona_id()') IS NULL THEN
    RAISE EXCEPTION 'el cierre del día requiere 0001 (sucursal, persona, funciones de contexto y de solo inserción) aplicada antes'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- La jornada de una sucursal
-- ---------------------------------------------------------------------------------------------
CREATE TABLE jornada_de_sucursal (
  empresa_id             uuid NOT NULL,
  sucursal_id            uuid NOT NULL,
  fecha_negocio          date NOT NULL,
  estado                 text NOT NULL DEFAULT 'ABIERTA',
  auditoria_iniciada_en  timestamptz,           -- el `ahora` de la aplicación, no now()
  auditoria_iniciada_por uuid,
  cerrada_en             timestamptz,
  cerrada_por            uuid,
  huella_de_cierre       text,                  -- sha256 (hex) de los controles que se vieron al cerrar
  observacion            text,
  creado_en              timestamptz NOT NULL DEFAULT now(),
  actualizado_en         timestamptz NOT NULL DEFAULT now(),
  version                integer NOT NULL DEFAULT 1,
  CONSTRAINT jornada_de_sucursal_pkey PRIMARY KEY (empresa_id, sucursal_id, fecha_negocio),
  CONSTRAINT jornada_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT jornada_iniciada_por_fkey FOREIGN KEY (auditoria_iniciada_por) REFERENCES persona (id),
  CONSTRAINT jornada_cerrada_por_fkey FOREIGN KEY (cerrada_por) REFERENCES persona (id),
  CONSTRAINT jornada_estado_ck CHECK (estado IN ('ABIERTA', 'EN_AUDITORIA', 'CERRADA')),
  -- Una fecha civil razonable: un error de carga (año 0001 o 9999) no crea una jornada.
  CONSTRAINT jornada_fecha_ck CHECK (fecha_negocio BETWEEN date '2000-01-01' AND date '2200-12-31'),
  -- J3: el estado manda sobre las marcas, y cada marca va con su persona.
  CONSTRAINT jornada_estado_marcas_ck CHECK (
    (estado = 'ABIERTA') = (auditoria_iniciada_en IS NULL)
    AND (estado = 'CERRADA') = (cerrada_en IS NOT NULL)
    AND (auditoria_iniciada_en IS NULL) = (auditoria_iniciada_por IS NULL)
    AND (cerrada_en IS NULL) = (cerrada_por IS NULL)
    AND (cerrada_en IS NULL) = (huella_de_cierre IS NULL)
    AND (cerrada_en IS NULL OR cerrada_en >= auditoria_iniciada_en)
  ),
  CONSTRAINT jornada_huella_ck CHECK (huella_de_cierre IS NULL OR huella_de_cierre ~ '^[0-9a-f]{64}$'),
  -- Opcional (decisión 160), solo al cerrar, una línea de hasta 500 caracteres sin control.
  CONSTRAINT jornada_observacion_ck CHECK (
    observacion IS NULL OR (
      estado = 'CERRADA' AND observacion = btrim(observacion) AND char_length(observacion) BETWEEN 1 AND 500
      AND observacion !~ '[\x01-\x1F\x7F-\x9F]'
    )
  )
);

-- Inmutables siempre: quién y qué jornada es. CERRADA no admite NINGÚN cambio. Las transiciones son exactamente tres (J2).
CREATE FUNCTION jornada_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id
     OR NEW.fecha_negocio IS DISTINCT FROM OLD.fecha_negocio
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'la identidad de una jornada no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'jornada_inmutable';
  END IF;

  IF OLD.estado = 'CERRADA' THEN
    RAISE EXCEPTION 'una jornada cerrada no se puede modificar'
      USING ERRCODE = '23514', CONSTRAINT = 'jornada_cerrada_congelada';
  END IF;

  IF OLD.estado = 'ABIERTA' AND NEW.estado = 'EN_AUDITORIA' THEN
    -- Quien la inicia es la persona del contexto; todavía no hay cierre.
    IF NEW.auditoria_iniciada_por IS DISTINCT FROM public.app_persona_id() THEN
      RAISE EXCEPTION 'la auditoría la inicia la persona del contexto'
        USING ERRCODE = '23514', CONSTRAINT = 'jornada_persona_del_contexto';
    END IF;
    IF NEW.cerrada_en IS NOT NULL OR NEW.cerrada_por IS NOT NULL OR NEW.huella_de_cierre IS NOT NULL OR NEW.observacion IS NOT NULL THEN
      RAISE EXCEPTION 'al iniciar la auditoría no hay datos de cierre'
        USING ERRCODE = '23514', CONSTRAINT = 'jornada_transicion_invalida';
    END IF;
  ELSIF OLD.estado = 'EN_AUDITORIA' AND NEW.estado = 'ABIERTA' THEN
    -- Cancelar: vuelve sin marcas (el CHECK lo exige); el rastro queda en la auditoría de la empresa.
    NULL;
  ELSIF OLD.estado = 'EN_AUDITORIA' AND NEW.estado = 'CERRADA' THEN
    IF NEW.auditoria_iniciada_en IS DISTINCT FROM OLD.auditoria_iniciada_en
       OR NEW.auditoria_iniciada_por IS DISTINCT FROM OLD.auditoria_iniciada_por THEN
      RAISE EXCEPTION 'al cerrar no se cambia quién ni cuándo inició la auditoría'
        USING ERRCODE = '23514', CONSTRAINT = 'jornada_transicion_invalida';
    END IF;
    IF NEW.cerrada_por IS DISTINCT FROM public.app_persona_id() THEN
      RAISE EXCEPTION 'la jornada la cierra la persona del contexto'
        USING ERRCODE = '23514', CONSTRAINT = 'jornada_persona_del_contexto';
    END IF;
  ELSE
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'jornada_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

-- Nadie borra una jornada ni la vacía (ni el dueño de la base): se cierra, no se elimina.
CREATE FUNCTION jornada_no_se_borra() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION 'una jornada no se borra'
    USING ERRCODE = '42501';
END
$$;

-- El nombre ordena `jornada_cambio` antes de `jornada_version` (los BEFORE de un mismo evento corren en orden alfabético).
CREATE TRIGGER jornada_cambio BEFORE UPDATE ON jornada_de_sucursal
  FOR EACH ROW EXECUTE FUNCTION jornada_validar_cambio();
CREATE TRIGGER jornada_version BEFORE UPDATE ON jornada_de_sucursal
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER jornada_sin_borrar BEFORE DELETE ON jornada_de_sucursal
  FOR EACH ROW EXECUTE FUNCTION jornada_no_se_borra();
CREATE TRIGGER jornada_sin_truncate BEFORE TRUNCATE ON jornada_de_sucursal
  FOR EACH STATEMENT EXECUTE FUNCTION jornada_no_se_borra();

-- ---------------------------------------------------------------------------------------------
-- La foto de los controles al cerrar (solo inserción)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE control_de_jornada_cerrada (
  empresa_id     uuid NOT NULL,
  sucursal_id    uuid NOT NULL,
  fecha_negocio  date NOT NULL,
  modulo         text NOT NULL,
  clave          text NOT NULL,
  severidad      text NOT NULL,
  cantidad       integer NOT NULL,
  reconocido     boolean NOT NULL,
  reconocido_en  timestamptz,
  reconocido_por uuid,
  texto          text,                  -- explicación opcional de quien reconoce (decisión 160)
  creado_en      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_de_jornada_cerrada_pkey PRIMARY KEY (empresa_id, sucursal_id, fecha_negocio, modulo, clave),
  CONSTRAINT control_jornada_fkey FOREIGN KEY (empresa_id, sucursal_id, fecha_negocio)
    REFERENCES jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio),
  CONSTRAINT control_reconocido_por_fkey FOREIGN KEY (reconocido_por) REFERENCES persona (id),
  CONSTRAINT control_modulo_ck CHECK (modulo ~ '^[a-z_]+$' AND char_length(modulo) <= 40),
  CONSTRAINT control_clave_ck CHECK (
    clave ~ '^[a-z_]+\.[a-z_]+$' AND char_length(clave) <= 81
    AND left(clave, char_length(modulo) + 1) = modulo || '.'
  ),
  CONSTRAINT control_severidad_ck CHECK (severidad IN ('BLOQUEA', 'RECONOCIBLE', 'INFORMA')),
  CONSTRAINT control_cantidad_ck CHECK (cantidad >= 0),
  -- J5: reconocido ⇒ por y en, y solo un control RECONOCIBLE con hallazgos se reconoce.
  CONSTRAINT control_reconocido_ck CHECK (
    reconocido = (reconocido_por IS NOT NULL AND reconocido_en IS NOT NULL)
    AND (reconocido_por IS NULL) = (reconocido_en IS NULL)
    AND (NOT reconocido OR (severidad = 'RECONOCIBLE' AND cantidad > 0))
  ),
  CONSTRAINT control_texto_ck CHECK (
    texto IS NULL OR (
      reconocido AND texto = btrim(texto) AND char_length(texto) BETWEEN 1 AND 500
      AND texto !~ '[\x01-\x1F\x7F-\x9F]'
    )
  )
);

-- J4: solo entra con la jornada pasando a CERRADA en esta misma transacción.
CREATE FUNCTION control_de_jornada_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.jornada_de_sucursal j
     WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = NEW.sucursal_id AND j.fecha_negocio = NEW.fecha_negocio
       AND j.estado = 'CERRADA' AND j.xmin = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'los controles solo se guardan al cerrar la jornada, en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'control_solo_al_cerrar';
  END IF;
  RETURN NEW;
END
$$;

-- Los de 0001 (`solo_insercion`) rechazan con 42501 UPDATE, DELETE y TRUNCATE, también al dueño.
CREATE TRIGGER control_de_jornada_alta BEFORE INSERT ON control_de_jornada_cerrada
  FOR EACH ROW EXECUTE FUNCTION control_de_jornada_validar_alta();
CREATE TRIGGER control_de_jornada_solo_insercion BEFORE UPDATE OR DELETE ON control_de_jornada_cerrada
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER control_de_jornada_sin_truncate BEFORE TRUNCATE ON control_de_jornada_cerrada
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE. Solo la aplicación (la plataforma, el grupo y los trabajos, nada).
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON jornada_de_sucursal FROM PUBLIC;
REVOKE ALL ON control_de_jornada_cerrada FROM PUBLIC;

GRANT SELECT ON jornada_de_sucursal TO pedernal_app;
-- La crea quien tiene la primera actividad del día (nace ABIERTA, sin marcas).
GRANT INSERT (empresa_id, sucursal_id, fecha_negocio) ON jornada_de_sucursal TO pedernal_app;
GRANT UPDATE (estado, auditoria_iniciada_en, auditoria_iniciada_por, cerrada_en, cerrada_por, huella_de_cierre, observacion)
  ON jornada_de_sucursal TO pedernal_app;

GRANT SELECT ON control_de_jornada_cerrada TO pedernal_app;
GRANT INSERT (empresa_id, sucursal_id, fecha_negocio, modulo, clave, severidad, cantidad, reconocido, reconocido_en,
              reconocido_por, texto) ON control_de_jornada_cerrada TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada; sin política no hay acceso (el dueño de la base tampoco ve nada sin BYPASSRLS)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE jornada_de_sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE jornada_de_sucursal FORCE ROW LEVEL SECURITY;
ALTER TABLE control_de_jornada_cerrada ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_de_jornada_cerrada FORCE ROW LEVEL SECURITY;

CREATE POLICY jornada_app_leer ON jornada_de_sucursal FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY jornada_app_alta ON jornada_de_sucursal FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
-- `FOR SHARE` (quien tiene actividad) y `FOR UPDATE` (quien inicia, cancela o cierra) pasan por esta política.
CREATE POLICY jornada_app_cambiar ON jornada_de_sucursal FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY control_de_jornada_app_leer ON control_de_jornada_cerrada FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY control_de_jornada_app_alta ON control_de_jornada_cerrada FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
