-- 0005_administracion: traspaso de gerencia, asignaciones desde la empresa y reglas de base de las
-- sucursales (H6, tramo T1; ADR-004, ADR-011; decisiones del dueño del 2026-10-12: el traspaso lo
-- acepta el entrante, el anterior queda como administrador, el traspaso vence a los 7 días, el
-- gerente y el administrador trabajan en todas las sucursales y solo el gerente desactiva).
--
-- Reglas de esta migración (las mismas de 0001 a 0004):
--  * Es ADITIVA: crea una tabla, un orden de comparación, restricciones, disparadores y políticas.
--    No borra ni reescribe ningún dato, columna, política ni privilegio existente. Las filas que ya
--    existen la cumplen, y si alguna no la cumpliera la migración se frena ANTES de tocar nada con
--    un mensaje claro (ver «Verificaciones previas»).
--  * No agrega NINGUNA función SECURITY DEFINER: la única del esquema sigue siendo
--    `contexto_firmado()` (un meta-test lo exige). Todo corre con los permisos de quien consulta.
--  * Toda función nueva fija `search_path = pg_catalog, public, pg_temp`, califica sus tablas con
--    `public.` y nace sin EXECUTE para PUBLIC. Las funciones de disparador no se otorgan a nadie.
--  * Nadie recibe DELETE ni TRUNCATE. INSERT y UPDATE van por columna.
--  * RLS activa y FORZADA en la tabla nueva.
--  * Sin contraseñas, claves ni cadenas de conexión; no toca ningún rol.
--  * DEPENDE de 0004: la plataforma solo toca la tabla nueva bajo las políticas RESTRICTIVAS del
--    actor firmado (`plataforma_actor_vigente()`, `admin_plataforma_con_rol()`). Sin ellas la
--    plataforma vería y escribiría sin actor (la tabla nueva no está en las políticas de 0004).
--    La especificación decía que 0005 era independiente de 0004; se cambió a propósito (ver informe).
--  * Necesita una base UTF8 con ICU (Neon y Postgres 16 o 18 con paquetes normales lo tienen).
--
-- Decisiones de diseño (todas probadas por tests):
--
--  A1. El rol de una membresía cambia SOLO dentro de la transacción que acepta un traspaso, y solo
--      GERENTE -> ADMINISTRADOR para el saliente y ADMINISTRADOR u OPERADOR -> GERENTE para el
--      entrante. Lo imponen DOS barreras: la política `membresia_app_traspasar` (mira el traspaso) y
--      el disparador `membresia_cambio` (mira lo mismo y además lo que ninguna política ve: las filas
--      de miembros apagados, que `membresia_app_apagar` deja pasar). «En esta transacción» se mide
--      con `xmin` del traspaso contra la transacción en curso, no con `now()`: dos transacciones
--      distintas pueden compartir el mismo `now()` al microsegundo, pero nunca el mismo xid.
--      LÍMITE: si la aceptación del traspaso se hace dentro de un SAVEPOINT, su `xmin` es el de la
--      subtransacción y el cambio de rol se rechaza (falla cerrado). La aceptación no usa savepoints.
--      ORDEN DE FILAS: la aceptación toca primero `traspaso_gerencia` y después `membresia`; quien
--      apaga a un miembro (y cancela su traspaso) debe tocar las filas en el mismo orden, o las dos
--      transacciones se cruzan (deadlock: Postgres aborta una al segundo y el adaptador la repite).
--  A2. «Nunca dos gerentes ni ninguno», por capas: el índice `membresia_gerente_uk` impide dos; el
--      disparador `membresia_cambio` impide apagar a un gerente activo; y una restricción diferida
--      (`traspaso_gerencia_aceptado_completo`) exige, AL CONFIRMAR, que quien aceptó un traspaso sea
--      el gerente activo y el saliente un administrador activo: un traspaso aceptado sin el cambio
--      de roles (o un cambio a medias) no se puede confirmar. Orden en el código: baja del saliente
--      primero (el índice parcial no se difiere), después el ascenso del entrante.
--  A3. El traspaso solo lo propone el gerente VIGENTE (disparador de alta) y solo lo acepta o rechaza
--      el entrante (política con `app_persona_id()`). Al aceptar, el saliente tiene que seguir
--      siendo el gerente activo y el entrante un miembro activo (disparador de cambio). Cancelar lo
--      puede un gerente o un administrador (o el sistema, sin persona): se apaga a un miembro con
--      `usuarios.apagar`, que también cancela el traspaso del apagado.
--  A4. Sin ciclos de políticas (D2 de 0002): `membresia` mira `traspaso_gerencia`; las políticas de
--      `traspaso_gerencia` NO miran `membresia`. Lo que necesita mirar membresías lo hacen los
--      disparadores, que no participan del chequeo de ciclos.
--  A5. «La empresa nunca queda sin sucursal activa» lo impone la base con dos disparadores y un
--      bloqueo consultivo, NO con el bloqueo de la fila de `empresa`: `zuluhub_app` no puede
--      bloquear esa fila sin ensanchar permisos (SELECT FOR UPDATE exige además pasar la política
--      de UPDATE de empresa, y no hay ninguna para el contexto operativo). El bloqueo consultivo no
--      necesita ningún privilegio, y bloquear en modo compartido a las otras sucursales activas hace
--      que la regla valga bajo READ COMMITTED, REPEATABLE READ y SERIALIZABLE (ver el comentario de
--      los disparadores). Las bajas se serializan entre sí.
--  A6. La unicidad del nombre de sucursal no puede depender del `locale` de la base: con locale `C`,
--      `lower('CAFÉ')` no es `café` y el índice de 0001 (`lower(nombre)`) deja pasar las dos. El
--      índice nuevo usa un orden ICU NO determinista de nivel 2 (ignora mayúsculas, distingue
--      acentos y trata igual las formas Unicode equivalentes). El de 0001 se conserva (borrarlo
--      sería destructivo y no molesta: lo nuevo es más estricto o igual).
--  A7. Una asignación se crea o se reactiva solo para un miembro activo y una sucursal activa de la
--      misma empresa (cambia D7 de 0002 SOLO para asignaciones; las membresías siguen naciendo de
--      aceptar una invitación). Desactivar una sucursal no apaga asignaciones.

