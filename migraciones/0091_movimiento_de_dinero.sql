-- 0091_movimiento_de_dinero (número provisorio; lo asigna la orquestadora al revisar): M-1, el acto «movimiento de dinero» de Caja (PR-M1).
-- QUÉ HACE:
--   1. Crea `movimiento_de_dinero` (solo inserción): ingresar o sacar plata de la caja sin ticket ni compra, en sus dos sentidos (ENTRADA / SALIDA),
--      con categoría, quién pagó o recibió y, en una devolución, a qué ingreso corresponde. Nadie la escribe todavía (PR-S2, PR-E1, PR-D1).
--   2. Reglas de la base: forma por sentido, alta (sesión abierta de esa sucursal; la salida apunta a su egreso manual), tope de devoluciones con
--      bloqueo (dos devoluciones a la vez se turnan), cuadre de la entrada al confirmar (Σ de sus cobros = importe) y «todo egreso que no es
--      efectivo tiene su acto de salida» al confirmar.
--   3. NO ADITIVO (AVISOS 3 y 4 del brief): reemplaza, en UN solo CREATE OR REPLACE, el cuerpo de `movimiento_caja_validar_alta`:
--        · AVISO 3: un COBRO se puede anular desde caja SOLO si su fila de `cobro` tiene origen `caja.movimiento_de_dinero`; los demás siguen sin poder.
--        · AVISO 4 (dueño, 19/11): la regla `movimiento_caja_solo_efectivo` deja de alcanzar al EGRESO_MANUAL (cualquier medio activo de la empresa);
--          FONDO_INICIAL e INGRESO_MANUAL siguen solo de efectivo.
--      El resto del cuerpo es el VIGENTE (verificado con pg_get_functiondef sobre 0001-0090; solo lo define 0027), byte a byte salvo lo marcado «M-1».
-- NO TOCA columnas de `movimiento_caja` ni de `cobro`, no rellena nada y no toca movimientos manuales viejos. Agrega TRES disparadores diferidos
--   (uno en `movimiento_caja`, uno en `cobro` filtrado por el origen nuevo, uno en la tabla nueva).
-- Reversión: `migraciones/reversiones/0091_revertir_movimiento_de_dinero.sql` — PIERDE los actos cargados y deja sus cobros y egresos sin acto; no
--   revertir con datos; AVISAR AL DUEÑO. Falla a propósito si hay egresos de un medio que no es efectivo o anulaciones de cobros del acto.
-- DEPENDE de 0001 (`solo_insercion`), 0027 (caja) y 0090 (cuerpo vigente de `cobro_validar_alta`, que no se toca). Probada por
--   `test/integracion/movimiento-de-dinero-migracion.test.ts`. Solo corre contra el Postgres local de las pruebas; nunca contra Neon.
-- Los largos y los conjuntos permitidos de los textos son los de sus primitivas (`caja/dominio/movimiento-de-dinero.ts`, `caja/dominio/texto.ts`,
--   `primitivas/texto/texto-de-una-linea.ts`): una prueba de paridad falla si difieren.

