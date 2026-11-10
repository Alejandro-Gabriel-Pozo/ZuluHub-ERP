-- 0027_caja: caja y cobros (E3) y lo que caja aporta al cierre del día (E3b §4). Tablas de empresa: `caja`, `medio_de_pago`,
-- `cuenta_de_cobro`, `sesion_caja`, `movimiento_caja`, `cobro`, `arqueo_caja`, `arqueo_billete`; tabla GLOBAL de listas del sistema:
-- `valor_de_lista`; contribución al cierre del día: `correccion_de_medio`, `declaracion_de_total`, `conforme_de_jornada`,
-- `cierre_de_caja_de_jornada`, `conciliacion_de_jornada`, `conciliacion_de_cobro_por_origen`.
-- Diseño: Pedernal-docs/11-especificaciones/e3-caja-y-cobros-especificacion.md §3.1 (manda), `caja-y-cobros.md` §B.6 (DDL base y
-- disparadores) y `e3b-cierre-del-dia-especificacion.md` §4.3, §4.4 y §4.6. Es POSTERIOR a 0026 (cierre): lee `jornada_de_sucursal`.
--
-- Reglas de esta migración (las mismas de 0001 a 0026):
--  * Es ADITIVA: tablas, funciones y disparadores nuevos, y las semillas de `valor_de_lista`. No toca ninguna tabla, fila ni función
--    existente. Nada se rellena: no hay cajas de antes («Caja 1» nace con la sucursal, e3 §3.2.1).
--  * Su reversión es un script aparte, revisado, que SOLO corre con todas las tablas VACÍAS (y `valor_de_lista` con sus semillas sin
--    tocar): `migraciones/reversiones/0027_revertir_caja.sql`. El ejecutor no la aplica.
--  * Nadie recibe DELETE ni TRUNCATE. INSERT y UPDATE van por columna. RLS activa y FORZADA; sin política no hay acceso. Ninguna función
--    SECURITY DEFINER; toda función fija su `search_path`. El rol de grupo y el de trabajos no reciben nada.
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro).
--
-- Decisiones de diseño (probadas por `test/integracion/caja-*.test.ts`):
--
--  C1. Un movimiento solo entra en una sesión ABIERTA cuya jornada está ABIERTA: el disparador toma `FOR SHARE` de la sesión y de la
--      jornada. `iniciar cierre` y `cerrar` hacen UPDATE de la sesión (bloqueo exclusivo) y esperan a los cobros en vuelo; los que
--      llegan después ven EN_CIERRE/CERRADA y fallan sin escribir. El diferido `sesion_caja_cierre_completo` recalcula el esperado AL
--      CONFIRMAR: un cobro que se coló entre el cálculo y el cierre hace fallar la confirmación (la falla de Motor2, 1 en 370).
--  C2. Movimientos, cobros, arqueos, billetes y todas las tablas de la contribución al cierre son de SOLO INSERCIÓN, también para el
--      dueño de la base (`solo_insercion()` de 0001). Anular = un movimiento espejo nuevo; corregir un medio = un registro nuevo.
--  C3. El sello de jornada de la sesión (`fecha_negocio`, `hora_de_corte`, `zona_horaria`) lo verifica la base con la MISMA fórmula que
--      `fechaDeNegocio` de TypeScript (`fecha_de_negocio()`, comparadas en miles de instantes) y es inmutable.
--  C4. Medio ↔ cuenta de cobro (e3 §3.3) vive en UNA sola función de la base (`par_de_cobro_validar`), usada por movimientos,
--      correcciones y declaraciones. La cuenta es OPCIONAL (decisión 151); el efectivo no admite cuenta.
--  C5. La contribución al cierre se guarda CONGELADA: los aportes de caja congelan con la jornada todavía EN_AUDITORIA (el cierre la tiene
--      bloqueada `FOR UPDATE`) y la jornada pasa a CERRADA después, en la MISMA transacción. Cada tabla de la foto solo admite altas con la
--      jornada EN_AUDITORIA o recién cerrada por esta transacción (`xmin`, como `control_de_jornada_validar_alta` de 0026), y la cabecera
--      verifica al confirmar que la jornada quedó CERRADA y que las líneas cuadran (`caja_conciliacion_*`).
--  C6. Listas del sistema (`valor_de_lista`): tabla GLOBAL, sin `empresa_id`. Las empresas solo la leen; la plataforma (solo un ADMIN
--      escribe, como `plan`) agrega por (lista, nombre) y cambia (nombre, activo). Único por nombre sin distinguir mayúsculas ni
--      acentos (ICU nivel 1, la técnica de `sucursal_nombre_ci` de 0005 pero un nivel más laxo).
--  C7. Los textos libres (nombres, motivos, observaciones, explicaciones) usan la lista de permitidos de la explicación de 0026
--      (`jornada_observacion_ck`): letras latinas, dígitos, espacio y los signos de una frase, sin blancos en los extremos. SUPUESTO:
--      es la única lista de texto libre aprobada; el TypeScript de caja la importa de `src/modulos/cierre` (una regla, un lugar).

DO $$
BEGIN
  IF to_regclass('public.sucursal') IS NULL OR to_regclass('public.persona') IS NULL OR to_regclass('public.empresa') IS NULL
     OR to_regclass('public.jornada_de_sucursal') IS NULL
     OR to_regprocedure('public.solo_insercion()') IS NULL OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL OR to_regprocedure('public.app_persona_id()') IS NULL
     OR to_regprocedure('public.plataforma_actor_vigente()') IS NULL
     OR to_regprocedure('public.admin_plataforma_con_rol(text[])') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'sucursal' AND column_name = 'hora_de_corte') THEN
    RAISE EXCEPTION 'caja requiere 0001 a 0007 y 0026 (cierre) aplicadas antes (sucursal con hora de corte, funciones de contexto y de solo inserción, jornada)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Funciones comunes (las ejecuta quien escribe: la aplicación)
-- ---------------------------------------------------------------------------------------------

-- C3. La fecha de negocio: fecha civil de (instante en la zona) − hora de corte. La misma fórmula que `fechaDeNegocio` de
-- `src/primitivas/tiempo` (una prueba las compara en miles de instantes). Con corte en minutos exactos, los segundos del instante no
-- cambian el resultado.
CREATE FUNCTION fecha_de_negocio(p_instante timestamptz, p_zona text, p_corte time) RETURNS date
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT ((p_instante AT TIME ZONE p_zona) - p_corte::interval)::date $$;