-- ---------------------------------------------------------------------------------------------
-- Verificaciones previas: se frena con un mensaje claro, sin haber cambiado nada
-- (Los recuentos pasan por RLS: si el rol que migra no la evade verían 0 filas; igual, crear el
-- índice y las restricciones de abajo falla ante datos que no los cumplen, solo que con un mensaje
-- menos claro. En Neon el dueño de la base evade RLS.)
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_largas integer;
  v_control integer;
BEGIN
  IF to_regprocedure('public.plataforma_actor_vigente()') IS NULL
     OR to_regprocedure('public.admin_plataforma_con_rol(text[])') IS NULL THEN
    RAISE EXCEPTION '0005 necesita 0004_plataforma aplicada antes (faltan las funciones del actor de plataforma)'
      USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_encoding_to_char(d.encoding) FROM pg_database d WHERE d.datname = current_database())
       <> 'UTF8' THEN
    RAISE EXCEPTION '0005 necesita una base UTF8 (el orden ICU de los nombres de sucursal no existe en otras codificaciones)'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_collation WHERE collprovider = 'i') THEN
    RAISE EXCEPTION '0005 necesita un Postgres compilado con ICU'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_largas FROM public.sucursal WHERE char_length(nombre) > 100;
  IF v_largas > 0 THEN
    RAISE EXCEPTION 'hay % sucursales con un nombre de más de 100 caracteres: acortarlos antes de migrar', v_largas
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_control FROM public.sucursal WHERE nombre ~ '[\x01-\x1F\x7F-\x9F]';
  IF v_control > 0 THEN
    RAISE EXCEPTION 'hay % sucursales con caracteres de control en el nombre: limpiarlos antes de migrar', v_control
      USING ERRCODE = '23514';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Sucursal: nombre sin depender del locale, largo y caracteres de control, última activa
-- ---------------------------------------------------------------------------------------------

-- Orden ICU «und-u-ks-level2» no determinista: iguales si difieren solo en mayúsculas (o en la forma
-- Unicode, o en caracteres invisibles); distintos si difieren en un acento. No depende de LC_COLLATE
-- ni de LC_CTYPE del servidor.
CREATE COLLATION sucursal_nombre_ci (provider = icu, locale = 'und-u-ks-level2', deterministic = false);