CREATE TABLE movimiento_de_dinero (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  sucursal_id         uuid NOT NULL,
  sesion_id           uuid NOT NULL,
  sentido             text NOT NULL,
  importe             numeric(18,2) NOT NULL,       -- ENTRADA: Σ de sus cobros; SALIDA: el del egreso (en positivo)
  moneda              char(3) NOT NULL DEFAULT 'ARS',
  categoria           text,                         -- solo la salida
  concepto            text,                         -- «por qué se cobró»: opcional, solo la entrada
  motivo              text,                         -- solo la salida (obligatorio)
  tercero_nombre      text,
  tercero_persona_id  uuid,                         -- solo la salida: un empleado
  referencia          text,                         -- solo la salida
  devuelve_a          uuid,                         -- solo con la categoría de devolución: el id de la ENTRADA
  movimiento_id       uuid,                         -- solo la salida: su EGRESO_MANUAL
  clave               text NOT NULL,
  huella              text NOT NULL,
  registrado_por      uuid NOT NULL,
  registrado_en       timestamptz NOT NULL,         -- el `ahora` de la aplicación, no now()
  creado_en           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movimiento_de_dinero_pkey PRIMARY KEY (empresa_id, id),
  CONSTRAINT movimiento_de_dinero_clave_uk UNIQUE (empresa_id, clave),
  -- Un egreso manual tiene a lo sumo UN acto.
  CONSTRAINT movimiento_de_dinero_movimiento_uk UNIQUE (empresa_id, movimiento_id),
  CONSTRAINT movimiento_de_dinero_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT movimiento_de_dinero_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT movimiento_de_dinero_sesion_fkey FOREIGN KEY (sesion_id, empresa_id) REFERENCES sesion_caja (id, empresa_id),
  CONSTRAINT movimiento_de_dinero_movimiento_fkey FOREIGN KEY (movimiento_id, empresa_id, sesion_id)
    REFERENCES movimiento_caja (id, empresa_id, sesion_id),
  CONSTRAINT movimiento_de_dinero_devuelve_a_fkey FOREIGN KEY (empresa_id, devuelve_a) REFERENCES movimiento_de_dinero (empresa_id, id),
  CONSTRAINT movimiento_de_dinero_tercero_persona_fkey FOREIGN KEY (tercero_persona_id) REFERENCES persona (id),
  CONSTRAINT movimiento_de_dinero_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES persona (id),
  CONSTRAINT movimiento_de_dinero_sentido_ck CHECK (sentido IN ('ENTRADA', 'SALIDA')),
  -- Mismo tope que `movimiento_caja_tope_ck` (0027): una salida de 999999999.99 es un egreso de -999999999.99.
  CONSTRAINT movimiento_de_dinero_importe_ck CHECK (importe > 0 AND importe <= 999999999.99),
  CONSTRAINT movimiento_de_dinero_moneda_ck CHECK (moneda = 'ARS'),
  CONSTRAINT movimiento_de_dinero_categoria_ck CHECK (
    categoria IS NULL OR categoria IN ('RETIRO_DEL_DUENO', 'GASTO_MENOR', 'ADELANTO_DE_SUELDO', 'PROPINA_ENTREGADA', 'OTRO', 'DEVOLUCION_DE_UN_COBRO')
  ),
  -- Forma por sentido: qué columnas pueden venir (un solo CHECK).
  CONSTRAINT movimiento_de_dinero_forma_ck CHECK (
    (sentido = 'ENTRADA' AND categoria IS NULL AND motivo IS NULL AND referencia IS NULL AND movimiento_id IS NULL
       AND devuelve_a IS NULL AND tercero_persona_id IS NULL)
    OR
    (sentido = 'SALIDA' AND categoria IS NOT NULL AND motivo IS NOT NULL AND movimiento_id IS NOT NULL AND concepto IS NULL)
  ),
  -- `devuelve_a` si y solo si la categoría es la devolución (con categoría nula, la forma ya decide).
  CONSTRAINT movimiento_de_dinero_devolucion_ck CHECK (
    (devuelve_a IS NOT NULL) = coalesce(categoria = 'DEVOLUCION_DE_UN_COBRO', false)
  ),
  CONSTRAINT movimiento_de_dinero_tercero_ck CHECK (tercero_nombre IS NULL OR tercero_persona_id IS NULL),
  -- Textos: recortados, sin espacios repetidos, largo y lista de permitidos de su primitiva.
  CONSTRAINT movimiento_de_dinero_tercero_nombre_ck CHECK (
    tercero_nombre IS NULL OR (
      tercero_nombre = btrim(tercero_nombre) AND tercero_nombre !~ ' {2}' AND char_length(tercero_nombre) BETWEEN 1 AND 200
      AND tercero_nombre ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&''/()°+:;"#ºª’“”–—«»®™-]+$'
      AND tercero_nombre ~ '[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ]' AND tercero_nombre !~ '^[+-]'
    )
  ),
  CONSTRAINT movimiento_de_dinero_motivo_ck CHECK (
    motivo IS NULL OR (
      motivo = btrim(motivo) AND motivo !~ ' {2}' AND char_length(motivo) BETWEEN 1 AND 500
      AND motivo ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
    )
  ),
  CONSTRAINT movimiento_de_dinero_concepto_ck CHECK (
    concepto IS NULL OR (
      concepto = btrim(concepto) AND concepto !~ ' {2}' AND char_length(concepto) BETWEEN 1 AND 200
      AND concepto ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
    )
  ),
  CONSTRAINT movimiento_de_dinero_referencia_ck CHECK (
    referencia IS NULL OR (
      referencia = btrim(referencia) AND referencia !~ ' {2}' AND char_length(referencia) BETWEEN 1 AND 40
      AND referencia ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
    )
  ),
  -- Misma forma que `cobranza_de_ticket` (0028).
  CONSTRAINT movimiento_de_dinero_clave_ck CHECK (clave ~ '^[A-Za-z0-9_-]{16,128}$'),
  CONSTRAINT movimiento_de_dinero_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$')
);
CREATE INDEX movimiento_de_dinero_sesion_ix ON movimiento_de_dinero (empresa_id, sesion_id, registrado_en, id);
CREATE INDEX movimiento_de_dinero_devuelve_a_ix ON movimiento_de_dinero (empresa_id, devuelve_a) WHERE devuelve_a IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- Una sola regla del tope de devoluciones: lo devolvible de una ENTRADA = lo cobrado − lo anulado de sus cobros − lo ya devuelto (devoluciones
-- vigentes: su egreso no está anulado). La usan el alta del acto y la anulación de un cobro del acto.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION movimiento_de_dinero_bloquear_entrada(p_empresa uuid, p_entrada uuid) RETURNS void LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  -- Bloqueo de una entrada: dos devoluciones (o una devolución y la anulación de un cobro) sobre la misma entrada se turnan. Es un bloqueo
  -- consultivo y no `SELECT … FOR UPDATE` porque la aplicación no tiene UPDATE sobre esta tabla (solo inserción) y `FOR UPDATE` lo exige.
  PERFORM pg_advisory_xact_lock(hashtextextended('pedernal.movimiento_de_dinero.entrada:' || p_empresa::text || ':' || p_entrada::text, 0));