-- C4. ¿Admite este tipo de medio una cuenta de este tipo? (e3 §3.3; el efectivo no admite ninguna; sin cuenta lo decide quien llama.)
CREATE FUNCTION cuenta_admitida_por_medio(p_tipo_de_medio text, p_tipo_de_cuenta text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE p_tipo_de_medio
    WHEN 'TARJETA_DEBITO' THEN p_tipo_de_cuenta = 'TERMINAL'
    WHEN 'TARJETA_CREDITO' THEN p_tipo_de_cuenta = 'TERMINAL'
    WHEN 'QR' THEN p_tipo_de_cuenta IN ('QR', 'TERMINAL')
    WHEN 'TRANSFERENCIA' THEN p_tipo_de_cuenta = 'CUENTA_BANCARIA'
    WHEN 'OTRO' THEN p_tipo_de_cuenta IN ('TERMINAL', 'QR', 'CUENTA_BANCARIA')
    ELSE false
  END
$$;

-- C4. El par (medio, cuenta) de un cobro, corrección o declaración: el medio existe (y está activo si se exige), la cuenta —si viene—
-- existe, es de la sucursal pedida, está activa (si se exige) y es de un tipo que el medio admite; el efectivo no lleva cuenta.
-- Devuelve el tipo del medio. El error lleva el nombre de la restricción de quien llama (`<tabla>_cuenta_incompatible`, etc.).
CREATE FUNCTION par_de_cobro_validar(
  p_tabla text, p_empresa uuid, p_sucursal uuid, p_medio uuid, p_cuenta uuid, p_exigir_activos boolean
) RETURNS text LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_tipo text;
  v_activo boolean;
  v_cuenta record;
BEGIN
  SELECT m.tipo, m.activo INTO v_tipo, v_activo
    FROM public.medio_de_pago m WHERE m.id = p_medio AND m.empresa_id = p_empresa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el medio de pago no existe en la empresa'
      USING ERRCODE = '23514', CONSTRAINT = p_tabla || '_medio_inexistente';
  END IF;
  IF p_exigir_activos AND NOT v_activo THEN
    RAISE EXCEPTION 'el medio de pago está desactivado'
      USING ERRCODE = '23514', CONSTRAINT = p_tabla || '_medio_inactivo';
  END IF;
  IF p_cuenta IS NULL THEN
    RETURN v_tipo;
  END IF;
  IF v_tipo = 'EFECTIVO' THEN
    RAISE EXCEPTION 'el efectivo no lleva cuenta de cobro'
      USING ERRCODE = '23514', CONSTRAINT = p_tabla || '_cuenta_no_admitida';
  END IF;
  SELECT c.tipo, c.activa, c.sucursal_id INTO v_cuenta
    FROM public.cuenta_de_cobro c WHERE c.id = p_cuenta AND c.empresa_id = p_empresa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la cuenta de cobro no existe en la empresa'
      USING ERRCODE = '23514', CONSTRAINT = p_tabla || '_cuenta_inexistente';
  END IF;
  IF v_cuenta.sucursal_id IS DISTINCT FROM p_sucursal THEN
    RAISE EXCEPTION 'la cuenta de cobro es de otra sucursal'
      USING ERRCODE = '23514', CONSTRAINT = p_tabla || '_cuenta_de_otra_sucursal';
  END IF;
  IF p_exigir_activos AND NOT v_cuenta.activa THEN
    RAISE EXCEPTION 'la cuenta de cobro está desactivada'
      USING ERRCODE = '23514', CONSTRAINT = p_tabla || '_cuenta_inactiva';
  END IF;
  IF NOT public.cuenta_admitida_por_medio(v_tipo, v_cuenta.tipo) THEN
    RAISE EXCEPTION 'el medio de pago no admite ese tipo de cuenta de cobro'
      USING ERRCODE = '23514', CONSTRAINT = p_tabla || '_cuenta_incompatible';
  END IF;
  RETURN v_tipo;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------------------------------
CREATE TABLE caja (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  sucursal_id    uuid NOT NULL,
  nombre         text NOT NULL,
  activa         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT caja_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT caja_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT caja_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT caja_nombre_ck CHECK (
    nombre = btrim(nombre) AND char_length(nombre) BETWEEN 1 AND 100
    AND nombre ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
  )
);
CREATE UNIQUE INDEX caja_nombre_uk ON caja (empresa_id, sucursal_id, lower(nombre));

CREATE FUNCTION caja_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'la empresa y la sucursal de una caja no se pueden cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'caja_sucursal_inmutable';
  END IF;
  -- Una caja con una sesión no cerrada no se desactiva. `abrirSesion` toma la caja `FOR SHARE`: un desactivar y un abrir a la vez se
  -- serializan, y quien llega segundo ve lo del primero.
  IF OLD.activa AND NOT NEW.activa AND EXISTS (
    SELECT 1 FROM public.sesion_caja s WHERE s.caja_id = OLD.id AND s.empresa_id = OLD.empresa_id AND s.estado <> 'CERRADA'
  ) THEN
    RAISE EXCEPTION 'la caja tiene una sesión sin cerrar'
      USING ERRCODE = '23514', CONSTRAINT = 'caja_con_sesion_vigente';
  END IF;
  RETURN NEW;
END
$$;

-- El nombre ordena `*_cambio` antes de `*_version` (los BEFORE de un mismo evento corren en orden alfabético).
CREATE TRIGGER caja_cambio BEFORE UPDATE ON caja FOR EACH ROW EXECUTE FUNCTION caja_validar_cambio();
CREATE TRIGGER caja_version BEFORE UPDATE ON caja FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- ---------------------------------------------------------------------------------------------
-- Medio de pago (decisión 124) y qué datos pide al cobrar (decisión 129: «al principio ninguno»)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE medio_de_pago (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  tipo           text NOT NULL,
  nombre         text,                              -- NULL: la pantalla usa el vocabulario del tipo
  activo         boolean NOT NULL DEFAULT true,
  pide_cupon     boolean NOT NULL DEFAULT false,
  pide_ultimos4  boolean NOT NULL DEFAULT false,
  pide_marca     boolean NOT NULL DEFAULT false,
  pide_cuotas    boolean NOT NULL DEFAULT false,
  pide_dni       boolean NOT NULL DEFAULT false,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT medio_de_pago_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT medio_de_pago_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT medio_de_pago_tipo_ck CHECK (
    tipo IN ('EFECTIVO', 'TARJETA_DEBITO', 'TARJETA_CREDITO', 'TRANSFERENCIA', 'QR', 'OTRO')
  ),
  CONSTRAINT medio_de_pago_nombre_ck CHECK (
    nombre IS NULL OR (
      nombre = btrim(nombre) AND char_length(nombre) BETWEEN 1 AND 60
      AND nombre ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
    )
  ),
  CONSTRAINT medio_de_pago_efectivo_activo_ck CHECK (tipo <> 'EFECTIVO' OR activo),
  -- Qué datos admite cada tipo (decisión 129).
  CONSTRAINT medio_de_pago_datos_ck CHECK (
    (tipo IN ('EFECTIVO', 'QR', 'OTRO') AND NOT (pide_cupon OR pide_ultimos4 OR pide_marca OR pide_cuotas OR pide_dni))
    OR (tipo = 'TARJETA_DEBITO' AND NOT (pide_cuotas OR pide_dni))
    OR (tipo = 'TARJETA_CREDITO' AND NOT pide_dni)
    OR (tipo = 'TRANSFERENCIA' AND NOT (pide_cupon OR pide_ultimos4 OR pide_marca OR pide_cuotas))
  )
);
CREATE UNIQUE INDEX medio_de_pago_efectivo_uk ON medio_de_pago (empresa_id) WHERE tipo = 'EFECTIVO';
CREATE UNIQUE INDEX medio_de_pago_nombre_uk ON medio_de_pago (empresa_id, lower(nombre)) WHERE nombre IS NOT NULL;
CREATE UNIQUE INDEX medio_de_pago_sin_nombre_uk ON medio_de_pago (empresa_id, tipo) WHERE nombre IS NULL;

CREATE FUNCTION medio_de_pago_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'el tipo de un medio de pago no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'medio_de_pago_tipo_inmutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER medio_de_pago_cambio BEFORE UPDATE ON medio_de_pago
  FOR EACH ROW EXECUTE FUNCTION medio_de_pago_validar_cambio();
CREATE TRIGGER medio_de_pago_version BEFORE UPDATE ON medio_de_pago
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- ---------------------------------------------------------------------------------------------
-- Cuenta de cobro (terminal, QR, cuenta bancaria): sin emisor (no hay varios CUIT) y con sucursal obligatoria
-- ---------------------------------------------------------------------------------------------
CREATE TABLE cuenta_de_cobro (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL,
  tipo                  text NOT NULL,
  nombre                text NOT NULL,
  identificador_externo text,                       -- nº de terminal, alias: nunca credenciales
  sucursal_id           uuid NOT NULL,              -- SUPUESTO (e3 §3.1, Q9): medios.html exige elegir una; relajar a NULL después es seguro
  activa                boolean NOT NULL DEFAULT true,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  CONSTRAINT cuenta_de_cobro_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT cuenta_de_cobro_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT cuenta_de_cobro_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT cuenta_de_cobro_tipo_ck CHECK (tipo IN ('TERMINAL', 'QR', 'CUENTA_BANCARIA')),
  CONSTRAINT cuenta_de_cobro_nombre_ck CHECK (
    nombre = btrim(nombre) AND char_length(nombre) BETWEEN 1 AND 60
    AND nombre ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
  ),
  CONSTRAINT cuenta_de_cobro_identificador_ck CHECK (
    identificador_externo IS NULL OR identificador_externo ~ '^[A-Za-z0-9 ._/-]{1,40}$'
  )
);
CREATE UNIQUE INDEX cuenta_de_cobro_nombre_uk ON cuenta_de_cobro (empresa_id, lower(nombre));

CREATE FUNCTION cuenta_de_cobro_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'el tipo de una cuenta de cobro no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_de_cobro_tipo_inmutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER cuenta_de_cobro_cambio BEFORE UPDATE ON cuenta_de_cobro
  FOR EACH ROW EXECUTE FUNCTION cuenta_de_cobro_validar_cambio();
CREATE TRIGGER cuenta_de_cobro_version BEFORE UPDATE ON cuenta_de_cobro
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- ---------------------------------------------------------------------------------------------
-- Sesión de caja, con el sello de la jornada
-- ---------------------------------------------------------------------------------------------
CREATE TABLE sesion_caja (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  caja_id            uuid NOT NULL,
  estado             text NOT NULL DEFAULT 'ABIERTA',
  -- Sello de la jornada: se escribe al abrir y no cambia nunca (disparador).
  fecha_negocio      date NOT NULL,
  hora_de_corte      time NOT NULL,
  zona_horaria       text NOT NULL,
  abierta_en         timestamptz NOT NULL,         -- el `ahora` de la aplicación, no now()
  abierta_por        uuid NOT NULL,
  cierre_iniciado_en  timestamptz,
  cierre_iniciado_por uuid,
  cerrada_en         timestamptz,
  cerrada_por        uuid,
  observacion        text,
  clave_idempotencia text NOT NULL,
  huella             text NOT NULL,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT sesion_caja_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT sesion_caja_caja_fkey FOREIGN KEY (caja_id, empresa_id) REFERENCES caja (id, empresa_id),
  CONSTRAINT sesion_caja_abierta_por_fkey FOREIGN KEY (abierta_por) REFERENCES persona (id),
  CONSTRAINT sesion_caja_iniciado_por_fkey FOREIGN KEY (cierre_iniciado_por) REFERENCES persona (id),
  CONSTRAINT sesion_caja_cerrada_por_fkey FOREIGN KEY (cerrada_por) REFERENCES persona (id),
  CONSTRAINT sesion_caja_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT sesion_caja_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT sesion_caja_estado_ck CHECK (estado IN ('ABIERTA', 'EN_CIERRE', 'CERRADA')),
  CONSTRAINT sesion_caja_fecha_ck CHECK (fecha_negocio BETWEEN date '2000-01-01' AND date '2200-12-31'),
  CONSTRAINT sesion_caja_hora_de_corte_ck CHECK (extract(second FROM hora_de_corte) = 0),
  CONSTRAINT sesion_caja_zona_horaria_ck CHECK (zona_horaria ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$' AND char_length(zona_horaria) <= 64),
  CONSTRAINT sesion_caja_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  CONSTRAINT sesion_caja_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  -- El estado manda sobre las marcas; cada marca va con su persona.
  CONSTRAINT sesion_caja_cierre_ck CHECK (
    ((estado = 'ABIERTA') = (cierre_iniciado_en IS NULL AND cierre_iniciado_por IS NULL))
    AND (cierre_iniciado_en IS NULL) = (cierre_iniciado_por IS NULL)
    AND ((estado = 'CERRADA') = (cerrada_en IS NOT NULL AND cerrada_por IS NOT NULL))
    AND (cerrada_en IS NULL) = (cerrada_por IS NULL)
    AND (cerrada_en IS NULL OR cerrada_en >= abierta_en)
  ),
  -- Opcional, solo al cerrar (e3 §3.2): una línea de la lista de permitidos de la explicación.
  CONSTRAINT sesion_caja_observacion_ck CHECK (
    observacion IS NULL OR (
      estado = 'CERRADA' AND observacion = btrim(observacion) AND char_length(observacion) <= 500
      AND observacion ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
    )
  )
);
-- Una sola sesión no cerrada por caja (arbitra dos aperturas simultáneas).
CREATE UNIQUE INDEX sesion_caja_vigente_uk ON sesion_caja (empresa_id, caja_id) WHERE estado <> 'CERRADA';
CREATE INDEX sesion_caja_fecha_ix ON sesion_caja (empresa_id, fecha_negocio, caja_id);

CREATE FUNCTION sesion_caja_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_caja record;
  v_sucursal record;
  v_zona text;
  v_estado_de_jornada text;
BEGIN
  IF NEW.estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'una sesión de caja nace ABIERTA'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_estado_ck';
  END IF;
  IF NEW.abierta_por IS DISTINCT FROM public.app_persona_id() THEN
    RAISE EXCEPTION 'la sesión la abre la persona del contexto'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_actor_invalido';
  END IF;
  -- `FOR SHARE`: frena un `desactivar` concurrente de la caja hasta que esta transacción termine.
  SELECT c.sucursal_id, c.activa INTO v_caja
    FROM public.caja c WHERE c.id = NEW.caja_id AND c.empresa_id = NEW.empresa_id FOR SHARE;
  IF NOT FOUND OR NOT v_caja.activa THEN
    RAISE EXCEPTION 'la caja no existe o está desactivada'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_caja_inactiva';
  END IF;
  SELECT s.activa, s.hora_de_corte INTO v_sucursal
    FROM public.sucursal s WHERE s.id = v_caja.sucursal_id AND s.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR NOT v_sucursal.activa THEN
    RAISE EXCEPTION 'la sucursal está desactivada'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_sucursal_inactiva';
  END IF;
  SELECT e.zona_horaria INTO v_zona FROM public.empresa e WHERE e.id = NEW.empresa_id;
  -- C3. El sello es el vigente de la sucursal y la empresa, y la fecha sale de la fórmula.
  IF NEW.hora_de_corte IS DISTINCT FROM v_sucursal.hora_de_corte OR NEW.zona_horaria IS DISTINCT FROM v_zona THEN
    RAISE EXCEPTION 'el sello de la sesión no es la zona ni la hora de corte vigentes'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_sello_invalido';
  END IF;
  IF NEW.fecha_negocio IS DISTINCT FROM public.fecha_de_negocio(NEW.abierta_en, NEW.zona_horaria, NEW.hora_de_corte) THEN
    RAISE EXCEPTION 'la fecha de negocio no es la que da la fórmula'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_fecha_negocio_invalida';
  END IF;
  -- La jornada de esa sucursal y fecha tiene que estar ABIERTA (la crea `cierre.asegurarAbiertaEnTx` antes de insertar): con la jornada
  -- EN_AUDITORIA o CERRADA no se abre caja, y por lo tanto no se cobra. `FOR SHARE`: frena un `iniciar auditoría` concurrente.
  SELECT j.estado INTO v_estado_de_jornada
    FROM public.jornada_de_sucursal j
   WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = v_caja.sucursal_id AND j.fecha_negocio = NEW.fecha_negocio
     FOR SHARE;
  IF v_estado_de_jornada IS DISTINCT FROM 'ABIERTA' THEN
    RAISE EXCEPTION 'la jornada de la sucursal no está abierta'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_jornada_no_abierta';
  END IF;
  RETURN NEW;
END
$$;

-- Transiciones exactas (`caja-y-cobros.md` §B.2.4): ABIERTA → EN_CIERRE | CERRADA, EN_CIERRE → ABIERTA | CERRADA. CERRADA no se reabre.
CREATE FUNCTION sesion_caja_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.caja_id IS DISTINCT FROM OLD.caja_id
     OR NEW.fecha_negocio IS DISTINCT FROM OLD.fecha_negocio OR NEW.hora_de_corte IS DISTINCT FROM OLD.hora_de_corte
     OR NEW.zona_horaria IS DISTINCT FROM OLD.zona_horaria OR NEW.abierta_en IS DISTINCT FROM OLD.abierta_en
     OR NEW.abierta_por IS DISTINCT FROM OLD.abierta_por OR NEW.clave_idempotencia IS DISTINCT FROM OLD.clave_idempotencia
     OR NEW.huella IS DISTINCT FROM OLD.huella OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'el sello, la caja y la apertura de una sesión no se pueden cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_inmutable';
  END IF;

  IF OLD.estado = 'CERRADA' THEN
    RAISE EXCEPTION 'una sesión cerrada no se puede modificar'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_cerrada_congelada';
  END IF;

  IF OLD.estado = 'ABIERTA' AND NEW.estado = 'EN_CIERRE' THEN
    IF NEW.cierre_iniciado_por IS DISTINCT FROM public.app_persona_id() THEN
      RAISE EXCEPTION 'el cierre lo inicia la persona del contexto'
        USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_actor_invalido';
    END IF;
    IF NEW.observacion IS NOT NULL THEN
      RAISE EXCEPTION 'la observación se escribe al cerrar'
        USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_transicion_invalida';
    END IF;
  ELSIF OLD.estado = 'EN_CIERRE' AND NEW.estado = 'ABIERTA' THEN
    -- Cancelar el cierre: vuelve sin marcas (el CHECK lo exige).
    IF NEW.observacion IS NOT NULL THEN
      RAISE EXCEPTION 'la observación se escribe al cerrar'
        USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_transicion_invalida';
    END IF;
  ELSIF NEW.estado = 'CERRADA' AND OLD.estado IN ('ABIERTA', 'EN_CIERRE') THEN
    IF NEW.cerrada_por IS DISTINCT FROM public.app_persona_id() THEN
      RAISE EXCEPTION 'la sesión la cierra la persona del contexto'
        USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_actor_invalido';
    END IF;
    IF OLD.estado = 'EN_CIERRE' THEN
      -- Quién inició el cierre y cuándo no cambia al cerrar.
      IF NEW.cierre_iniciado_en IS DISTINCT FROM OLD.cierre_iniciado_en
         OR NEW.cierre_iniciado_por IS DISTINCT FROM OLD.cierre_iniciado_por THEN
        RAISE EXCEPTION 'al cerrar no se cambia quién ni cuándo inició el cierre'
          USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_transicion_invalida';
      END IF;
    ELSIF NEW.cierre_iniciado_en IS DISTINCT FROM NEW.cerrada_en
          OR NEW.cierre_iniciado_por IS DISTINCT FROM NEW.cerrada_por THEN
      -- Cierre directo desde ABIERTA: el inicio toma los valores del cierre.
      RAISE EXCEPTION 'en un cierre directo el inicio del cierre es el cierre'
        USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_transicion_invalida';
    END IF;
  ELSE
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER sesion_caja_alta BEFORE INSERT ON sesion_caja
  FOR EACH ROW EXECUTE FUNCTION sesion_caja_validar_alta();
CREATE TRIGGER sesion_caja_cambio BEFORE UPDATE ON sesion_caja
  FOR EACH ROW EXECUTE FUNCTION sesion_caja_validar_cambio();
CREATE TRIGGER sesion_caja_version BEFORE UPDATE ON sesion_caja
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- ---------------------------------------------------------------------------------------------
-- Movimiento de caja (solo inserción)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE movimiento_caja (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  sesion_id          uuid NOT NULL,
  clase              text NOT NULL,                -- sin DEVOLUCION (decisión 152: no hay devoluciones ni saldo a favor)
  medio_de_pago_id   uuid NOT NULL,
  cuenta_de_cobro_id uuid,
  moneda             char(3) NOT NULL DEFAULT 'ARS',
  importe            numeric(18,2) NOT NULL,       -- con signo: entra > 0, sale < 0
  motivo             text,
  anula_a            uuid,
  corrige_jornada    date,                         -- e3 §3.11.3: el ajuste que explica una jornada ya cerrada
  registrado_en      timestamptz NOT NULL,         -- el `ahora` de la aplicación, no now()
  registrado_por     uuid NOT NULL,
  clave_idempotencia text,
  huella             text,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movimiento_caja_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT movimiento_caja_sesion_fkey FOREIGN KEY (sesion_id, empresa_id) REFERENCES sesion_caja (id, empresa_id),
  CONSTRAINT movimiento_caja_medio_fkey FOREIGN KEY (medio_de_pago_id, empresa_id) REFERENCES medio_de_pago (id, empresa_id),
  CONSTRAINT movimiento_caja_cuenta_fkey FOREIGN KEY (cuenta_de_cobro_id, empresa_id) REFERENCES cuenta_de_cobro (id, empresa_id),
  CONSTRAINT movimiento_caja_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES persona (id),
  CONSTRAINT movimiento_caja_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT movimiento_caja_id_sesion_uk UNIQUE (id, empresa_id, sesion_id),
  -- La anulación es de la misma sesión, y se anula una sola vez.
  CONSTRAINT movimiento_caja_anula_fkey FOREIGN KEY (anula_a, empresa_id, sesion_id)
    REFERENCES movimiento_caja (id, empresa_id, sesion_id),
  CONSTRAINT movimiento_caja_anula_uk UNIQUE (empresa_id, anula_a),
  CONSTRAINT movimiento_caja_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT movimiento_caja_clase_ck CHECK (
    clase IN ('FONDO_INICIAL', 'COBRO', 'INGRESO_MANUAL', 'EGRESO_MANUAL', 'AJUSTE', 'ANULACION')
  ),
  CONSTRAINT movimiento_caja_moneda_ck CHECK (moneda = 'ARS'),
  -- SUPUESTO de tope (e3 Q13): la auditoría midió importes sin tope que perdían centavos.
  CONSTRAINT movimiento_caja_tope_ck CHECK (abs(importe) <= 999999999.99),
  CONSTRAINT movimiento_caja_signo_ck CHECK (
    (clase IN ('COBRO', 'INGRESO_MANUAL') AND importe > 0)
    OR (clase = 'EGRESO_MANUAL' AND importe < 0)
    OR (clase = 'FONDO_INICIAL' AND importe >= 0)
    OR (clase IN ('AJUSTE', 'ANULACION') AND importe <> 0)
  ),
  CONSTRAINT movimiento_caja_anulacion_ck CHECK ((clase = 'ANULACION') = (anula_a IS NOT NULL)),
  CONSTRAINT movimiento_caja_motivo_requerido_ck CHECK (
    clase NOT IN ('INGRESO_MANUAL', 'EGRESO_MANUAL', 'AJUSTE', 'ANULACION') OR motivo IS NOT NULL
  ),
  CONSTRAINT movimiento_caja_motivo_ck CHECK (
    motivo IS NULL OR (
      motivo = btrim(motivo) AND char_length(motivo) BETWEEN 1 AND 500
      AND motivo ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
    )
  ),
  CONSTRAINT movimiento_caja_corrige_jornada_ck CHECK (corrige_jornada IS NULL OR clase = 'AJUSTE'),
  CONSTRAINT movimiento_caja_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  CONSTRAINT movimiento_caja_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  -- El fondo no lleva clave (nace con la sesión, que la tiene); todo lo demás, clave y huella juntas.
  CONSTRAINT movimiento_caja_idempotencia_ck CHECK (
    (clase = 'FONDO_INICIAL') = (clave_idempotencia IS NULL) AND (clave_idempotencia IS NULL) = (huella IS NULL)
  )
);
CREATE UNIQUE INDEX movimiento_caja_fondo_uk ON movimiento_caja (empresa_id, sesion_id) WHERE clase = 'FONDO_INICIAL';
CREATE INDEX movimiento_caja_sesion_ix ON movimiento_caja (empresa_id, sesion_id, registrado_en, id);

CREATE FUNCTION movimiento_caja_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_sesion record;
  v_sucursal uuid;
  v_estado_de_jornada text;
  v_tipo text;
  v_original record;
  v_estado_a_corregir text;
BEGIN
  IF NEW.registrado_por IS DISTINCT FROM public.app_persona_id() THEN
    RAISE EXCEPTION 'el movimiento lo registra la persona del contexto'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_actor_invalido';
  END IF;

  -- C1. `FOR SHARE` de la sesión: `iniciar cierre` y `cerrar` (UPDATE) esperan a los movimientos en vuelo; el que llega después de
  -- un cierre ve la sesión EN_CIERRE/CERRADA. (Una CERRADA no pasa la política de UPDATE que usa el bloqueo: «no encontrada».)
  SELECT s.estado, s.caja_id, s.fecha_negocio INTO v_sesion
    FROM public.sesion_caja s WHERE s.id = NEW.sesion_id AND s.empresa_id = NEW.empresa_id FOR SHARE;
  IF NOT FOUND OR v_sesion.estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'la sesión de caja no está abierta'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_sesion_no_abierta';
  END IF;
  SELECT c.sucursal_id INTO v_sucursal
    FROM public.caja c WHERE c.id = v_sesion.caja_id AND c.empresa_id = NEW.empresa_id;

  -- Un movimiento nunca entra en una sesión cuya jornada esté EN_AUDITORIA o CERRADA (e3b §5, «cobrar contra auditar»).
  SELECT j.estado INTO v_estado_de_jornada
    FROM public.jornada_de_sucursal j
   WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = v_sucursal AND j.fecha_negocio = v_sesion.fecha_negocio
     FOR SHARE;
  IF v_estado_de_jornada IS DISTINCT FROM 'ABIERTA' THEN
    RAISE EXCEPTION 'la jornada de la sesión no está abierta'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_jornada_no_abierta';
  END IF;

  IF NEW.clase = 'ANULACION' THEN
    -- Espejo exacto de un ingreso, egreso o ajuste de la MISMA sesión (la clave foránea compuesta rechaza otra sesión). Un cobro no se
    -- anula desde caja: todo cobro tiene origen (`caja-y-cobros.md` corrección 2). La desactivación posterior de un medio o una cuenta
    -- no impide anular.
    SELECT m.clase, m.medio_de_pago_id, m.cuenta_de_cobro_id, m.importe INTO v_original
      FROM public.movimiento_caja m
     WHERE m.id = NEW.anula_a AND m.empresa_id = NEW.empresa_id AND m.sesion_id = NEW.sesion_id;
    IF NOT FOUND THEN
      RETURN NEW;                                  -- lo rechaza la clave foránea `movimiento_caja_anula_fkey`
    END IF;
    IF v_original.clase = 'COBRO' THEN
      RAISE EXCEPTION 'un cobro con origen no se anula desde caja'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_anulacion_con_origen';
    END IF;
    IF v_original.clase NOT IN ('INGRESO_MANUAL', 'EGRESO_MANUAL', 'AJUSTE')
       OR NEW.medio_de_pago_id <> v_original.medio_de_pago_id
       OR NEW.cuenta_de_cobro_id IS DISTINCT FROM v_original.cuenta_de_cobro_id
       OR NEW.importe <> -v_original.importe THEN
      RAISE EXCEPTION 'la anulación tiene que ser el espejo exacto de un ingreso, egreso o ajuste'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_anulacion_invalida';
    END IF;
    RETURN NEW;
  END IF;

  -- C4. Medio activo y cuenta (si viene) activa, de la sucursal de la caja y de un tipo que el medio admite.
  v_tipo := public.par_de_cobro_validar('movimiento_caja', NEW.empresa_id, v_sucursal, NEW.medio_de_pago_id,
                                        NEW.cuenta_de_cobro_id, true);
  -- El fondo y los ingresos y egresos manuales son solo de efectivo.
  IF NEW.clase IN ('FONDO_INICIAL', 'INGRESO_MANUAL', 'EGRESO_MANUAL') AND v_tipo <> 'EFECTIVO' THEN
    RAISE EXCEPTION 'el fondo y los ingresos y egresos manuales son solo de efectivo'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_solo_efectivo';
  END IF;

  IF NEW.corrige_jornada IS NOT NULL THEN
    -- e3 §3.11.3: la jornada que se corrige existe, está CERRADA y es anterior a la de la sesión de hoy.
    SELECT j.estado INTO v_estado_a_corregir
      FROM public.jornada_de_sucursal j
     WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = v_sucursal AND j.fecha_negocio = NEW.corrige_jornada;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'la jornada a corregir no existe'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_corrige_jornada_inexistente';
    END IF;
    IF v_estado_a_corregir <> 'CERRADA' THEN
      RAISE EXCEPTION 'la jornada a corregir no está cerrada'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_corrige_jornada_no_cerrada';
    END IF;
    IF NEW.corrige_jornada >= v_sesion.fecha_negocio THEN
      RAISE EXCEPTION 'la jornada a corregir no es anterior a la de la sesión'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_corrige_jornada_no_anterior';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Un COBRO tiene su fila en `cobro`, verificado al confirmar (la fila se inserta DESPUÉS del movimiento, en la misma transacción).
CREATE FUNCTION movimiento_caja_verificar_documento() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.clase = 'COBRO' AND NOT EXISTS (
    SELECT 1 FROM public.cobro c WHERE c.movimiento_id = NEW.id AND c.empresa_id = NEW.empresa_id
  ) THEN
    RAISE EXCEPTION 'un cobro tiene que tener su fila en cobro'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_sin_documento';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER movimiento_caja_alta BEFORE INSERT ON movimiento_caja
  FOR EACH ROW EXECUTE FUNCTION movimiento_caja_validar_alta();
CREATE TRIGGER movimiento_caja_solo_insercion BEFORE UPDATE OR DELETE ON movimiento_caja
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER movimiento_caja_sin_truncate BEFORE TRUNCATE ON movimiento_caja
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ---------------------------------------------------------------------------------------------
-- Listas del sistema (decisión 130): tabla GLOBAL, sin empresa_id (C6)
-- ---------------------------------------------------------------------------------------------
-- ICU nivel 1 no determinista: iguales si difieren solo en mayúsculas o acentos (listas.html, anexo). No depende de LC_COLLATE.
CREATE COLLATION valor_de_lista_nombre_ci (provider = icu, locale = 'und-u-ks-level1', deterministic = false);

CREATE TABLE valor_de_lista (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lista          text NOT NULL,
  nombre         text NOT NULL,
  activo         boolean NOT NULL DEFAULT true,
  fija           boolean NOT NULL DEFAULT false,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT valor_de_lista_lista_ck CHECK (lista IN ('MARCAS_DE_TARJETA', 'MOTIVOS_DE_RECHAZO')),
  CONSTRAINT valor_de_lista_nombre_ck CHECK (
    nombre = btrim(nombre) AND char_length(nombre) BETWEEN 1 AND 40
    AND nombre ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
  ),
  CONSTRAINT valor_de_lista_fija_ck CHECK (NOT fija OR activo),
  CONSTRAINT valor_de_lista_id_lista_uk UNIQUE (id, lista)
);
CREATE UNIQUE INDEX valor_de_lista_nombre_uk ON valor_de_lista (lista, nombre COLLATE valor_de_lista_nombre_ci);
-- Una sola «Otra» por lista.
CREATE UNIQUE INDEX valor_de_lista_otra_uk ON valor_de_lista (lista) WHERE fija;

-- Semillas (e3 §3.1; SUPUESTO Q14: los valores de ejemplo de `listas.html` L298-299, hasta que el dueño los confirme o corrija). Van ANTES
-- de activar la RLS: con ella forzada ni el dueño de la migración inserta. Los motivos de rechazo los usa Compras (E9).
INSERT INTO valor_de_lista (lista, nombre, fija) VALUES
  ('MARCAS_DE_TARJETA', 'Visa', false),
  ('MARCAS_DE_TARJETA', 'Mastercard', false),
  ('MARCAS_DE_TARJETA', 'American Express', false),
  ('MARCAS_DE_TARJETA', 'Cabal', false),
  ('MARCAS_DE_TARJETA', 'Naranja X', false),
  ('MARCAS_DE_TARJETA', 'Otra', true),
  ('MOTIVOS_DE_RECHAZO', 'Temperatura', false),
  ('MOTIVOS_DE_RECHAZO', 'Envase dañado', false),
  ('MOTIVOS_DE_RECHAZO', 'Vencida', false),
  ('MOTIVOS_DE_RECHAZO', 'No es lo pedido', false);

CREATE FUNCTION valor_de_lista_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.lista IS DISTINCT FROM OLD.lista OR NEW.fija IS DISTINCT FROM OLD.fija
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'la lista, el id y la marca «fija» de un valor no se pueden cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'valor_de_lista_inmutable';
  END IF;
  -- «Otra» no se renombra ni se desactiva.
  IF OLD.fija AND (NEW.nombre IS DISTINCT FROM OLD.nombre OR NEW.activo IS DISTINCT FROM OLD.activo) THEN
    RAISE EXCEPTION 'un valor fijo no se renombra ni se desactiva'
      USING ERRCODE = '23514', CONSTRAINT = 'valor_de_lista_fija';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER valor_de_lista_cambio BEFORE UPDATE ON valor_de_lista
  FOR EACH ROW EXECUTE FUNCTION valor_de_lista_validar_cambio();
CREATE TRIGGER valor_de_lista_version BEFORE UPDATE ON valor_de_lista
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- ---------------------------------------------------------------------------------------------
-- Cobro (1:1 con un movimiento COBRO; el id es el del movimiento) y sus datos opcionales (decisión 129)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE cobro (
  movimiento_id       uuid NOT NULL,
  empresa_id          uuid NOT NULL,
  origen_tipo         text NOT NULL,
  origen_id           uuid NOT NULL,
  origen_orden        smallint NOT NULL,
  cupon               text,
  ultimos4            char(4),
  marca_de_tarjeta_id uuid,
  cuotas              smallint,
  dni                 text,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  -- El id del cobro ES el de su movimiento (1:1). La clave lleva la empresa (toda única la incluye) y sirve de destino de las claves
  -- foráneas compuestas `(cobro_id, empresa_id)`.
  CONSTRAINT cobro_pkey PRIMARY KEY (empresa_id, movimiento_id),
  CONSTRAINT cobro_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT cobro_movimiento_fkey FOREIGN KEY (movimiento_id, empresa_id) REFERENCES movimiento_caja (id, empresa_id),
  CONSTRAINT cobro_marca_fkey FOREIGN KEY (marca_de_tarjeta_id) REFERENCES valor_de_lista (id),
  -- Identidad del efecto: el mismo (origen, orden) es el mismo cobro (doble clic, reintento).
  CONSTRAINT cobro_origen_uk UNIQUE (empresa_id, origen_tipo, origen_id, origen_orden),
  CONSTRAINT cobro_origen_tipo_ck CHECK (origen_tipo ~ '^[a-z_]+\.[a-z_]+$' AND char_length(origen_tipo) <= 64),
  CONSTRAINT cobro_origen_orden_ck CHECK (origen_orden BETWEEN 1 AND 50),
  -- Nunca un número de tarjeta: ni 13 dígitos seguidos, ni 13 o más una vez quitados los separadores, ni solo separadores.
  CONSTRAINT cobro_cupon_ck CHECK (
    cupon IS NULL OR (
      cupon ~ '^[A-Za-z0-9._/-]{1,32}$' AND cupon ~ '[A-Za-z0-9]'
      AND regexp_replace(cupon, '[._/-]', '', 'g') !~ '[0-9]{13}'
    )
  ),
  CONSTRAINT cobro_ultimos4_ck CHECK (ultimos4 IS NULL OR ultimos4 ~ '^[0-9]{4}$'),
  CONSTRAINT cobro_cuotas_ck CHECK (cuotas IS NULL OR cuotas BETWEEN 1 AND 36),
  CONSTRAINT cobro_dni_ck CHECK (dni IS NULL OR dni ~ '^[0-9]{6,9}$')
);

CREATE FUNCTION cobro_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_mov record;
  v_medio record;
BEGIN
  SELECT m.clase, m.medio_de_pago_id INTO v_mov
    FROM public.movimiento_caja m WHERE m.id = NEW.movimiento_id AND m.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_mov.clase <> 'COBRO' THEN
    RAISE EXCEPTION 'la fila de cobro es de un movimiento de clase COBRO'
      USING ERRCODE = '23514', CONSTRAINT = 'cobro_clase_invalida';
  END IF;
  SELECT d.pide_cupon, d.pide_ultimos4, d.pide_marca, d.pide_cuotas, d.pide_dni INTO v_medio
    FROM public.medio_de_pago d WHERE d.id = v_mov.medio_de_pago_id AND d.empresa_id = NEW.empresa_id;
  -- Cada dato presente tiene que estar habilitado en el medio del movimiento (la pantalla no lo ofrece y el servidor no lo confía).
  IF (NEW.cupon IS NOT NULL AND NOT v_medio.pide_cupon)
     OR (NEW.ultimos4 IS NOT NULL AND NOT v_medio.pide_ultimos4)
     OR (NEW.marca_de_tarjeta_id IS NOT NULL AND NOT v_medio.pide_marca)
     OR (NEW.cuotas IS NOT NULL AND NOT v_medio.pide_cuotas)
     OR (NEW.dni IS NOT NULL AND NOT v_medio.pide_dni) THEN
    RAISE EXCEPTION 'el medio de pago no habilitó ese dato'
      USING ERRCODE = '23514', CONSTRAINT = 'cobro_dato_no_habilitado';
  END IF;
  -- La marca es de la lista de marcas y está activa al cobrar (los cobros viejos conservan la que se desactivó después).
  IF NEW.marca_de_tarjeta_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.valor_de_lista v
     WHERE v.id = NEW.marca_de_tarjeta_id AND v.lista = 'MARCAS_DE_TARJETA' AND v.activo
  ) THEN
    RAISE EXCEPTION 'la marca no es una marca de tarjeta activa'
      USING ERRCODE = '23514', CONSTRAINT = 'cobro_marca_invalida';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER cobro_alta BEFORE INSERT ON cobro
  FOR EACH ROW EXECUTE FUNCTION cobro_validar_alta();
CREATE TRIGGER cobro_solo_insercion BEFORE UPDATE OR DELETE ON cobro
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER cobro_sin_truncate BEFORE TRUNCATE ON cobro
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- Después de crear `cobro`: el disparador diferido de documento.
CREATE CONSTRAINT TRIGGER movimiento_caja_documento AFTER INSERT ON movimiento_caja
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION movimiento_caja_verificar_documento();

-- ---------------------------------------------------------------------------------------------
-- Arqueo de la sesión (una línea por medio y cuenta; nace al cerrar) y su conteo de billetes
-- ---------------------------------------------------------------------------------------------
CREATE TABLE arqueo_caja (
  empresa_id         uuid NOT NULL,
  sesion_id          uuid NOT NULL,
  medio_de_pago_id   uuid NOT NULL,
  cuenta_de_cobro_id uuid,
  moneda             char(3) NOT NULL DEFAULT 'ARS',
  esperado           numeric(18,2) NOT NULL,        -- Σ de movimientos, calculado en el cierre
  contado            numeric(18,2),                 -- efectivo: Σ billetes + monedas; demás medios: el total declarado
  contado_monedas    numeric(18,2),                 -- solo la línea de EFECTIVO
  conforme           boolean NOT NULL DEFAULT false, -- decisión 164: acepta lo registrado (solo medios que no son efectivo)
  conforme_por       uuid,
  conforme_en        timestamptz,
  diferencia         numeric(18,2) GENERATED ALWAYS AS (contado - esperado) STORED,   -- NULL si conforme
  creado_en          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arqueo_caja_uk UNIQUE NULLS NOT DISTINCT (empresa_id, sesion_id, medio_de_pago_id, cuenta_de_cobro_id),
  CONSTRAINT arqueo_caja_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT arqueo_caja_sesion_fkey FOREIGN KEY (sesion_id, empresa_id) REFERENCES sesion_caja (id, empresa_id),
  CONSTRAINT arqueo_caja_medio_fkey FOREIGN KEY (medio_de_pago_id, empresa_id) REFERENCES medio_de_pago (id, empresa_id),
  CONSTRAINT arqueo_caja_cuenta_fkey FOREIGN KEY (cuenta_de_cobro_id, empresa_id) REFERENCES cuenta_de_cobro (id, empresa_id),
  CONSTRAINT arqueo_caja_conforme_por_fkey FOREIGN KEY (conforme_por) REFERENCES persona (id),
  CONSTRAINT arqueo_caja_moneda_ck CHECK (moneda = 'ARS'),
  CONSTRAINT arqueo_caja_contado_ck CHECK (contado IS NULL OR contado >= 0),
  CONSTRAINT arqueo_caja_monedas_ck CHECK (contado_monedas IS NULL OR contado_monedas >= 0),
  -- Conforme con quién y cuándo; conforme y contado se excluyen; una línea no queda «sin contar» (Q24: se declara o se da el conforme).
  CONSTRAINT arqueo_caja_conforme_ck CHECK (
    (conforme = (conforme_por IS NOT NULL AND conforme_en IS NOT NULL))
    AND (conforme_por IS NULL) = (conforme_en IS NULL)
    AND (NOT conforme OR contado IS NULL)
    AND (contado IS NOT NULL OR conforme)
  )
);

CREATE TABLE arqueo_billete (
  empresa_id   uuid NOT NULL,
  sesion_id    uuid NOT NULL,
  denominacion integer NOT NULL,
  cantidad     integer NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arqueo_billete_pkey PRIMARY KEY (empresa_id, sesion_id, denominacion),
  CONSTRAINT arqueo_billete_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT arqueo_billete_sesion_fkey FOREIGN KEY (sesion_id, empresa_id) REFERENCES sesion_caja (id, empresa_id),
  CONSTRAINT arqueo_billete_denominacion_ck CHECK (denominacion IN (20000, 10000, 2000, 1000, 500, 200, 100)),   -- Q12
  CONSTRAINT arqueo_billete_cantidad_ck CHECK (cantidad BETWEEN 0 AND 99999)
);

-- El arqueo solo se escribe al cerrar: la sesión no está CERRADA de antes (o la cierra esta misma transacción), y quien conforma es la
-- persona del contexto. El efectivo se cuenta siempre y no admite conforme; los demás medios, no llevan monedas.
CREATE FUNCTION arqueo_caja_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_sesion record;
  v_tipo text;
BEGIN
  SELECT s.estado, (s.xmin = pg_current_xact_id()::xid) AS de_esta_transaccion INTO v_sesion
    FROM public.sesion_caja s WHERE s.id = NEW.sesion_id AND s.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR (v_sesion.estado = 'CERRADA' AND NOT v_sesion.de_esta_transaccion) THEN
    RAISE EXCEPTION 'el arqueo se escribe al cerrar la sesión, no después'
      USING ERRCODE = '23514', CONSTRAINT = 'arqueo_caja_sesion_invalida';
  END IF;
  IF NEW.conforme AND NEW.conforme_por IS DISTINCT FROM public.app_persona_id() THEN
    RAISE EXCEPTION 'el conforme lo da la persona del contexto'
      USING ERRCODE = '23514', CONSTRAINT = 'arqueo_caja_actor_invalido';
  END IF;
  SELECT m.tipo INTO v_tipo FROM public.medio_de_pago m WHERE m.id = NEW.medio_de_pago_id AND m.empresa_id = NEW.empresa_id;
  IF v_tipo = 'EFECTIVO' THEN
    IF NEW.conforme THEN
      RAISE EXCEPTION 'el efectivo no admite conforme: se cuenta siempre'
        USING ERRCODE = '23514', CONSTRAINT = 'arqueo_caja_efectivo_conforme';
    END IF;
    IF NEW.contado IS NULL OR NEW.contado_monedas IS NULL OR NEW.cuenta_de_cobro_id IS NOT NULL THEN
      RAISE EXCEPTION 'el efectivo se cuenta siempre (billetes y monedas) y no lleva cuenta'
        USING ERRCODE = '23514', CONSTRAINT = 'arqueo_caja_efectivo_sin_contar';
    END IF;
  ELSIF NEW.contado_monedas IS NOT NULL THEN
    RAISE EXCEPTION 'las monedas son solo de la línea de efectivo'
      USING ERRCODE = '23514', CONSTRAINT = 'arqueo_caja_monedas_solo_efectivo';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION arqueo_billete_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_sesion record;
BEGIN
  SELECT s.estado, (s.xmin = pg_current_xact_id()::xid) AS de_esta_transaccion INTO v_sesion
    FROM public.sesion_caja s WHERE s.id = NEW.sesion_id AND s.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR (v_sesion.estado = 'CERRADA' AND NOT v_sesion.de_esta_transaccion) THEN
    RAISE EXCEPTION 'el conteo de billetes se escribe al cerrar la sesión, no después'
      USING ERRCODE = '23514', CONSTRAINT = 'arqueo_caja_sesion_invalida';
  END IF;
  RETURN NEW;
END
$$;

-- Al confirmar, la sesión del arqueo está CERRADA (no hay arqueos sueltos).
CREATE FUNCTION arqueo_verificar_sesion_cerrada() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sesion_caja s WHERE s.id = NEW.sesion_id AND s.empresa_id = NEW.empresa_id AND s.estado = 'CERRADA'
  ) THEN
    RAISE EXCEPTION 'un arqueo sin la sesión cerrada'
      USING ERRCODE = '23514', CONSTRAINT = 'arqueo_caja_sesion_invalida';
  END IF;
  RETURN NULL;