DO $$
DECLARE
  v_repetidos integer;
BEGIN
  SELECT count(*) INTO v_repetidos
    FROM public.sucursal a
    JOIN public.sucursal b ON a.empresa_id = b.empresa_id AND a.id < b.id
                          AND a.nombre = b.nombre COLLATE sucursal_nombre_ci;
  IF v_repetidos > 0 THEN
    RAISE EXCEPTION 'hay % pares de sucursales de una misma empresa con el mismo nombre salvo mayúsculas: renombrar una de cada par antes de migrar', v_repetidos
      USING ERRCODE = '23505';
  END IF;
END
$$;

CREATE UNIQUE INDEX sucursal_nombre_ci_uk ON sucursal (empresa_id, nombre COLLATE sucursal_nombre_ci);

ALTER TABLE sucursal ADD CONSTRAINT sucursal_nombre_largo_ck CHECK (char_length(nombre) <= 100);
-- Un nombre es una sola línea de texto: sin caracteres de control (C0, DEL y C1, como \p{Cc}).
ALTER TABLE sucursal ADD CONSTRAINT sucursal_nombre_control_ck CHECK (nombre !~ '[\x01-\x1F\x7F-\x9F]');

-- «La empresa nunca queda sin una sucursal activa» (A5). Dos disparadores:
--  1. Por SENTENCIA, antes de tocar ninguna fila: toma un bloqueo consultivo (el mismo para todas las
--     empresas: dar de baja una sucursal es una acción manual y rara, y un bloqueo común evita que dos
--     bajas se esperen con una fila bloqueada cada una, que sería un deadlock).
--  2. Por FILA, al pasar de activa a inactiva: con el bloqueo tomado, bloquea en modo compartido a las
--     OTRAS sucursales activas de la empresa y exige que quede alguna. Bloquear las filas (y no solo
--     leerlas) es lo que hace que la regla valga también bajo REPEATABLE READ y SERIALIZABLE: si otra
--     transacción ya confirmó un cambio en esa fila después de nuestro instante de lectura, Postgres
--     aborta con 40001 y el trabajo se repite viendo el estado nuevo; bajo READ COMMITTED vuelve a
--     evaluar la fila y ve la baja del otro.
CREATE FUNCTION sucursal_serializar_bajas() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('zuluhub.sucursal.baja', 0));
  RETURN NULL;
END
$$;

CREATE FUNCTION sucursal_validar_baja() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  PERFORM 1
     FROM public.sucursal s
    WHERE s.empresa_id = NEW.empresa_id AND s.id <> NEW.id AND s.activa
      FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la empresa no puede quedar sin una sucursal activa'
      USING ERRCODE = '23514', CONSTRAINT = 'sucursal_ultima_activa';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER sucursal_baja_serializar BEFORE UPDATE OF activa ON sucursal
  FOR EACH STATEMENT EXECUTE FUNCTION sucursal_serializar_bajas();
CREATE TRIGGER sucursal_baja BEFORE UPDATE OF activa ON sucursal
  FOR EACH ROW WHEN (OLD.activa AND NOT NEW.activa) EXECUTE FUNCTION sucursal_validar_baja();