END
$$;

CREATE FUNCTION movimiento_de_dinero_devolvible(p_empresa uuid, p_entrada uuid) RETURNS numeric LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT coalesce((SELECT sum(m.importe)
                     FROM public.cobro c
                     JOIN public.movimiento_caja m ON m.id = c.movimiento_id AND m.empresa_id = c.empresa_id
                    WHERE c.empresa_id = p_empresa AND c.origen_tipo = 'caja.movimiento_de_dinero' AND c.origen_id = p_entrada), 0)
       + coalesce((SELECT sum(a.importe)       -- las anulaciones llevan el importe con signo contrario
                     FROM public.cobro c
                     JOIN public.movimiento_caja a ON a.anula_a = c.movimiento_id AND a.empresa_id = c.empresa_id AND a.clase = 'ANULACION'
                    WHERE c.empresa_id = p_empresa AND c.origen_tipo = 'caja.movimiento_de_dinero' AND c.origen_id = p_entrada), 0)
       - coalesce((SELECT sum(d.importe)
                     FROM public.movimiento_de_dinero d
                    WHERE d.empresa_id = p_empresa AND d.devuelve_a = p_entrada
                      AND NOT EXISTS (SELECT 1 FROM public.movimiento_caja a
                                       WHERE a.empresa_id = d.empresa_id AND a.anula_a = d.movimiento_id AND a.clase = 'ANULACION')), 0)
$$;

-- ---------------------------------------------------------------------------------------------
-- Alta del acto
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION movimiento_de_dinero_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_caja uuid;
  v_sucursal uuid;
  v_egreso record;
  v_entrada record;