END
$$;

-- C1. La defensa final del cierre: al confirmar, el arqueo tiene una línea por cada (medio, cuenta) con movimientos más la del efectivo,
-- ninguna sobra, cada `esperado` es la Σ real RECALCULADA ahora, el efectivo cuenta lo que suman los billetes y las monedas, y el
-- conforme es de quien cerró y del instante del cierre.
CREATE FUNCTION sesion_caja_verificar_cierre() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_efectivo uuid;
  v_falta_o_sobra bigint;
  v_no_cuadra bigint;
  v_linea record;
  v_billetes numeric;
BEGIN
  SELECT m.id INTO v_efectivo FROM public.medio_de_pago m WHERE m.empresa_id = NEW.empresa_id AND m.tipo = 'EFECTIVO';

  WITH reales AS (
    SELECT mc.medio_de_pago_id AS medio, mc.cuenta_de_cobro_id AS cuenta, sum(mc.importe) AS esperado
      FROM public.movimiento_caja mc WHERE mc.empresa_id = NEW.empresa_id AND mc.sesion_id = NEW.id
     GROUP BY 1, 2
  ), esperadas AS (
    SELECT medio, cuenta, esperado FROM reales
    UNION ALL
    SELECT v_efectivo, NULL::uuid, 0::numeric
     WHERE v_efectivo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reales r WHERE r.medio = v_efectivo AND r.cuenta IS NULL)
  )
  SELECT count(*) FILTER (WHERE e.medio IS NULL OR a.medio_de_pago_id IS NULL),
         count(*) FILTER (WHERE e.medio IS NOT NULL AND a.medio_de_pago_id IS NOT NULL AND a.esperado <> e.esperado)
    INTO v_falta_o_sobra, v_no_cuadra
    FROM esperadas e
    FULL JOIN (SELECT * FROM public.arqueo_caja ac WHERE ac.empresa_id = NEW.empresa_id AND ac.sesion_id = NEW.id) a
      ON a.medio_de_pago_id = e.medio AND a.cuenta_de_cobro_id IS NOT DISTINCT FROM e.cuenta;
  IF v_falta_o_sobra > 0 THEN
    RAISE EXCEPTION 'el arqueo no tiene exactamente una línea por cada medio y cuenta con movimientos, más la del efectivo'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_arqueo_incompleto';
  END IF;
  IF v_no_cuadra > 0 THEN
    RAISE EXCEPTION 'el esperado de una línea del arqueo no es la suma real de los movimientos'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_arqueo_no_cuadra';
  END IF;

  -- El efectivo: contado = Σ(denominación × cantidad) + monedas.
  SELECT a.contado, a.contado_monedas INTO v_linea
    FROM public.arqueo_caja a
   WHERE a.empresa_id = NEW.empresa_id AND a.sesion_id = NEW.id AND a.medio_de_pago_id = v_efectivo AND a.cuenta_de_cobro_id IS NULL;
  SELECT coalesce(sum(b.denominacion::numeric * b.cantidad), 0) INTO v_billetes
    FROM public.arqueo_billete b WHERE b.empresa_id = NEW.empresa_id AND b.sesion_id = NEW.id;
  IF v_linea.contado IS DISTINCT FROM v_billetes + coalesce(v_linea.contado_monedas, 0) THEN
    RAISE EXCEPTION 'el efectivo contado no es la suma de los billetes y las monedas'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_conteo_no_cuadra';
  END IF;

  -- El conforme es de quien cerró la sesión y del instante del cierre.
  IF EXISTS (
    SELECT 1 FROM public.arqueo_caja a
     WHERE a.empresa_id = NEW.empresa_id AND a.sesion_id = NEW.id AND a.conforme
       AND (a.conforme_por IS DISTINCT FROM NEW.cerrada_por OR a.conforme_en IS DISTINCT FROM NEW.cerrada_en)
  ) THEN
    RAISE EXCEPTION 'el conforme es de quien cerró la sesión y del instante del cierre'
      USING ERRCODE = '23514', CONSTRAINT = 'sesion_caja_conforme_invalido';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER arqueo_caja_alta BEFORE INSERT ON arqueo_caja
  FOR EACH ROW EXECUTE FUNCTION arqueo_caja_validar_alta();