-- ---------------------------------------------------------------------------------------------
-- Traspaso de gerencia
-- ---------------------------------------------------------------------------------------------
CREATE TABLE traspaso_gerencia (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  origen              text NOT NULL,
  propuesto_por       uuid,                  -- NULL: lo propuso la plataforma
  saliente_persona_id uuid,                  -- origen PLATAFORMA: se completa al aceptar
  entrante_persona_id uuid NOT NULL,
  estado              text NOT NULL DEFAULT 'PROPUESTO',
  propuesto_en        timestamptz NOT NULL,  -- el `ahora` de la aplicación, no now()
  vence_en            timestamptz NOT NULL,
  resuelto_en         timestamptz,
  motivo              text,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT traspaso_gerencia_pkey PRIMARY KEY (id),
  CONSTRAINT traspaso_gerencia_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  -- Solo se traspasa a un miembro de ESTA empresa (nunca a uno de otra, aunque sea del mismo tenant).
  CONSTRAINT traspaso_gerencia_entrante_fkey FOREIGN KEY (empresa_id, entrante_persona_id)
    REFERENCES membresia (empresa_id, persona_id),
  -- Con saliente NULL la FK no se evalúa (MATCH SIMPLE).
  CONSTRAINT traspaso_gerencia_saliente_fkey FOREIGN KEY (empresa_id, saliente_persona_id)
    REFERENCES membresia (empresa_id, persona_id),
  CONSTRAINT traspaso_gerencia_propuesto_por_fkey FOREIGN KEY (propuesto_por) REFERENCES persona (id),
  -- GERENTE <=> hay quien propone, y quien propone es el saliente. `IS NOT DISTINCT FROM` (y no `=`):
  -- con un saliente NULL, `NULL = x` daría NULL y un CHECK deja pasar el NULL.
  CONSTRAINT traspaso_gerencia_origen_ck CHECK (
    origen IN ('GERENTE', 'PLATAFORMA')
    AND (origen = 'GERENTE') = (propuesto_por IS NOT NULL)
    AND (origen <> 'GERENTE' OR saliente_persona_id IS NOT DISTINCT FROM propuesto_por)
  ),
  CONSTRAINT traspaso_gerencia_estado_ck CHECK (estado IN ('PROPUESTO', 'ACEPTADO', 'RECHAZADO', 'CANCELADO')),
  CONSTRAINT traspaso_gerencia_distintos_ck CHECK (saliente_persona_id IS DISTINCT FROM entrante_persona_id),
  CONSTRAINT traspaso_gerencia_vence_ck CHECK (vence_en > propuesto_en),
  -- «Vencida» no se guarda: se calcula con `vence_en`. Resuelto <=> con fecha de resolución.
  CONSTRAINT traspaso_gerencia_resolucion_ck CHECK (
    (estado = 'PROPUESTO') = (resuelto_en IS NULL)
    AND (resuelto_en IS NULL OR resuelto_en >= propuesto_en)
  ),
  -- Una aceptación no puede fecharse después del vencimiento (D5 de 0002) y deja anotado al saliente.
  CONSTRAINT traspaso_gerencia_aceptado_ck CHECK (
    estado <> 'ACEPTADO' OR (resuelto_en < vence_en AND saliente_persona_id IS NOT NULL)
  ),
  -- El motivo es una clave (VENCIDO, ENTRANTE_DADO_DE_BAJA...), no texto libre, y solo existe resuelto.
  CONSTRAINT traspaso_gerencia_motivo_ck CHECK (
    (motivo IS NULL OR motivo ~ '^[A-Z][A-Z0-9_]{0,79}$')
    AND (estado <> 'PROPUESTO' OR motivo IS NULL)
  )
);
-- Un solo traspaso en curso por empresa.
CREATE UNIQUE INDEX traspaso_gerencia_en_curso_uk ON traspaso_gerencia (empresa_id) WHERE estado = 'PROPUESTO';
CREATE INDEX traspaso_gerencia_empresa_ix ON traspaso_gerencia (empresa_id, propuesto_en);

-- Alta: quién puede proponer y a quién. Las políticas no pueden mirar `membresia` (A4): lo hace acá.
CREATE FUNCTION traspaso_gerencia_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_rol    text;
  v_activo boolean;
  v_global boolean;
BEGIN
  -- El entrante: miembro activo, que no es el gerente, con la persona activa. Si no es miembro, lo
  -- dice la clave foránea (`traspaso_gerencia_entrante_fkey`) al final de la sentencia.
  SELECT m.rol, m.activo INTO v_rol, v_activo
    FROM public.membresia m
   WHERE m.empresa_id = NEW.empresa_id AND m.persona_id = NEW.entrante_persona_id;
  IF FOUND THEN
    IF NOT v_activo THEN
      RAISE EXCEPTION 'el entrante no es un miembro activo de la empresa'
        USING ERRCODE = '23514', CONSTRAINT = 'traspaso_entrante_inactivo';
    END IF;
    IF v_rol = 'GERENTE' THEN
      RAISE EXCEPTION 'el entrante ya es el gerente de la empresa'
        USING ERRCODE = '23514', CONSTRAINT = 'traspaso_entrante_es_el_gerente';
    END IF;
  END IF;
  SELECT p.activo_global INTO v_global FROM public.persona p WHERE p.id = NEW.entrante_persona_id;
  IF FOUND AND NOT v_global THEN
    RAISE EXCEPTION 'la persona entrante está dada de baja'
      USING ERRCODE = '23514', CONSTRAINT = 'traspaso_entrante_inactivo';
  END IF;

  -- Lo propone el gerente VIGENTE (un administrador, un operador o un ex gerente no).
  IF NEW.origen = 'GERENTE' AND NOT EXISTS (
    SELECT 1 FROM public.membresia m
     WHERE m.empresa_id = NEW.empresa_id AND m.persona_id = NEW.propuesto_por
       AND m.rol = 'GERENTE' AND m.activo
  ) THEN
    RAISE EXCEPTION 'solo el gerente vigente de la empresa puede proponer un traspaso'
      USING ERRCODE = '23514', CONSTRAINT = 'traspaso_saliente_no_es_gerente';
  END IF;
  RETURN NEW;