BEGIN
  -- La sesión está abierta y es de esa sucursal (también cuando la salida es por un medio que no es efectivo: ahí es lo que obliga a tener caja
  -- abierta). La espera contra un cierre en vuelo la hacen los movimientos de caja que acompañan al acto (su disparador toma la sesión).
  SELECT s.estado, s.caja_id INTO v_estado, v_caja
    FROM public.sesion_caja s WHERE s.id = NEW.sesion_id AND s.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'la sesión de caja no está abierta'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_sesion_no_abierta';
  END IF;
  SELECT c.sucursal_id INTO v_sucursal FROM public.caja c WHERE c.id = v_caja AND c.empresa_id = NEW.empresa_id;
  IF v_sucursal IS DISTINCT FROM NEW.sucursal_id THEN
    RAISE EXCEPTION 'la sesión de caja es de otra sucursal'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_sucursal_invalida';
  END IF;

  IF NEW.sentido = 'SALIDA' THEN
    -- Su egreso: un EGRESO_MANUAL de esa sesión (la clave foránea compuesta ya la fija), con cualquier medio y por el mismo importe.
    SELECT m.clase, m.importe INTO v_egreso
      FROM public.movimiento_caja m
     WHERE m.id = NEW.movimiento_id AND m.empresa_id = NEW.empresa_id AND m.sesion_id = NEW.sesion_id;
    IF NOT FOUND OR v_egreso.clase <> 'EGRESO_MANUAL' OR v_egreso.importe <> -NEW.importe THEN
      RAISE EXCEPTION 'la salida tiene que apuntar a un egreso manual de la sesión por el mismo importe'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_egreso_invalido';
    END IF;

    IF NEW.categoria = 'DEVOLUCION_DE_UN_COBRO' THEN
      SELECT d.sentido, d.sucursal_id INTO v_entrada
        FROM public.movimiento_de_dinero d WHERE d.id = NEW.devuelve_a AND d.empresa_id = NEW.empresa_id;
      IF NOT FOUND OR v_entrada.sentido <> 'ENTRADA' OR v_entrada.sucursal_id <> NEW.sucursal_id THEN
        RAISE EXCEPTION 'la devolución tiene que ser de una entrada de la misma empresa y sucursal'
          USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_devuelve_a_invalida';
      END IF;
      -- Tope: se bloquea la entrada y, con el bloqueo tomado, se mide lo devolvible (bajo READ COMMITTED la medición ve lo que confirmó quien
      -- esperaba; bajo SERIALIZABLE, el detector de anomalías aborta con 40001 a uno de los dos y el reintento ve el tope).
      PERFORM public.movimiento_de_dinero_bloquear_entrada(NEW.empresa_id, NEW.devuelve_a);
      IF public.movimiento_de_dinero_devolvible(NEW.empresa_id, NEW.devuelve_a) < NEW.importe THEN
        RAISE EXCEPTION 'la devolución supera lo cobrado de la entrada'
          USING ERRCODE = '23514', CONSTRAINT = 'devolucion_supera_lo_cobrado';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Cuadre de la entrada, al confirmar: Σ de los cobros con origen ('caja.movimiento_de_dinero', id) = importe, y todos de la sesión del acto.
-- Se dispara con el acto Y con cada cobro de ese origen: ni faltan cobros ni se agregan de más.
CREATE FUNCTION movimiento_de_dinero_verificar_cuadre() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_acto_id uuid;
  v_acto record;
  v_suma numeric;
  v_de_otra_sesion bigint;
BEGIN
  -- Una función para dos tablas: `to_jsonb` evita nombrar una columna que la otra no tiene (como `cambio_de_plan_validar_origen`, 0089).
  v_acto_id := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'cobro' THEN 'origen_id' ELSE 'id' END)::uuid;
  SELECT d.sentido, d.importe, d.sesion_id INTO v_acto
    FROM public.movimiento_de_dinero d WHERE d.id = v_acto_id AND d.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_acto.sentido <> 'ENTRADA' THEN
    RAISE EXCEPTION 'un cobro de este origen tiene que ser de una entrada de dinero'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_no_cuadra';
  END IF;
  SELECT coalesce(sum(m.importe), 0), count(*) FILTER (WHERE m.sesion_id <> v_acto.sesion_id) INTO v_suma, v_de_otra_sesion
    FROM public.cobro c
    JOIN public.movimiento_caja m ON m.id = c.movimiento_id AND m.empresa_id = c.empresa_id
   WHERE c.empresa_id = NEW.empresa_id AND c.origen_tipo = 'caja.movimiento_de_dinero' AND c.origen_id = v_acto_id;
  IF v_suma <> v_acto.importe OR v_de_otra_sesion > 0 THEN
    RAISE EXCEPTION 'los cobros de la entrada no suman su importe'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_no_cuadra';
  END IF;
  RETURN NULL;
END
$$;

-- Todo egreso manual de un medio que no es efectivo tiene su acto de salida (la puerta nueva del AVISO 4 no queda abierta a quien no pasa por el
-- acto). Una anulación espejo es clase ANULACION y no entra. Los egresos en efectivo siguen como hasta hoy.
CREATE FUNCTION movimiento_caja_verificar_egreso_con_acto() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.clase = 'EGRESO_MANUAL'
     AND NOT EXISTS (SELECT 1 FROM public.medio_de_pago d
                      WHERE d.id = NEW.medio_de_pago_id AND d.empresa_id = NEW.empresa_id AND d.tipo = 'EFECTIVO')
     AND NOT EXISTS (SELECT 1 FROM public.movimiento_de_dinero a
                      WHERE a.empresa_id = NEW.empresa_id AND a.movimiento_id = NEW.id AND a.sentido = 'SALIDA') THEN
    RAISE EXCEPTION 'un egreso por un medio que no es efectivo tiene que tener su salida de dinero'
      USING ERRCODE = '23514', CONSTRAINT = 'egreso_no_efectivo_sin_acto';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER movimiento_de_dinero_alta BEFORE INSERT ON movimiento_de_dinero
  FOR EACH ROW EXECUTE FUNCTION movimiento_de_dinero_validar_alta();