CREATE TRIGGER arqueo_caja_solo_insercion BEFORE UPDATE OR DELETE ON arqueo_caja
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER arqueo_caja_sin_truncate BEFORE TRUNCATE ON arqueo_caja
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE CONSTRAINT TRIGGER arqueo_caja_sesion_cerrada AFTER INSERT ON arqueo_caja
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION arqueo_verificar_sesion_cerrada();

CREATE TRIGGER arqueo_billete_alta BEFORE INSERT ON arqueo_billete
  FOR EACH ROW EXECUTE FUNCTION arqueo_billete_validar_alta();
CREATE TRIGGER arqueo_billete_solo_insercion BEFORE UPDATE OR DELETE ON arqueo_billete
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER arqueo_billete_sin_truncate BEFORE TRUNCATE ON arqueo_billete
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE CONSTRAINT TRIGGER arqueo_billete_sesion_cerrada AFTER INSERT ON arqueo_billete
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION arqueo_verificar_sesion_cerrada();

-- Cierra la sesión: al confirmar, el arqueo está completo y cuadra. Solo cuando la sesión PASA a CERRADA.
CREATE CONSTRAINT TRIGGER sesion_caja_cierre_completo AFTER UPDATE ON sesion_caja
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.estado <> 'CERRADA' AND NEW.estado = 'CERRADA')
  EXECUTE FUNCTION sesion_caja_verificar_cierre();