END
$$;

-- Cambio: máquina de estados (un test exige que permita exactamente las transiciones del dominio).
CREATE FUNCTION traspaso_gerencia_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_rol     text;
  v_activo  boolean;
  v_global  boolean;
  v_persona uuid;
BEGIN
  -- Los datos de emisión no cambian nunca.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.origen IS DISTINCT FROM OLD.origen
     OR NEW.propuesto_por IS DISTINCT FROM OLD.propuesto_por
     OR NEW.entrante_persona_id IS DISTINCT FROM OLD.entrante_persona_id
     OR NEW.propuesto_en IS DISTINCT FROM OLD.propuesto_en
     OR NEW.vence_en IS DISTINCT FROM OLD.vence_en
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'los datos de emisión de un traspaso no se pueden cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'traspaso_gerencia_inmutable';
  END IF;

  -- Resuelto = congelado: ni el estado ni nada de lo que lo acompaña.
  IF OLD.estado <> 'PROPUESTO' THEN
    IF NEW.estado <> OLD.estado THEN
      RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
        USING ERRCODE = '23514', CONSTRAINT = 'traspaso_gerencia_transicion_invalida';
    END IF;
    IF NEW.resuelto_en IS DISTINCT FROM OLD.resuelto_en
       OR NEW.motivo IS DISTINCT FROM OLD.motivo
       OR NEW.saliente_persona_id IS DISTINCT FROM OLD.saliente_persona_id
    THEN
      RAISE EXCEPTION 'un traspaso resuelto no se puede modificar'
        USING ERRCODE = '23514', CONSTRAINT = 'traspaso_gerencia_resuelto_inmutable';
    END IF;
    RETURN NEW;
  END IF;

  -- Desde PROPUESTO solo se llega a ACEPTADO, RECHAZADO o CANCELADO (o se queda).
  IF NEW.estado NOT IN ('PROPUESTO', 'ACEPTADO', 'RECHAZADO', 'CANCELADO') THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'traspaso_gerencia_transicion_invalida';
  END IF;

  -- El saliente de un traspaso de plataforma se completa una sola vez, al aceptar.
  IF NEW.saliente_persona_id IS DISTINCT FROM OLD.saliente_persona_id
     AND (OLD.saliente_persona_id IS NOT NULL OR NEW.estado <> 'ACEPTADO')
  THEN
    RAISE EXCEPTION 'el saliente de un traspaso solo se completa al aceptarlo'
      USING ERRCODE = '23514', CONSTRAINT = 'traspaso_gerencia_inmutable';
  END IF;

  IF NEW.estado = 'ACEPTADO' THEN
    -- El saliente es el gerente activo de HOY (pudo cambiar desde la propuesta).
    IF NEW.saliente_persona_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.membresia m
       WHERE m.empresa_id = NEW.empresa_id AND m.persona_id = NEW.saliente_persona_id
         AND m.rol = 'GERENTE' AND m.activo
    ) THEN
      RAISE EXCEPTION 'el saliente ya no es el gerente de la empresa'
        USING ERRCODE = '23514', CONSTRAINT = 'traspaso_saliente_no_es_gerente';
    END IF;
    -- El entrante sigue siendo un miembro activo (y no es el gerente).
    SELECT m.rol, m.activo INTO v_rol, v_activo
      FROM public.membresia m
     WHERE m.empresa_id = NEW.empresa_id AND m.persona_id = NEW.entrante_persona_id;
    IF NOT FOUND OR NOT v_activo THEN
      RAISE EXCEPTION 'el entrante no es un miembro activo de la empresa'
        USING ERRCODE = '23514', CONSTRAINT = 'traspaso_entrante_inactivo';
    END IF;
    IF v_rol = 'GERENTE' THEN
      RAISE EXCEPTION 'el entrante ya es el gerente de la empresa'
        USING ERRCODE = '23514', CONSTRAINT = 'traspaso_entrante_es_el_gerente';
    END IF;
    SELECT p.activo_global INTO v_global FROM public.persona p WHERE p.id = NEW.entrante_persona_id;
    IF FOUND AND NOT v_global THEN
      RAISE EXCEPTION 'la persona entrante está dada de baja'
        USING ERRCODE = '23514', CONSTRAINT = 'traspaso_entrante_inactivo';
    END IF;
  ELSIF NEW.estado = 'CANCELADO' THEN
    -- Si cancela una persona de una empresa (contexto con persona), es un gerente o un administrador
    -- activo: un operador no cancela. Sin persona (el sistema, la plataforma, el dueño): sin esta barrera.
    v_persona := public.app_persona_id();
    IF v_persona IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.membresia m
       WHERE m.empresa_id = NEW.empresa_id AND m.persona_id = v_persona
         AND m.rol IN ('GERENTE', 'ADMINISTRADOR') AND m.activo
    ) THEN
      RAISE EXCEPTION 'solo un gerente o un administrador cancela un traspaso'
        USING ERRCODE = '23514', CONSTRAINT = 'traspaso_cancela_sin_permiso';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Restricción DIFERIDA: al confirmar, un traspaso que pasó a ACEPTADO en esta transacción exige que el