CREATE TRIGGER movimiento_de_dinero_solo_insercion BEFORE UPDATE OR DELETE ON movimiento_de_dinero
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER movimiento_de_dinero_sin_truncate BEFORE TRUNCATE ON movimiento_de_dinero
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE CONSTRAINT TRIGGER movimiento_de_dinero_cuadre AFTER INSERT ON movimiento_de_dinero
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.sentido = 'ENTRADA') EXECUTE FUNCTION movimiento_de_dinero_verificar_cuadre();
CREATE CONSTRAINT TRIGGER cobro_de_movimiento_de_dinero_cuadre AFTER INSERT ON cobro
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.origen_tipo = 'caja.movimiento_de_dinero') EXECUTE FUNCTION movimiento_de_dinero_verificar_cuadre();
CREATE CONSTRAINT TRIGGER movimiento_caja_egreso_con_acto AFTER INSERT ON movimiento_caja
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.clase = 'EGRESO_MANUAL') EXECUTE FUNCTION movimiento_caja_verificar_egreso_con_acto();

-- ---------------------------------------------------------------------------------------------
-- AVISOS 3 y 4: el cuerpo vigente de `movimiento_caja_validar_alta`, con SOLO tres cambios (marcados «M-1»).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION movimiento_caja_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_sesion record;
  v_sucursal uuid;
  v_estado_de_jornada text;
  v_tipo text;
  v_original record;
  v_estado_a_corregir text;
  v_acto uuid;                                     -- M-1: la entrada de dinero a la que pertenece el cobro que se anula