-- ---------------------------------------------------------------------------------------------
-- La contribución de caja al cierre del día (e3b §4.3, §4.4 y §4.6)
-- ---------------------------------------------------------------------------------------------

-- Corrección de medio de un cobro (cualquier medio a cualquier otro): registro NUEVO; el cobro original no se toca.
CREATE TABLE correccion_de_medio (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),   -- la salida de `corregirMedioDeCobro` lleva `correccionId`
  empresa_id          uuid NOT NULL,
  cobro_id            uuid NOT NULL,
  secuencia           smallint NOT NULL,
  sucursal_id         uuid NOT NULL,                             -- los de la sesión del cobro (copia sellada)
  fecha_negocio       date NOT NULL,
  medio_antes_id      uuid NOT NULL,
  cuenta_antes_id     uuid,
  medio_despues_id    uuid NOT NULL,
  cuenta_despues_id   uuid,
  motivo              text NOT NULL,
  corregido_en        timestamptz NOT NULL,
  corregido_por       uuid NOT NULL,
  clave_idempotencia  text NOT NULL,
  huella              text NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  -- Arbitra dos correcciones simultáneas del mismo cobro: una gana y la otra pierde por clave duplicada.
  CONSTRAINT correccion_de_medio_pkey PRIMARY KEY (empresa_id, cobro_id, secuencia),
  CONSTRAINT correccion_de_medio_id_uk UNIQUE (empresa_id, id),
  CONSTRAINT correccion_de_medio_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT correccion_de_medio_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT correccion_de_medio_cobro_fkey FOREIGN KEY (cobro_id, empresa_id) REFERENCES cobro (movimiento_id, empresa_id),
  CONSTRAINT correccion_de_medio_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT correccion_de_medio_jornada_fkey FOREIGN KEY (empresa_id, sucursal_id, fecha_negocio)
    REFERENCES jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio),
  CONSTRAINT correccion_de_medio_antes_fkey FOREIGN KEY (medio_antes_id, empresa_id) REFERENCES medio_de_pago (id, empresa_id),
  CONSTRAINT correccion_de_medio_cuenta_antes_fkey FOREIGN KEY (cuenta_antes_id, empresa_id) REFERENCES cuenta_de_cobro (id, empresa_id),
  CONSTRAINT correccion_de_medio_despues_fkey FOREIGN KEY (medio_despues_id, empresa_id) REFERENCES medio_de_pago (id, empresa_id),
  CONSTRAINT correccion_de_medio_cuenta_despues_fkey FOREIGN KEY (cuenta_despues_id, empresa_id) REFERENCES cuenta_de_cobro (id, empresa_id),
  CONSTRAINT correccion_de_medio_corregido_por_fkey FOREIGN KEY (corregido_por) REFERENCES persona (id),
  CONSTRAINT correccion_de_medio_secuencia_ck CHECK (secuencia >= 1),
  CONSTRAINT correccion_de_medio_cambia_ck CHECK (
    (medio_antes_id, cuenta_antes_id) IS DISTINCT FROM (medio_despues_id, cuenta_despues_id)
  ),
  CONSTRAINT correccion_de_medio_motivo_ck CHECK (
    motivo = btrim(motivo) AND char_length(motivo) BETWEEN 1 AND 500
    AND motivo ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
  ),
  CONSTRAINT correccion_de_medio_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  CONSTRAINT correccion_de_medio_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$')
);
CREATE INDEX correccion_de_medio_jornada_ix ON correccion_de_medio (empresa_id, sucursal_id, fecha_negocio);

CREATE FUNCTION correccion_de_medio_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_cobro record;
  v_sesion record;
  v_estado_de_jornada text;
  v_previa record;
  v_secuencia_vigente integer;
  v_medio_vigente uuid;
  v_cuenta_vigente uuid;
BEGIN
  IF NEW.corregido_por IS DISTINCT FROM public.app_persona_id() THEN
    RAISE EXCEPTION 'la corrección la registra la persona del contexto'
      USING ERRCODE = '23514', CONSTRAINT = 'correccion_de_medio_actor_invalido';
  END IF;
  -- La sucursal y la fecha son las de la sesión del cobro (copia sellada).
  SELECT m.sesion_id, m.medio_de_pago_id, m.cuenta_de_cobro_id INTO v_cobro
    FROM public.movimiento_caja m WHERE m.id = NEW.cobro_id AND m.empresa_id = NEW.empresa_id AND m.clase = 'COBRO';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la corrección es de un cobro'
      USING ERRCODE = '23514', CONSTRAINT = 'correccion_de_medio_cobro_invalido';
  END IF;
  SELECT s.fecha_negocio, c.sucursal_id INTO v_sesion
    FROM public.sesion_caja s JOIN public.caja c ON c.id = s.caja_id AND c.empresa_id = s.empresa_id
   WHERE s.id = v_cobro.sesion_id AND s.empresa_id = NEW.empresa_id;
  IF NEW.sucursal_id IS DISTINCT FROM v_sesion.sucursal_id OR NEW.fecha_negocio IS DISTINCT FROM v_sesion.fecha_negocio THEN
    RAISE EXCEPTION 'la sucursal y la fecha de la corrección son las de la sesión del cobro'
      USING ERRCODE = '23514', CONSTRAINT = 'correccion_de_medio_jornada_invalida';
  END IF;
  -- Solo con la jornada EN_AUDITORIA. `FOR SHARE`: el cierre (que la toma FOR UPDATE) espera a las correcciones en vuelo, y las que
  -- llegan después lo encuentran CERRADO.
  SELECT j.estado INTO v_estado_de_jornada
    FROM public.jornada_de_sucursal j
   WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = NEW.sucursal_id AND j.fecha_negocio = NEW.fecha_negocio
     FOR SHARE;
  IF v_estado_de_jornada IS DISTINCT FROM 'EN_AUDITORIA' THEN
    RAISE EXCEPTION 'la jornada no está en auditoría'
      USING ERRCODE = '23514', CONSTRAINT = 'correccion_de_medio_jornada_no_en_auditoria';
  END IF;
  -- «Antes» es el medio VIGENTE (el original, o el destino de la corrección anterior) y la secuencia sigue sin huecos.
  SELECT k.secuencia, k.medio_despues_id, k.cuenta_despues_id INTO v_previa
    FROM public.correccion_de_medio k WHERE k.empresa_id = NEW.empresa_id AND k.cobro_id = NEW.cobro_id
   ORDER BY k.secuencia DESC LIMIT 1;
  IF FOUND THEN
    v_secuencia_vigente := v_previa.secuencia;
    v_medio_vigente := v_previa.medio_despues_id;
    v_cuenta_vigente := v_previa.cuenta_despues_id;
  ELSE
    v_secuencia_vigente := 0;
    v_medio_vigente := v_cobro.medio_de_pago_id;
    v_cuenta_vigente := v_cobro.cuenta_de_cobro_id;
  END IF;
  IF NEW.secuencia <> v_secuencia_vigente + 1 THEN
    RAISE EXCEPTION 'la secuencia de correcciones del cobro sigue sin huecos'
      USING ERRCODE = '23514', CONSTRAINT = 'correccion_de_medio_secuencia_invalida';
  END IF;
  IF NEW.medio_antes_id <> v_medio_vigente OR NEW.cuenta_antes_id IS DISTINCT FROM v_cuenta_vigente THEN
    RAISE EXCEPTION 'el medio «antes» no es el vigente del cobro'
      USING ERRCODE = '23514', CONSTRAINT = 'correccion_de_medio_antes_no_vigente';
  END IF;
  -- C4. El destino: medio y cuenta activos y compatibles, de la sucursal.
  PERFORM public.par_de_cobro_validar('correccion_de_medio', NEW.empresa_id, NEW.sucursal_id, NEW.medio_despues_id,
                                      NEW.cuenta_despues_id, true);
  RETURN NEW;