-- entrante sea el gerente activo y el saliente un administrador activo (A2). Sin esto, un código que
-- acepte sin cambiar los roles (o que los cambie a medias) dejaría a la empresa sin gerente o con un
-- traspaso «aceptado» que no pasó.
CREATE FUNCTION traspaso_gerencia_verificar_aceptado() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM public.membresia m
        WHERE m.empresa_id = NEW.empresa_id AND m.persona_id = NEW.entrante_persona_id
          AND m.rol = 'GERENTE' AND m.activo)
     OR NOT EXISTS (
       SELECT 1 FROM public.membresia m
        WHERE m.empresa_id = NEW.empresa_id AND m.persona_id = NEW.saliente_persona_id
          AND m.rol = 'ADMINISTRADOR' AND m.activo)
  THEN
    RAISE EXCEPTION 'un traspaso aceptado exige que el entrante sea el gerente y el saliente un administrador'
      USING ERRCODE = '23514', CONSTRAINT = 'traspaso_aceptado_incompleto';
  END IF;
  RETURN NULL;
END
$$;

-- Los nombres ordenan los disparadores: `_cambio` valida con OLD/NEW antes de que `_version` los toque.
CREATE TRIGGER traspaso_gerencia_alta BEFORE INSERT ON traspaso_gerencia
  FOR EACH ROW EXECUTE FUNCTION traspaso_gerencia_validar_alta();
CREATE TRIGGER traspaso_gerencia_cambio BEFORE UPDATE ON traspaso_gerencia
  FOR EACH ROW EXECUTE FUNCTION traspaso_gerencia_validar_cambio();
CREATE TRIGGER traspaso_gerencia_version BEFORE UPDATE ON traspaso_gerencia
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE CONSTRAINT TRIGGER traspaso_gerencia_aceptado_completo AFTER UPDATE ON traspaso_gerencia
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.estado = 'ACEPTADO' AND OLD.estado <> 'ACEPTADO')
  EXECUTE FUNCTION traspaso_gerencia_verificar_aceptado();