BEGIN
  IF NEW.registrado_por IS DISTINCT FROM public.app_persona_id() THEN
    RAISE EXCEPTION 'el movimiento lo registra la persona del contexto'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_actor_invalido';
  END IF;

  -- C1. `iniciar cierre` y `cerrar` (UPDATE de la sesión) esperan a los movimientos en vuelo; el que llega después de un cierre ve la
  -- sesión EN_CIERRE/CERRADA. (Una CERRADA no pasa la política de UPDATE que usan los dos bloqueos: «no encontrada».)
  --  * Transacción SERIALIZABLE (la de la aplicación): `FOR SHARE`. Es una lectura de la sesión para el detector de anomalías
  --    serializables: contra un cierre serializable que ya calculó el esperado, uno de los dos falla con 40001 y se reintenta.
  --  * Cualquier otro aislamiento (SQL directo en READ COMMITTED): ese detector no ve a esta transacción, y `FOR SHARE` solo bloquea,
  --    no versiona la fila: el cierre serializable seguía, con su instantánea vieja, y cerraba la sesión sin contar este movimiento
  --    (hueco de dinero: arqueo 0,00 contra 100,00 cobrados). Por eso ahí se ESCRIBE la sesión (toque sin cambios, ver
  --    `sesion_caja_validar_cambio`): el cierre serializable choca con una versión posterior a su instantánea y falla con 40001 en vez de
  --    confirmar; si el cierre llegó primero, esta espera, ve la sesión cerrada y se rechaza.
  IF current_setting('transaction_isolation') = 'serializable' THEN
    SELECT s.estado, s.caja_id, s.fecha_negocio INTO v_sesion
      FROM public.sesion_caja s WHERE s.id = NEW.sesion_id AND s.empresa_id = NEW.empresa_id FOR SHARE;
  ELSE
    UPDATE public.sesion_caja s SET estado = s.estado
     WHERE s.id = NEW.sesion_id AND s.empresa_id = NEW.empresa_id AND s.estado = 'ABIERTA'
    RETURNING s.estado, s.caja_id, s.fecha_negocio INTO v_sesion;
  END IF;
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
    -- M-1: salvo un cobro de una entrada de dinero (origen `caja.movimiento_de_dinero`): ese sí se anula, el mismo día, desde caja.
    SELECT m.clase, m.medio_de_pago_id, m.cuenta_de_cobro_id, m.importe INTO v_original
      FROM public.movimiento_caja m
     WHERE m.id = NEW.anula_a AND m.empresa_id = NEW.empresa_id AND m.sesion_id = NEW.sesion_id;
    IF NOT FOUND THEN
      RETURN NEW;                                  -- lo rechaza la clave foránea `movimiento_caja_anula_fkey`
    END IF;
    IF v_original.clase = 'COBRO' THEN
      SELECT c.origen_id INTO v_acto                -- M-1
        FROM public.cobro c
       WHERE c.movimiento_id = NEW.anula_a AND c.empresa_id = NEW.empresa_id AND c.origen_tipo = 'caja.movimiento_de_dinero';
      IF NOT FOUND THEN                             -- M-1
        RAISE EXCEPTION 'un cobro con origen no se anula desde caja'
          USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_anulacion_con_origen';
      END IF;
    END IF;
    IF v_original.clase NOT IN ('INGRESO_MANUAL', 'EGRESO_MANUAL', 'AJUSTE', 'COBRO')   -- M-1: 'COBRO' solo llega acá si es del acto
       OR NEW.medio_de_pago_id <> v_original.medio_de_pago_id
       OR NEW.cuenta_de_cobro_id IS DISTINCT FROM v_original.cuenta_de_cobro_id
       OR NEW.importe <> -v_original.importe THEN
      RAISE EXCEPTION 'la anulación tiene que ser el espejo exacto de un ingreso, egreso o ajuste'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_anulacion_invalida';
    END IF;
    IF v_acto IS NOT NULL THEN
      -- M-1: no se anula un cobro cuya plata ya se devolvió (el tope de devoluciones se sostiene también desde este lado; mismo bloqueo).
      PERFORM public.movimiento_de_dinero_bloquear_entrada(NEW.empresa_id, v_acto);
      IF public.movimiento_de_dinero_devolvible(NEW.empresa_id, v_acto) + NEW.importe < 0 THEN
        RAISE EXCEPTION 'el cobro ya se devolvió: se anula primero la devolución'
          USING ERRCODE = '23514', CONSTRAINT = 'movimiento_caja_anulacion_con_devolucion';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- C4. Medio activo y cuenta (si viene) activa, de la sucursal de la caja y de un tipo que el medio admite.
  v_tipo := public.par_de_cobro_validar('movimiento_caja', NEW.empresa_id, v_sucursal, NEW.medio_de_pago_id,
                                        NEW.cuenta_de_cobro_id, true);
  -- El fondo y los ingresos manuales son solo de efectivo. M-1 (dueño, 19/11): el egreso manual admite cualquier medio activo de la empresa
  -- (el disparador diferido `movimiento_caja_egreso_con_acto` exige que, si no es efectivo, tenga su acto de salida).
  IF NEW.clase IN ('FONDO_INICIAL', 'INGRESO_MANUAL') AND v_tipo <> 'EFECTIVO' THEN
    RAISE EXCEPTION 'el fondo y los ingresos manuales son solo de efectivo'
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

-- ---------------------------------------------------------------------------------------------
-- Privilegios y seguridad por fila (el patrón de caja): la aplicación inserta y lee; nadie actualiza ni borra.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON movimiento_de_dinero FROM PUBLIC;
-- Las dos funciones del tope las llama (como la aplicación) el disparador de `movimiento_caja`, que no es SECURITY DEFINER.
GRANT EXECUTE ON FUNCTION movimiento_de_dinero_bloquear_entrada(uuid, uuid), movimiento_de_dinero_devolvible(uuid, uuid) TO pedernal_app;
GRANT SELECT ON movimiento_de_dinero TO pedernal_app;
GRANT INSERT (empresa_id, sucursal_id, sesion_id, sentido, importe, moneda, categoria, concepto, motivo, tercero_nombre, tercero_persona_id,
              referencia, devuelve_a, movimiento_id, clave, huella, registrado_por, registrado_en)
  ON movimiento_de_dinero TO pedernal_app;

ALTER TABLE movimiento_de_dinero ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimiento_de_dinero FORCE ROW LEVEL SECURITY;
CREATE POLICY movimiento_de_dinero_app_leer ON movimiento_de_dinero FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY movimiento_de_dinero_app_alta ON movimiento_de_dinero FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND registrado_por = (SELECT app_persona_id()));