END
$$;

CREATE TRIGGER correccion_de_medio_alta BEFORE INSERT ON correccion_de_medio
  FOR EACH ROW EXECUTE FUNCTION correccion_de_medio_validar_alta();
CREATE TRIGGER correccion_de_medio_solo_insercion BEFORE UPDATE OR DELETE ON correccion_de_medio
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER correccion_de_medio_sin_truncate BEFORE TRUNCATE ON correccion_de_medio
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- Total declarado por medio y cuenta (solo los que no son efectivo). Vigente = la de mayor secuencia.
CREATE TABLE declaracion_de_total (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),   -- la salida de `declararTotal` lleva `declaracionId`
  empresa_id         uuid NOT NULL,
  sucursal_id        uuid NOT NULL,
  fecha_negocio      date NOT NULL,
  medio_de_pago_id   uuid NOT NULL,
  cuenta_de_cobro_id uuid,
  secuencia          smallint NOT NULL,
  moneda             char(3) NOT NULL DEFAULT 'ARS',
  importe            numeric(18,2) NOT NULL,
  declarado_en       timestamptz NOT NULL,
  declarado_por      uuid NOT NULL,
  clave_idempotencia text NOT NULL,
  huella             text NOT NULL,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declaracion_de_total_par_uk UNIQUE NULLS NOT DISTINCT
    (empresa_id, sucursal_id, fecha_negocio, medio_de_pago_id, cuenta_de_cobro_id, secuencia),
  CONSTRAINT declaracion_de_total_id_uk UNIQUE (empresa_id, id),
  CONSTRAINT declaracion_de_total_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT declaracion_de_total_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT declaracion_de_total_jornada_fkey FOREIGN KEY (empresa_id, sucursal_id, fecha_negocio)
    REFERENCES jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio),
  CONSTRAINT declaracion_de_total_medio_fkey FOREIGN KEY (medio_de_pago_id, empresa_id) REFERENCES medio_de_pago (id, empresa_id),
  CONSTRAINT declaracion_de_total_cuenta_fkey FOREIGN KEY (cuenta_de_cobro_id, empresa_id) REFERENCES cuenta_de_cobro (id, empresa_id),
  CONSTRAINT declaracion_de_total_declarado_por_fkey FOREIGN KEY (declarado_por) REFERENCES persona (id),
  CONSTRAINT declaracion_de_total_secuencia_ck CHECK (secuencia >= 1),
  CONSTRAINT declaracion_de_total_moneda_ck CHECK (moneda = 'ARS'),
  CONSTRAINT declaracion_de_total_importe_ck CHECK (importe >= 0 AND importe <= 999999999.99),
  CONSTRAINT declaracion_de_total_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  CONSTRAINT declaracion_de_total_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$')
);

CREATE FUNCTION declaracion_de_total_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado_de_jornada text;
  v_tipo text;
  v_ultima smallint;
BEGIN
  IF NEW.declarado_por IS DISTINCT FROM public.app_persona_id() THEN
    RAISE EXCEPTION 'la declaración la registra la persona del contexto'
      USING ERRCODE = '23514', CONSTRAINT = 'declaracion_de_total_actor_invalido';
  END IF;
  SELECT j.estado INTO v_estado_de_jornada
    FROM public.jornada_de_sucursal j
   WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = NEW.sucursal_id AND j.fecha_negocio = NEW.fecha_negocio
     FOR SHARE;
  IF v_estado_de_jornada IS DISTINCT FROM 'EN_AUDITORIA' THEN
    RAISE EXCEPTION 'la jornada no está en auditoría'
      USING ERRCODE = '23514', CONSTRAINT = 'declaracion_de_total_jornada_no_en_auditoria';
  END IF;
  -- El medio y la cuenta existen y son compatibles y de la sucursal; no se exige que sigan activos (el par pudo tener actividad).
  v_tipo := public.par_de_cobro_validar('declaracion_de_total', NEW.empresa_id, NEW.sucursal_id, NEW.medio_de_pago_id,
                                        NEW.cuenta_de_cobro_id, false);
  IF v_tipo = 'EFECTIVO' THEN
    RAISE EXCEPTION 'el efectivo no se declara: se cuenta por billetes al cerrar cada caja'
      USING ERRCODE = '23514', CONSTRAINT = 'declaracion_de_total_medio_no_declarable';
  END IF;
  -- Otra declaración del mismo par es una fila nueva (`secuencia + 1`), sin huecos.
  SELECT coalesce(max(d.secuencia), 0) INTO v_ultima
    FROM public.declaracion_de_total d
   WHERE d.empresa_id = NEW.empresa_id AND d.sucursal_id = NEW.sucursal_id AND d.fecha_negocio = NEW.fecha_negocio
     AND d.medio_de_pago_id = NEW.medio_de_pago_id AND d.cuenta_de_cobro_id IS NOT DISTINCT FROM NEW.cuenta_de_cobro_id;
  IF NEW.secuencia <> v_ultima + 1 THEN
    RAISE EXCEPTION 'la secuencia de declaraciones del par sigue sin huecos'
      USING ERRCODE = '23514', CONSTRAINT = 'declaracion_de_total_secuencia_invalida';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER declaracion_de_total_alta BEFORE INSERT ON declaracion_de_total
  FOR EACH ROW EXECUTE FUNCTION declaracion_de_total_validar_alta();
CREATE TRIGGER declaracion_de_total_solo_insercion BEFORE UPDATE OR DELETE ON declaracion_de_total
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER declaracion_de_total_sin_truncate BEFORE TRUNCATE ON declaracion_de_total
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- «Conforme general» de los medios que no son efectivo (decisión 164): una sola por jornada; repetirlo es idempotente.
CREATE TABLE conforme_de_jornada (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),   -- la salida de `darConformeGeneral` lleva `conformeId`
  empresa_id         uuid NOT NULL,
  sucursal_id        uuid NOT NULL,
  fecha_negocio      date NOT NULL,
  conforme_por       uuid NOT NULL,
  conforme_en        timestamptz NOT NULL,
  clave_idempotencia text NOT NULL,
  huella             text NOT NULL,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conforme_de_jornada_pkey PRIMARY KEY (empresa_id, sucursal_id, fecha_negocio),
  CONSTRAINT conforme_de_jornada_id_uk UNIQUE (empresa_id, id),
  CONSTRAINT conforme_de_jornada_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT conforme_de_jornada_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT conforme_de_jornada_jornada_fkey FOREIGN KEY (empresa_id, sucursal_id, fecha_negocio)
    REFERENCES jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio),
  CONSTRAINT conforme_de_jornada_por_fkey FOREIGN KEY (conforme_por) REFERENCES persona (id),
  CONSTRAINT conforme_de_jornada_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  CONSTRAINT conforme_de_jornada_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$')
);

CREATE FUNCTION conforme_de_jornada_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado_de_jornada text;
BEGIN
  IF NEW.conforme_por IS DISTINCT FROM public.app_persona_id() THEN
    RAISE EXCEPTION 'el conforme lo da la persona del contexto'
      USING ERRCODE = '23514', CONSTRAINT = 'conforme_de_jornada_actor_invalido';
  END IF;
  SELECT j.estado INTO v_estado_de_jornada
    FROM public.jornada_de_sucursal j
   WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = NEW.sucursal_id AND j.fecha_negocio = NEW.fecha_negocio
     FOR SHARE;
  IF v_estado_de_jornada IS DISTINCT FROM 'EN_AUDITORIA' THEN
    RAISE EXCEPTION 'la jornada no está en auditoría'
      USING ERRCODE = '23514', CONSTRAINT = 'conforme_de_jornada_jornada_no_en_auditoria';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER conforme_de_jornada_alta BEFORE INSERT ON conforme_de_jornada
  FOR EACH ROW EXECUTE FUNCTION conforme_de_jornada_validar_alta();
CREATE TRIGGER conforme_de_jornada_solo_insercion BEFORE UPDATE OR DELETE ON conforme_de_jornada
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER conforme_de_jornada_sin_truncate BEFORE TRUNCATE ON conforme_de_jornada
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- C5. Cabecera de lo que caja congeló al cerrar la jornada; su diferido verifica las líneas.
CREATE TABLE cierre_de_caja_de_jornada (
  empresa_id    uuid NOT NULL,
  sucursal_id   uuid NOT NULL,
  fecha_negocio date NOT NULL,
  congelado_en  timestamptz NOT NULL,
  congelado_por uuid NOT NULL,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cierre_de_caja_de_jornada_pkey PRIMARY KEY (empresa_id, sucursal_id, fecha_negocio),
  CONSTRAINT cierre_de_caja_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT cierre_de_caja_jornada_fkey FOREIGN KEY (empresa_id, sucursal_id, fecha_negocio)
    REFERENCES jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio),
  CONSTRAINT cierre_de_caja_congelado_por_fkey FOREIGN KEY (congelado_por) REFERENCES persona (id)
);

-- Una línea por (medio, cuenta); inmutable.
CREATE TABLE conciliacion_de_jornada (
  empresa_id         uuid NOT NULL,
  sucursal_id        uuid NOT NULL,
  fecha_negocio      date NOT NULL,
  medio_de_pago_id   uuid NOT NULL,
  cuenta_de_cobro_id uuid,                                      -- NULL = «sin cuenta» (decisión 151)
  moneda             char(3) NOT NULL DEFAULT 'ARS',
  registrado         numeric(18,2) NOT NULL,
  correcciones       numeric(18,2) NOT NULL,
  declarado          numeric(18,2),                              -- NULL si CONFORME o SIN_DATO
  estado_de_conteo   text NOT NULL,                              -- efectivo: CONTADO; no efectivo: el resto
  conforme_por       uuid,
  conforme_en        timestamptz,
  diferencia         numeric(18,2) GENERATED ALWAYS AS (
    CASE WHEN estado_de_conteo IN ('CONTADO', 'DECLARADO') THEN declarado - (registrado + correcciones) END
  ) STORED,
  explicacion        text,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conciliacion_de_jornada_uk UNIQUE NULLS NOT DISTINCT
    (empresa_id, sucursal_id, fecha_negocio, medio_de_pago_id, cuenta_de_cobro_id),
  CONSTRAINT conciliacion_de_jornada_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT conciliacion_de_jornada_cabecera_fkey FOREIGN KEY (empresa_id, sucursal_id, fecha_negocio)
    REFERENCES cierre_de_caja_de_jornada (empresa_id, sucursal_id, fecha_negocio),
  CONSTRAINT conciliacion_de_jornada_medio_fkey FOREIGN KEY (medio_de_pago_id, empresa_id) REFERENCES medio_de_pago (id, empresa_id),
  CONSTRAINT conciliacion_de_jornada_cuenta_fkey FOREIGN KEY (cuenta_de_cobro_id, empresa_id) REFERENCES cuenta_de_cobro (id, empresa_id),
  CONSTRAINT conciliacion_de_jornada_conforme_por_fkey FOREIGN KEY (conforme_por) REFERENCES persona (id),
  CONSTRAINT conciliacion_de_jornada_moneda_ck CHECK (moneda = 'ARS'),
  CONSTRAINT conciliacion_de_jornada_estado_ck CHECK (estado_de_conteo IN ('CONTADO', 'DECLARADO', 'CONFORME', 'SIN_DATO')),
  -- El estado manda sobre el declarado y el conforme (dec. 164): CONFORME lleva quién y cuándo y ningún importe; SIN_DATO, nada.
  CONSTRAINT conciliacion_de_jornada_datos_ck CHECK (
    (estado_de_conteo IN ('CONTADO', 'DECLARADO') AND declarado IS NOT NULL AND declarado >= 0
       AND conforme_por IS NULL AND conforme_en IS NULL)
    OR (estado_de_conteo = 'CONFORME' AND declarado IS NULL AND conforme_por IS NOT NULL AND conforme_en IS NOT NULL)
    OR (estado_de_conteo = 'SIN_DATO' AND declarado IS NULL AND conforme_por IS NULL AND conforme_en IS NULL)
  ),
  CONSTRAINT conciliacion_de_jornada_explicacion_ck CHECK (
    explicacion IS NULL OR (
      explicacion = btrim(explicacion) AND char_length(explicacion) BETWEEN 1 AND 500
      AND explicacion ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
    )
  )
);