-- Membresía: el rol cambia solo por traspaso, y el gerente activo no se apaga (A1, A2).
CREATE FUNCTION membresia_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  -- Hoy lo cuida solo la política `membresia_app_apagar` (que ni siquiera deja ver la fila); acá lo
  -- cuida también la base, para todo el que logre llegar a ella.
  IF OLD.rol = 'GERENTE' AND OLD.activo AND NOT NEW.activo THEN
    RAISE EXCEPTION 'el gerente no se apaga: se traspasa'
      USING ERRCODE = '23514', CONSTRAINT = 'membresia_gerente_no_se_apaga';
  END IF;

  IF NEW.rol IS DISTINCT FROM OLD.rol THEN
    -- Con las dos membresías activas y un traspaso ACEPTADO en ESTA transacción (xmin = el xid en
    -- curso: un traspaso viejo no se reutiliza). El invitado que reactiva un miembro apagado no
    -- cambia el rol (decisión 17): su cambio, aunque la invitación lo traiga, se rechaza acá.
    IF NOT (OLD.activo AND NEW.activo) OR NOT EXISTS (
      SELECT 1 FROM public.traspaso_gerencia t
       WHERE t.empresa_id = OLD.empresa_id
         AND t.estado = 'ACEPTADO'
         AND t.xmin = pg_current_xact_id()::xid
         AND (
           (OLD.rol = 'GERENTE' AND NEW.rol = 'ADMINISTRADOR' AND t.saliente_persona_id = OLD.persona_id)
           OR (NEW.rol = 'GERENTE' AND t.entrante_persona_id = OLD.persona_id)
         )
    ) THEN
      RAISE EXCEPTION 'el rol de una membresía solo cambia al aceptar un traspaso de gerencia'
        USING ERRCODE = '23514', CONSTRAINT = 'membresia_rol_sin_traspaso';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- El nombre ordena el disparador antes de `membresia_version` (de 0002).
CREATE TRIGGER membresia_cambio BEFORE UPDATE ON membresia
  FOR EACH ROW EXECUTE FUNCTION membresia_validar_cambio();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON traspaso_gerencia FROM PUBLIC;

-- app: propone (el gerente), responde (el entrante) y cancela; ve los traspasos de su empresa.
GRANT SELECT ON traspaso_gerencia TO zuluhub_app, zuluhub_plataforma;
GRANT INSERT (empresa_id, origen, propuesto_por, saliente_persona_id, entrante_persona_id, propuesto_en, vence_en)
  ON traspaso_gerencia TO zuluhub_app;
GRANT UPDATE (estado, resuelto_en, motivo, saliente_persona_id) ON traspaso_gerencia TO zuluhub_app;
-- El rol cambia solo por traspaso: lo acotan la política `membresia_app_traspasar` y el disparador.
GRANT UPDATE (rol) ON membresia TO zuluhub_app;

-- plataforma: propone (origen PLATAFORMA, sin conocer al gerente) y cancela; no acepta ni rechaza.
GRANT INSERT (empresa_id, origen, entrante_persona_id, propuesto_en, vence_en)
  ON traspaso_gerencia TO zuluhub_plataforma;
GRANT UPDATE (estado, resuelto_en, motivo) ON traspaso_gerencia TO zuluhub_plataforma;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada en la tabla nueva; sin política no hay acceso
-- ---------------------------------------------------------------------------------------------
ALTER TABLE traspaso_gerencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE traspaso_gerencia FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- Políticas de traspaso_gerencia (ninguna mira `membresia`: A4)
-- ---------------------------------------------------------------------------------------------
CREATE POLICY traspaso_gerencia_app_leer ON traspaso_gerencia FOR SELECT TO zuluhub_app
  USING (empresa_id = (SELECT app_empresa_id()));
-- Propone la persona del contexto, con origen GERENTE. Que sea el gerente vigente lo impone el
-- disparador de alta.
CREATE POLICY traspaso_gerencia_app_alta ON traspaso_gerencia FOR INSERT TO zuluhub_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id())
    AND empresa_operable(empresa_id)
    AND origen = 'GERENTE'
    AND propuesto_por = (SELECT app_persona_id())
  );
-- Cada WITH CHECK nombra su propio actor (D8 de 0002): las permisivas se suman (OR). Responde solo
-- el entrante, y solo para aceptar o rechazar.
CREATE POLICY traspaso_gerencia_app_responder ON traspaso_gerencia FOR UPDATE TO zuluhub_app
  USING (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND estado = 'PROPUESTO'
    AND entrante_persona_id = (SELECT app_persona_id())
  )
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND estado IN ('ACEPTADO', 'RECHAZADO')
    AND entrante_persona_id = (SELECT app_persona_id())
  );