-- Solo los orígenes con diferencia ≠ 0 (cobrado contra el total del ticket); nace al congelar; inmutable.
CREATE TABLE conciliacion_de_cobro_por_origen (
  empresa_id       uuid NOT NULL,
  sucursal_id      uuid NOT NULL,
  fecha_negocio    date NOT NULL,
  origen_tipo      text NOT NULL,
  origen_id        uuid NOT NULL,
  ticket_id        uuid NOT NULL,                               -- opaco
  moneda           char(3) NOT NULL DEFAULT 'ARS',
  cobrado          numeric(18,2) NOT NULL,
  total_del_ticket numeric(18,2) NOT NULL,
  diferencia       numeric(18,2) GENERATED ALWAYS AS (cobrado - total_del_ticket) STORED,
  explicacion      text,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conciliacion_de_cobro_por_origen_pkey PRIMARY KEY (empresa_id, sucursal_id, fecha_negocio, origen_tipo, origen_id),
  CONSTRAINT conciliacion_de_cobro_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT conciliacion_de_cobro_cabecera_fkey FOREIGN KEY (empresa_id, sucursal_id, fecha_negocio)
    REFERENCES cierre_de_caja_de_jornada (empresa_id, sucursal_id, fecha_negocio),
  CONSTRAINT conciliacion_de_cobro_moneda_ck CHECK (moneda = 'ARS'),
  CONSTRAINT conciliacion_de_cobro_origen_ck CHECK (origen_tipo ~ '^[a-z_]+\.[a-z_]+$' AND char_length(origen_tipo) <= 64),
  CONSTRAINT conciliacion_de_cobro_total_ck CHECK (total_del_ticket >= 0),
  CONSTRAINT conciliacion_de_cobro_difiere_ck CHECK (cobrado <> total_del_ticket),
  CONSTRAINT conciliacion_de_cobro_explicacion_ck CHECK (
    explicacion IS NULL OR (
      explicacion = btrim(explicacion) AND char_length(explicacion) BETWEEN 1 AND 500
      AND explicacion ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
    )
  )
);

-- C5. La foto solo entra mientras la jornada está EN_AUDITORIA (el cierre la tiene bloqueada) o en la transacción que la cierra, y
-- la cabecera la escribe quien cierra la jornada.
CREATE FUNCTION cierre_de_caja_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.congelado_por IS DISTINCT FROM public.app_persona_id() THEN
    RAISE EXCEPTION 'la foto la congela la persona del contexto'
      USING ERRCODE = '23514', CONSTRAINT = 'cierre_de_caja_actor_invalido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.jornada_de_sucursal j
     WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = NEW.sucursal_id AND j.fecha_negocio = NEW.fecha_negocio
       AND (j.estado = 'EN_AUDITORIA' OR (j.estado = 'CERRADA' AND j.xmin = pg_current_xact_id()::xid))
  ) THEN
    RAISE EXCEPTION 'la foto de caja solo se guarda al cerrar la jornada, en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'cierre_de_caja_solo_al_cerrar';
  END IF;
  RETURN NEW;
END
$$;

-- Las líneas son de la cabecera de ESTA transacción (no se agregan líneas a una foto de antes).
CREATE FUNCTION conciliacion_de_jornada_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_tipo text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.cierre_de_caja_de_jornada c
     WHERE c.empresa_id = NEW.empresa_id AND c.sucursal_id = NEW.sucursal_id AND c.fecha_negocio = NEW.fecha_negocio
       AND c.xmin = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'las líneas de la foto de caja solo se guardan junto con su cabecera, en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'cierre_de_caja_solo_al_cerrar';
  END IF;
  -- El efectivo es siempre CONTADO y los demás medios nunca.
  SELECT m.tipo INTO v_tipo FROM public.medio_de_pago m WHERE m.id = NEW.medio_de_pago_id AND m.empresa_id = NEW.empresa_id;
  IF (v_tipo = 'EFECTIVO') IS DISTINCT FROM (NEW.estado_de_conteo = 'CONTADO') THEN
    RAISE EXCEPTION 'el efectivo es siempre CONTADO y los demás medios nunca'
      USING ERRCODE = '23514', CONSTRAINT = 'conciliacion_de_jornada_conteo_invalido';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION conciliacion_de_cobro_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.cierre_de_caja_de_jornada c
     WHERE c.empresa_id = NEW.empresa_id AND c.sucursal_id = NEW.sucursal_id AND c.fecha_negocio = NEW.fecha_negocio
       AND c.xmin = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'las líneas de la foto de caja solo se guardan junto con su cabecera, en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'cierre_de_caja_solo_al_cerrar';
  END IF;
  RETURN NEW;
END
$$;

-- Al confirmar: la jornada quedó CERRADA en esta transacción y la foto cuadra con lo que hay (e3b §4.4 y §4.6). Recalcula, por
-- (medio, cuenta): lo registrado, las correcciones, el declarado y el estado de conteo, en este orden de prioridad: declaración vigente,
-- conforme general de la jornada, lo derivado de los cierres de caja de las sesiones, sin dato.
CREATE FUNCTION cierre_de_caja_verificar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_faltan bigint;
  v_difieren bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.jornada_de_sucursal j
     WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = NEW.sucursal_id AND j.fecha_negocio = NEW.fecha_negocio
       AND j.estado = 'CERRADA' AND j.xmin = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'la foto de caja se guarda con la jornada pasando a CERRADA en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'cierre_de_caja_solo_al_cerrar';
  END IF;

  WITH sesiones AS (
    SELECT s.id FROM public.sesion_caja s JOIN public.caja c ON c.id = s.caja_id AND c.empresa_id = s.empresa_id
     WHERE s.empresa_id = NEW.empresa_id AND c.sucursal_id = NEW.sucursal_id AND s.fecha_negocio = NEW.fecha_negocio
  ), registrado AS (
    SELECT m.medio_de_pago_id AS medio, m.cuenta_de_cobro_id AS cuenta, sum(m.importe) AS importe
      FROM public.movimiento_caja m JOIN sesiones s ON s.id = m.sesion_id
     WHERE m.empresa_id = NEW.empresa_id GROUP BY 1, 2
  ), efectos AS (
    SELECT k.medio_antes_id AS medio, k.cuenta_antes_id AS cuenta, -m.importe AS importe
      FROM public.correccion_de_medio k JOIN public.movimiento_caja m ON m.id = k.cobro_id AND m.empresa_id = k.empresa_id
     WHERE k.empresa_id = NEW.empresa_id AND k.sucursal_id = NEW.sucursal_id AND k.fecha_negocio = NEW.fecha_negocio
    UNION ALL
    SELECT k.medio_despues_id, k.cuenta_despues_id, m.importe
      FROM public.correccion_de_medio k JOIN public.movimiento_caja m ON m.id = k.cobro_id AND m.empresa_id = k.empresa_id
     WHERE k.empresa_id = NEW.empresa_id AND k.sucursal_id = NEW.sucursal_id AND k.fecha_negocio = NEW.fecha_negocio
  ), correcciones AS (
    SELECT medio, cuenta, sum(importe) AS importe FROM efectos GROUP BY 1, 2
  ), declaraciones AS (
    SELECT DISTINCT ON (d.medio_de_pago_id, d.cuenta_de_cobro_id)
           d.medio_de_pago_id AS medio, d.cuenta_de_cobro_id AS cuenta, d.importe
      FROM public.declaracion_de_total d
     WHERE d.empresa_id = NEW.empresa_id AND d.sucursal_id = NEW.sucursal_id AND d.fecha_negocio = NEW.fecha_negocio
     ORDER BY d.medio_de_pago_id, d.cuenta_de_cobro_id, d.secuencia DESC
  ), conforme_general AS (
    SELECT g.conforme_por, g.conforme_en FROM public.conforme_de_jornada g
     WHERE g.empresa_id = NEW.empresa_id AND g.sucursal_id = NEW.sucursal_id AND g.fecha_negocio = NEW.fecha_negocio
  ), cierres AS (
    SELECT a.medio_de_pago_id AS medio, a.cuenta_de_cobro_id AS cuenta,
           count(*) AS lineas, count(*) FILTER (WHERE a.conforme) AS conformes, sum(a.contado) AS contado,
           (array_agg(a.conforme_por ORDER BY a.conforme_en DESC) FILTER (WHERE a.conforme))[1] AS conforme_por,
           max(a.conforme_en) AS conforme_en
      FROM public.arqueo_caja a JOIN sesiones s ON s.id = a.sesion_id
     WHERE a.empresa_id = NEW.empresa_id GROUP BY 1, 2
  ), pares AS (
    SELECT medio, cuenta FROM registrado UNION SELECT medio, cuenta FROM correcciones UNION SELECT medio, cuenta FROM declaraciones
  ), esperadas AS (
    SELECT p.medio, p.cuenta,
           coalesce(r.importe, 0) AS registrado, coalesce(c.importe, 0) AS correcciones,
           CASE
             WHEN me.tipo = 'EFECTIVO' THEN 'CONTADO'
             WHEN d.medio IS NOT NULL THEN 'DECLARADO'
             WHEN (SELECT count(*) FROM conforme_general) > 0 THEN 'CONFORME'
             WHEN ci.lineas > 0 AND ci.conformes = 0 THEN 'DECLARADO'
             WHEN ci.lineas > 0 AND ci.conformes = ci.lineas THEN 'CONFORME'
             ELSE 'SIN_DATO'
           END AS estado,
           CASE
             WHEN me.tipo = 'EFECTIVO' THEN ci.contado
             WHEN d.medio IS NOT NULL THEN d.importe
             WHEN (SELECT count(*) FROM conforme_general) > 0 THEN NULL
             WHEN ci.lineas > 0 AND ci.conformes = 0 THEN ci.contado
             ELSE NULL
           END AS declarado,
           CASE
             WHEN me.tipo = 'EFECTIVO' OR d.medio IS NOT NULL THEN NULL
             WHEN (SELECT count(*) FROM conforme_general) > 0 THEN (SELECT g.conforme_por FROM conforme_general g)
             WHEN ci.lineas > 0 AND ci.conformes = ci.lineas THEN ci.conforme_por
           END AS conforme_por,
           CASE
             WHEN me.tipo = 'EFECTIVO' OR d.medio IS NOT NULL THEN NULL
             WHEN (SELECT count(*) FROM conforme_general) > 0 THEN (SELECT g.conforme_en FROM conforme_general g)
             WHEN ci.lineas > 0 AND ci.conformes = ci.lineas THEN ci.conforme_en
           END AS conforme_en
      FROM pares p
      JOIN public.medio_de_pago me ON me.id = p.medio AND me.empresa_id = NEW.empresa_id
      LEFT JOIN registrado r ON r.medio = p.medio AND r.cuenta IS NOT DISTINCT FROM p.cuenta
      LEFT JOIN correcciones c ON c.medio = p.medio AND c.cuenta IS NOT DISTINCT FROM p.cuenta
      LEFT JOIN declaraciones d ON d.medio = p.medio AND d.cuenta IS NOT DISTINCT FROM p.cuenta
      LEFT JOIN cierres ci ON ci.medio = p.medio AND ci.cuenta IS NOT DISTINCT FROM p.cuenta
  ), guardadas AS (
    SELECT * FROM public.conciliacion_de_jornada g
     WHERE g.empresa_id = NEW.empresa_id AND g.sucursal_id = NEW.sucursal_id AND g.fecha_negocio = NEW.fecha_negocio
  )
  SELECT count(*) FILTER (WHERE e.medio IS NULL OR g.medio_de_pago_id IS NULL),
         count(*) FILTER (WHERE e.medio IS NOT NULL AND g.medio_de_pago_id IS NOT NULL AND (
                 g.registrado <> e.registrado OR g.correcciones <> e.correcciones
                 OR g.declarado IS DISTINCT FROM e.declarado OR g.estado_de_conteo <> e.estado
                 OR g.conforme_por IS DISTINCT FROM e.conforme_por OR g.conforme_en IS DISTINCT FROM e.conforme_en))
    INTO v_faltan, v_difieren
    FROM esperadas e
    FULL JOIN guardadas g ON g.medio_de_pago_id = e.medio AND g.cuenta_de_cobro_id IS NOT DISTINCT FROM e.cuenta;
  IF v_faltan > 0 THEN
    RAISE EXCEPTION 'la conciliación no tiene exactamente una línea por cada medio y cuenta con movimientos, correcciones o declaración'
      USING ERRCODE = '23514', CONSTRAINT = 'caja_conciliacion_incompleta';
  END IF;
  IF v_difieren > 0 THEN
    RAISE EXCEPTION 'una línea de la conciliación no es lo que resulta de los movimientos, las correcciones y las declaraciones'
      USING ERRCODE = '23514', CONSTRAINT = 'caja_conciliacion_no_cuadra';
  END IF;

  -- Cobrado contra el ticket: `cobrado` de cada origen guardado es la Σ real de sus cobros en las sesiones de la jornada (el total del
  -- ticket es de ventas y no se puede verificar acá).
  IF EXISTS (
    SELECT 1 FROM public.conciliacion_de_cobro_por_origen o
     WHERE o.empresa_id = NEW.empresa_id AND o.sucursal_id = NEW.sucursal_id AND o.fecha_negocio = NEW.fecha_negocio
       AND o.cobrado IS DISTINCT FROM (
         SELECT coalesce(sum(m.importe), 0)
           FROM public.cobro co
           JOIN public.movimiento_caja m ON m.id = co.movimiento_id AND m.empresa_id = co.empresa_id
           JOIN public.sesion_caja s ON s.id = m.sesion_id AND s.empresa_id = m.empresa_id
           JOIN public.caja c ON c.id = s.caja_id AND c.empresa_id = s.empresa_id
          WHERE co.empresa_id = o.empresa_id AND co.origen_tipo = o.origen_tipo AND co.origen_id = o.origen_id
            AND c.sucursal_id = o.sucursal_id AND s.fecha_negocio = o.fecha_negocio
       )
  ) THEN
    RAISE EXCEPTION 'el cobrado de un origen no es la suma real de sus cobros en la jornada'
      USING ERRCODE = '23514', CONSTRAINT = 'caja_conciliacion_no_cuadra';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER cierre_de_caja_alta BEFORE INSERT ON cierre_de_caja_de_jornada
  FOR EACH ROW EXECUTE FUNCTION cierre_de_caja_validar_alta();
CREATE TRIGGER cierre_de_caja_solo_insercion BEFORE UPDATE OR DELETE ON cierre_de_caja_de_jornada
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER cierre_de_caja_sin_truncate BEFORE TRUNCATE ON cierre_de_caja_de_jornada
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE CONSTRAINT TRIGGER cierre_de_caja_verificar AFTER INSERT ON cierre_de_caja_de_jornada
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cierre_de_caja_verificar();

CREATE TRIGGER conciliacion_de_jornada_alta BEFORE INSERT ON conciliacion_de_jornada
  FOR EACH ROW EXECUTE FUNCTION conciliacion_de_jornada_validar_alta();
CREATE TRIGGER conciliacion_de_jornada_solo_insercion BEFORE UPDATE OR DELETE ON conciliacion_de_jornada
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER conciliacion_de_jornada_sin_truncate BEFORE TRUNCATE ON conciliacion_de_jornada
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

CREATE TRIGGER conciliacion_de_cobro_alta BEFORE INSERT ON conciliacion_de_cobro_por_origen
  FOR EACH ROW EXECUTE FUNCTION conciliacion_de_cobro_validar_alta();
CREATE TRIGGER conciliacion_de_cobro_solo_insercion BEFORE UPDATE OR DELETE ON conciliacion_de_cobro_por_origen
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER conciliacion_de_cobro_sin_truncate BEFORE TRUNCATE ON conciliacion_de_cobro_por_origen
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE ni TRUNCATE. Solo la aplicación (el grupo y los trabajos, nada); la plataforma solo
-- toca las listas.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON caja, medio_de_pago, cuenta_de_cobro, sesion_caja, movimiento_caja, cobro, arqueo_caja, arqueo_billete,
              valor_de_lista, correccion_de_medio, declaracion_de_total, conforme_de_jornada, cierre_de_caja_de_jornada,
              conciliacion_de_jornada, conciliacion_de_cobro_por_origen
  FROM PUBLIC;

-- Las funciones que llaman los disparadores y las comprobaciones de la aplicación.
GRANT EXECUTE ON FUNCTION fecha_de_negocio(timestamptz, text, time), cuenta_admitida_por_medio(text, text),
  par_de_cobro_validar(text, uuid, uuid, uuid, uuid, boolean)
TO pedernal_app;

GRANT SELECT ON caja, medio_de_pago, cuenta_de_cobro, sesion_caja, movimiento_caja, cobro, arqueo_caja, arqueo_billete,
                valor_de_lista, correccion_de_medio, declaracion_de_total, conforme_de_jornada, cierre_de_caja_de_jornada,
                conciliacion_de_jornada, conciliacion_de_cobro_por_origen
  TO pedernal_app;

GRANT INSERT (empresa_id, sucursal_id, nombre) ON caja TO pedernal_app;
GRANT UPDATE (nombre, activa) ON caja TO pedernal_app;

-- Un medio nuevo nace sin datos habilitados (`pide_*` toma el valor por defecto); `editarMedioDePago` los habilita.
GRANT INSERT (empresa_id, tipo, nombre) ON medio_de_pago TO pedernal_app;
GRANT UPDATE (nombre, activo, pide_cupon, pide_ultimos4, pide_marca, pide_cuotas, pide_dni) ON medio_de_pago TO pedernal_app;

GRANT INSERT (empresa_id, tipo, nombre, identificador_externo, sucursal_id) ON cuenta_de_cobro TO pedernal_app;
GRANT UPDATE (nombre, identificador_externo, sucursal_id, activa) ON cuenta_de_cobro TO pedernal_app;

-- El sello no tiene UPDATE para nadie.
GRANT INSERT (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por, clave_idempotencia, huella)
  ON sesion_caja TO pedernal_app;
GRANT UPDATE (estado, cierre_iniciado_en, cierre_iniciado_por, cerrada_en, cerrada_por, observacion) ON sesion_caja TO pedernal_app;

GRANT INSERT (empresa_id, sesion_id, clase, medio_de_pago_id, cuenta_de_cobro_id, moneda, importe, motivo, anula_a, corrige_jornada,
              registrado_en, registrado_por, clave_idempotencia, huella)
  ON movimiento_caja TO pedernal_app;
GRANT INSERT (movimiento_id, empresa_id, origen_tipo, origen_id, origen_orden, cupon, ultimos4, marca_de_tarjeta_id, cuotas, dni)
  ON cobro TO pedernal_app;
GRANT INSERT (empresa_id, sesion_id, medio_de_pago_id, cuenta_de_cobro_id, moneda, esperado, contado, contado_monedas, conforme,
              conforme_por, conforme_en)
  ON arqueo_caja TO pedernal_app;
GRANT INSERT (empresa_id, sesion_id, denominacion, cantidad) ON arqueo_billete TO pedernal_app;

GRANT INSERT (empresa_id, cobro_id, secuencia, sucursal_id, fecha_negocio, medio_antes_id, cuenta_antes_id, medio_despues_id,
              cuenta_despues_id, motivo, corregido_en, corregido_por, clave_idempotencia, huella)
  ON correccion_de_medio TO pedernal_app;
GRANT INSERT (empresa_id, sucursal_id, fecha_negocio, medio_de_pago_id, cuenta_de_cobro_id, secuencia, moneda, importe, declarado_en,
              declarado_por, clave_idempotencia, huella)
  ON declaracion_de_total TO pedernal_app;
GRANT INSERT (empresa_id, sucursal_id, fecha_negocio, conforme_por, conforme_en, clave_idempotencia, huella)
  ON conforme_de_jornada TO pedernal_app;
GRANT INSERT (empresa_id, sucursal_id, fecha_negocio, congelado_en, congelado_por) ON cierre_de_caja_de_jornada TO pedernal_app;
GRANT INSERT (empresa_id, sucursal_id, fecha_negocio, medio_de_pago_id, cuenta_de_cobro_id, moneda, registrado, correcciones, declarado,
              estado_de_conteo, conforme_por, conforme_en, explicacion)
  ON conciliacion_de_jornada TO pedernal_app;
GRANT INSERT (empresa_id, sucursal_id, fecha_negocio, origen_tipo, origen_id, ticket_id, moneda, cobrado, total_del_ticket, explicacion)
  ON conciliacion_de_cobro_por_origen TO pedernal_app;

-- C6. Las listas: las empresas solo leen; la plataforma agrega por (lista, nombre) y cambia (nombre, activo). No inserta `fija`.
GRANT SELECT ON valor_de_lista TO pedernal_plataforma;
GRANT INSERT (lista, nombre) ON valor_de_lista TO pedernal_plataforma;
GRANT UPDATE (nombre, activo) ON valor_de_lista TO pedernal_plataforma;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada; sin política no hay acceso (el dueño de la base tampoco ve nada sin BYPASSRLS)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE caja FORCE ROW LEVEL SECURITY;
ALTER TABLE medio_de_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE medio_de_pago FORCE ROW LEVEL SECURITY;
ALTER TABLE cuenta_de_cobro ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuenta_de_cobro FORCE ROW LEVEL SECURITY;
ALTER TABLE sesion_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE sesion_caja FORCE ROW LEVEL SECURITY;
ALTER TABLE movimiento_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimiento_caja FORCE ROW LEVEL SECURITY;
ALTER TABLE cobro ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobro FORCE ROW LEVEL SECURITY;
ALTER TABLE arqueo_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE arqueo_caja FORCE ROW LEVEL SECURITY;
ALTER TABLE arqueo_billete ENABLE ROW LEVEL SECURITY;
ALTER TABLE arqueo_billete FORCE ROW LEVEL SECURITY;
ALTER TABLE valor_de_lista ENABLE ROW LEVEL SECURITY;
ALTER TABLE valor_de_lista FORCE ROW LEVEL SECURITY;
ALTER TABLE correccion_de_medio ENABLE ROW LEVEL SECURITY;
ALTER TABLE correccion_de_medio FORCE ROW LEVEL SECURITY;
ALTER TABLE declaracion_de_total ENABLE ROW LEVEL SECURITY;
ALTER TABLE declaracion_de_total FORCE ROW LEVEL SECURITY;
ALTER TABLE conforme_de_jornada ENABLE ROW LEVEL SECURITY;
ALTER TABLE conforme_de_jornada FORCE ROW LEVEL SECURITY;
ALTER TABLE cierre_de_caja_de_jornada ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierre_de_caja_de_jornada FORCE ROW LEVEL SECURITY;
ALTER TABLE conciliacion_de_jornada ENABLE ROW LEVEL SECURITY;
ALTER TABLE conciliacion_de_jornada FORCE ROW LEVEL SECURITY;
ALTER TABLE conciliacion_de_cobro_por_origen ENABLE ROW LEVEL SECURITY;
ALTER TABLE conciliacion_de_cobro_por_origen FORCE ROW LEVEL SECURITY;

-- Lectura: la empresa del contexto, en todas las tablas de empresa.
CREATE POLICY caja_app_leer ON caja FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY medio_de_pago_app_leer ON medio_de_pago FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY cuenta_de_cobro_app_leer ON cuenta_de_cobro FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY sesion_caja_app_leer ON sesion_caja FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY movimiento_caja_app_leer ON movimiento_caja FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY cobro_app_leer ON cobro FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY arqueo_caja_app_leer ON arqueo_caja FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY arqueo_billete_app_leer ON arqueo_billete FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY correccion_de_medio_app_leer ON correccion_de_medio FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY declaracion_de_total_app_leer ON declaracion_de_total FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY conforme_de_jornada_app_leer ON conforme_de_jornada FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY cierre_de_caja_app_leer ON cierre_de_caja_de_jornada FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY conciliacion_de_jornada_app_leer ON conciliacion_de_jornada FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY conciliacion_de_cobro_app_leer ON conciliacion_de_cobro_por_origen FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));

-- Altas: la empresa del contexto, operable, y —donde hay actor— la persona del contexto.
CREATE POLICY caja_app_alta ON caja FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY medio_de_pago_app_alta ON medio_de_pago FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY cuenta_de_cobro_app_alta ON cuenta_de_cobro FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY sesion_caja_app_alta ON sesion_caja FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND abierta_por = (SELECT app_persona_id()));
CREATE POLICY movimiento_caja_app_alta ON movimiento_caja FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND registrado_por = (SELECT app_persona_id()));
CREATE POLICY cobro_app_alta ON cobro FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY arqueo_caja_app_alta ON arqueo_caja FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
              AND (conforme_por IS NULL OR conforme_por = (SELECT app_persona_id())));
CREATE POLICY arqueo_billete_app_alta ON arqueo_billete FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY correccion_de_medio_app_alta ON correccion_de_medio FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND corregido_por = (SELECT app_persona_id()));
CREATE POLICY declaracion_de_total_app_alta ON declaracion_de_total FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND declarado_por = (SELECT app_persona_id()));
CREATE POLICY conforme_de_jornada_app_alta ON conforme_de_jornada FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND conforme_por = (SELECT app_persona_id()));
CREATE POLICY cierre_de_caja_app_alta ON cierre_de_caja_de_jornada FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND congelado_por = (SELECT app_persona_id()));
CREATE POLICY conciliacion_de_jornada_app_alta ON conciliacion_de_jornada FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY conciliacion_de_cobro_app_alta ON conciliacion_de_cobro_por_origen FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

-- Cambios (solo las tablas con UPDATE). `FOR SHARE` pasa por estas políticas: una sesión CERRADA no la ve el `FOR SHARE` de un
-- movimiento («no encontrada», no un error de permisos).
CREATE POLICY caja_app_cambiar ON caja FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY medio_de_pago_app_cambiar ON medio_de_pago FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY cuenta_de_cobro_app_cambiar ON cuenta_de_cobro FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY sesion_caja_app_cambiar ON sesion_caja FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND estado <> 'CERRADA')
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

-- Listas: las empresas leen todo; la plataforma, con las políticas RESTRICTIVAS del actor (sin un actor vigente no ve nada y solo un
-- ADMIN escribe: `listas.ver` ADMIN y SOPORTE, `listas.editar` solo ADMIN; como `plan` de 0007).
CREATE POLICY valor_de_lista_app_leer ON valor_de_lista FOR SELECT TO pedernal_app USING (true);
CREATE POLICY valor_de_lista_plataforma_leer ON valor_de_lista FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY valor_de_lista_plataforma_alta ON valor_de_lista FOR INSERT TO pedernal_plataforma WITH CHECK (true);
CREATE POLICY valor_de_lista_plataforma_cambiar ON valor_de_lista FOR UPDATE TO pedernal_plataforma
  USING (true) WITH CHECK (true);
CREATE POLICY valor_de_lista_plataforma_con_actor ON valor_de_lista AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY valor_de_lista_plataforma_admin_alta ON valor_de_lista AS RESTRICTIVE FOR INSERT TO pedernal_plataforma
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY valor_de_lista_plataforma_admin_cambiar ON valor_de_lista AS RESTRICTIVE FOR UPDATE TO pedernal_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