-- Cancelar: la empresa, mientras esté en curso. Quién (gerente o administrador) lo impone el disparador.
CREATE POLICY traspaso_gerencia_app_cancelar ON traspaso_gerencia FOR UPDATE TO zuluhub_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND estado = 'PROPUESTO')
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND estado = 'CANCELADO');

CREATE POLICY traspaso_gerencia_plataforma_leer ON traspaso_gerencia FOR SELECT TO zuluhub_plataforma
  USING (true);
CREATE POLICY traspaso_gerencia_plataforma_alta ON traspaso_gerencia FOR INSERT TO zuluhub_plataforma
  WITH CHECK (origen = 'PLATAFORMA');
CREATE POLICY traspaso_gerencia_plataforma_cancelar ON traspaso_gerencia FOR UPDATE TO zuluhub_plataforma
  USING (estado = 'PROPUESTO') WITH CHECK (estado = 'CANCELADO');

-- Políticas RESTRICTIVAS de la plataforma (como las de 0004 sobre las demás tablas): sin un actor
-- vigente no ve nada, y solo un ADMIN propone o cancela (un SOPORTE no cambia a un gerente).
CREATE POLICY traspaso_gerencia_plataforma_con_actor ON traspaso_gerencia AS RESTRICTIVE FOR SELECT
  TO zuluhub_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY traspaso_gerencia_plataforma_admin_alta ON traspaso_gerencia AS RESTRICTIVE FOR INSERT
  TO zuluhub_plataforma WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY traspaso_gerencia_plataforma_admin_cambiar ON traspaso_gerencia AS RESTRICTIVE FOR UPDATE
  TO zuluhub_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));

-- ---------------------------------------------------------------------------------------------
-- membresia: el cambio de rol existe solo dentro de la transacción del traspaso (A1)
-- ---------------------------------------------------------------------------------------------
-- El WITH CHECK repite el traspaso: las políticas permisivas se suman (OR), y sin él la fila de
-- cualquier miembro activo pasaría el USING de `membresia_app_apagar` (rol <> 'GERENTE') y el
-- WITH CHECK (activo) de esta política.
CREATE POLICY membresia_app_traspasar ON membresia FOR UPDATE TO zuluhub_app
  USING (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND activo
    AND EXISTS (
      SELECT 1 FROM traspaso_gerencia t
       WHERE t.empresa_id = membresia.empresa_id AND t.estado = 'ACEPTADO'
         AND t.xmin = pg_current_xact_id()::xid
         AND membresia.persona_id IN (t.saliente_persona_id, t.entrante_persona_id)
    )
  )
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND activo
    AND EXISTS (
      SELECT 1 FROM traspaso_gerencia t
       WHERE t.empresa_id = membresia.empresa_id AND t.estado = 'ACEPTADO'
         AND t.xmin = pg_current_xact_id()::xid
         AND membresia.persona_id IN (t.saliente_persona_id, t.entrante_persona_id)
    )
  );

-- ---------------------------------------------------------------------------------------------
-- asignacion_sucursal: la empresa asigna y reasigna (A7)
-- ---------------------------------------------------------------------------------------------
CREATE POLICY asignacion_sucursal_app_alta ON asignacion_sucursal FOR INSERT TO zuluhub_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND EXISTS (
      SELECT 1 FROM membresia m
       WHERE m.empresa_id = asignacion_sucursal.empresa_id
         AND m.persona_id = asignacion_sucursal.persona_id AND m.activo
    )
    AND EXISTS (
      SELECT 1 FROM sucursal s
       WHERE s.id = asignacion_sucursal.sucursal_id
         AND s.empresa_id = asignacion_sucursal.empresa_id AND s.activa
    )
  );
CREATE POLICY asignacion_sucursal_app_reactivar ON asignacion_sucursal FOR UPDATE TO zuluhub_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND NOT activa)
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND activa
    AND EXISTS (
      SELECT 1 FROM membresia m
       WHERE m.empresa_id = asignacion_sucursal.empresa_id
         AND m.persona_id = asignacion_sucursal.persona_id AND m.activo
    )
    AND EXISTS (
      SELECT 1 FROM sucursal s
       WHERE s.id = asignacion_sucursal.sucursal_id
         AND s.empresa_id = asignacion_sucursal.empresa_id AND s.activa
    )
  );
