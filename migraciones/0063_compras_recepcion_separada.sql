-- 0063_compras_recepcion_separada: compras N3 `RECEPCION_SEPARADA` (E9 T13). Recibir y confirmar son dos momentos: la recepción nace PENDIENTE, la confirma un gerente o un
-- administrador (decisión del dueño del 14/11/2026, Q9: «confirmar» una recepción existe solo en N3) y recién ahí entra el stock. Cada línea recibida se controla
-- (conforme, con observaciones, rechazada) y el stock entra al depósito que elige quien recibe (cuarentena y rechazo incluidos: tramo N3-3, compras.md D-16).
-- Especificación: 11-especificaciones/compras.md del repositorio de documentación (Anexo C.2), e9-compras-especificacion.md §3.8 y decisiones-del-dueno-2026-11.md (14/11 y 16/11).
--
-- Reglas de esta migración (las mismas de 0001 a 0057):
--  * ADITIVA y compatible hacia atrás: agrega dos columnas NULABLES y dos tablas; AFLOJA el CHECK del estado (suma PENDIENTE) y reemplaza el índice único del remito y el
--    disparador de transiciones de la recepción. Ninguna recepción existente cambia. N1 y N2 no pueden producir PENDIENTE (CHECK `recepcion_pendiente_ck`).
--  * Sin funciones SECURITY DEFINER; toda función fija `search_path = pg_catalog, public, pg_temp`. Nadie recibe DELETE ni TRUNCATE. INSERT y UPDATE por columna. RLS
--    activa y FORZADA, una política por comando. Toda clave foránea entre tablas de empresa es COMPUESTA.
--  * Reversión: `migraciones/reversiones/0063_revertir_compras_recepcion_separada.sql` (FRENA si hay recepciones PENDIENTE, confirmadas por N3, controles o entradas).
--  * DEPENDE de 0037 (compras) y 0030 (depósito y movimiento de stock); se comprueba al empezar.
--
-- Decisiones de diseño (probadas por `test/integracion/compras-n3-migracion.test.ts`):
--  N1. `PENDIENTE → CONFIRMADA | ANULADA` y `CONFIRMADA → ANULADA`; solo PENDIENTE → CONFIRMADA fija `confirmada_por` y `confirmada_en` (la hora la pone la base).
--  N2. El stock de una recepción N3 NO se guarda en `linea_de_recepcion.movimiento_id` (la línea es de solo inserción y nace antes de confirmar): cada entrada es una fila de
--      `entrada_de_linea_de_recepcion`, una por línea y depósito (un mismo movimiento de stock puede cubrir varias líneas del mismo depósito), y solo entra en la transacción que confirma.
--  N3. El control de una línea (`inspeccion_de_linea_de_recepcion`) solo entra en la transacción de su recepción y solo en una recepción de nivel N3 o N4. Sin fila = no se
--      constató (no hay un CONFORME por defecto). La observación escrita es obligatoria si la línea no es conforme.
--  N4. Un remito no se carga dos veces entre las recepciones PENDIENTES y CONFIRMADAS (la anulada libera el número).

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.recepcion') IS NULL OR to_regclass('public.linea_de_recepcion') IS NULL THEN
    RAISE EXCEPTION 'compras N3 requiere 0037_compras aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.deposito') IS NULL OR to_regclass('public.movimiento_de_stock') IS NULL THEN
    RAISE EXCEPTION 'compras N3 requiere 0030_stock aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recepcion' AND column_name = 'confirmada_por') THEN
    RAISE EXCEPTION 'compras N3: recepcion.confirmada_por ya existe; esta migración solo agrega objetos nuevos' USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['inspeccion_de_linea_de_recepcion', 'entrada_de_linea_de_recepcion'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'compras N3: la tabla % ya existe; esta migración solo crea objetos nuevos', v_tabla USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- ================================================================================================
-- La recepción puede quedar PENDIENTE de confirmar (solo en N3 y N4)
-- ================================================================================================
ALTER TABLE recepcion
  ADD COLUMN confirmada_por uuid REFERENCES persona (id),
  ADD COLUMN confirmada_en timestamptz;

ALTER TABLE recepcion DROP CONSTRAINT recepcion_estado_ck;
ALTER TABLE recepcion ADD CONSTRAINT recepcion_estado_ck CHECK (estado IN ('PENDIENTE', 'CONFIRMADA', 'ANULADA'));
ALTER TABLE recepcion ADD CONSTRAINT recepcion_confirmacion_ck CHECK ((confirmada_por IS NULL) = (confirmada_en IS NULL));
-- Pendiente: solo en N3 o N4, nunca un atajo, sin confirmar ni anular.
ALTER TABLE recepcion ADD CONSTRAINT recepcion_pendiente_ck CHECK (
  estado <> 'PENDIENTE' OR (nivel IN ('RECEPCION_SEPARADA', 'TRES_VIAS') AND NOT es_atajo AND confirmada_por IS NULL AND anulada_por IS NULL));
-- Quien confirma solo existe en N3 y N4; y una recepción N3 o N4 que no es atajo no queda CONFIRMADA sin que alguien la haya confirmado.
ALTER TABLE recepcion ADD CONSTRAINT recepcion_confirmada_nivel_ck CHECK (confirmada_por IS NULL OR nivel IN ('RECEPCION_SEPARADA', 'TRES_VIAS'));
ALTER TABLE recepcion ADD CONSTRAINT recepcion_confirmada_ck CHECK (
  estado <> 'CONFIRMADA' OR es_atajo OR nivel IN ('COMPRA_SIMPLE', 'CON_COMPROBANTE') OR confirmada_por IS NOT NULL);

-- N4: el remito no se repite entre las pendientes y las confirmadas (mismo nombre: el código ya traduce este índice).
DROP INDEX recepcion_remito_uk;
CREATE UNIQUE INDEX recepcion_remito_uk ON recepcion (empresa_id, proveedor_id, remito_punto_de_venta, remito_numero)
  WHERE remito_numero IS NOT NULL AND estado IN ('PENDIENTE', 'CONFIRMADA');

-- N1: transiciones y columnas que pueden cambiar (reemplaza a `compras_solo_cambia_estado` solo para la recepción; esa función sigue sirviendo a comprobantes y pagos).
CREATE FUNCTION compras_recepcion_cambia_estado() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_columnas text[] := ARRAY['estado', 'anulada_por', 'anulada_en', 'motivo_de_anulacion', 'confirmada_por', 'confirmada_en', 'version', 'actualizado_en'];
BEGIN
  IF (to_jsonb(NEW) - v_columnas) IS DISTINCT FROM (to_jsonb(OLD) - v_columnas) THEN
    RAISE EXCEPTION 'solo cambian el estado, la confirmación y la anulación: el resto es inmutable' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_inmutable';
  END IF;
  IF NEW.estado <> OLD.estado AND NOT ((OLD.estado = 'PENDIENTE' AND NEW.estado IN ('CONFIRMADA', 'ANULADA')) OR (OLD.estado = 'CONFIRMADA' AND NEW.estado = 'ANULADA')) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado USING ERRCODE = '23514', CONSTRAINT = 'recepcion_transicion_invalida';
  END IF;
  IF (NEW.confirmada_por IS DISTINCT FROM OLD.confirmada_por OR NEW.confirmada_en IS DISTINCT FROM OLD.confirmada_en)
     AND NOT (OLD.estado = 'PENDIENTE' AND NEW.estado = 'CONFIRMADA') THEN
    RAISE EXCEPTION 'la confirmación solo se fija al pasar de PENDIENTE a CONFIRMADA' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_confirmacion_invalida';
  END IF;
  IF OLD.estado = 'PENDIENTE' AND NEW.estado = 'CONFIRMADA' THEN
    NEW.confirmada_en := now();
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER recepcion_estado ON recepcion;
CREATE TRIGGER recepcion_estado BEFORE UPDATE ON recepcion FOR EACH ROW EXECUTE FUNCTION compras_recepcion_cambia_estado();
-- El orden de disparo es por nombre: `recepcion_estado` corre antes que `recepcion_version`, igual que en 0037.

-- `estado` entra en el alta solo para que una recepción N3 o N4 nazca PENDIENTE (el CHECK `recepcion_pendiente_ck` impide el resto; ANULADA exige datos que el alta no puede escribir).
GRANT INSERT (estado) ON recepcion TO pedernal_app;
GRANT UPDATE (confirmada_por, confirmada_en) ON recepcion TO pedernal_app;

-- ================================================================================================
-- Control de la mercadería (N3) y entradas de stock de la recepción confirmada (N2)
-- ================================================================================================
CREATE TABLE inspeccion_de_linea_de_recepcion (
  empresa_id            uuid NOT NULL REFERENCES empresa (id),
  recepcion_id          uuid NOT NULL,
  linea                 integer NOT NULL,
  cantidad_segun_remito numeric(18,4) CONSTRAINT inspeccion_cantidad_remito_ck CHECK (cantidad_segun_remito > 0 AND cantidad_segun_remito < 100000000000000),
  condicion             text NOT NULL CONSTRAINT inspeccion_condicion_ck CHECK (condicion IN ('CONFORME', 'CON_OBSERVACIONES', 'RECHAZADA')),
  observacion           text CONSTRAINT inspeccion_observacion_ck CHECK (observacion IS NULL OR texto_de_catalogo_valido(observacion, 500)),
  -- Solo plausibilidad física: el rango aceptable lo decide quien recibe (norma sanitaria sin verificar, compras.md NV5).
  temperatura_en_c      numeric(5,1) CONSTRAINT inspeccion_temperatura_ck CHECK (temperatura_en_c > -273.15 AND temperatura_en_c < 1000),
  registrado_en         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspeccion_de_linea_de_recepcion_pkey PRIMARY KEY (empresa_id, recepcion_id, linea),
  CONSTRAINT inspeccion_linea_fkey FOREIGN KEY (empresa_id, recepcion_id, linea) REFERENCES linea_de_recepcion (empresa_id, recepcion_id, numero),
  CONSTRAINT inspeccion_observacion_requerida_ck CHECK (condicion = 'CONFORME' OR observacion IS NOT NULL)
);

CREATE TABLE entrada_de_linea_de_recepcion (
  empresa_id    uuid NOT NULL REFERENCES empresa (id),
  recepcion_id  uuid NOT NULL,
  linea         integer NOT NULL,
  deposito_id   uuid NOT NULL,
  movimiento_id uuid NOT NULL,
  cantidad      numeric(18,4) NOT NULL CONSTRAINT entrada_de_linea_cantidad_ck CHECK (cantidad > 0 AND cantidad < 100000000000000),
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entrada_de_linea_de_recepcion_pkey PRIMARY KEY (empresa_id, recepcion_id, linea, deposito_id),
  CONSTRAINT entrada_de_linea_linea_fkey FOREIGN KEY (empresa_id, recepcion_id, linea) REFERENCES linea_de_recepcion (empresa_id, recepcion_id, numero),
  CONSTRAINT entrada_de_linea_deposito_fkey FOREIGN KEY (deposito_id, empresa_id) REFERENCES deposito (id, empresa_id),
  CONSTRAINT entrada_de_linea_movimiento_fkey FOREIGN KEY (movimiento_id, empresa_id) REFERENCES movimiento_de_stock (id, empresa_id)
);

-- N3: el control entra con su recepción (misma transacción) y solo en una recepción N3 o N4.
CREATE FUNCTION compras_inspeccion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_nivel text;
  v_registrado timestamptz;
BEGIN
  SELECT r.nivel, r.registrado_en INTO v_nivel, v_registrado FROM public.recepcion r WHERE r.id = NEW.recepcion_id AND r.empresa_id = NEW.empresa_id;
  IF v_nivel IS NULL OR v_nivel NOT IN ('RECEPCION_SEPARADA', 'TRES_VIAS') THEN
    RAISE EXCEPTION 'el control de la mercadería solo existe en una recepción de nivel N3 o N4' USING ERRCODE = '23514', CONSTRAINT = 'inspeccion_nivel_ck';
  END IF;
  IF v_registrado IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'el control solo entra en la transacción de su recepción' USING ERRCODE = '23514', CONSTRAINT = 'inspeccion_cabecera_confirmada';
  END IF;
  NEW.registrado_en := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER inspeccion_validar BEFORE INSERT ON inspeccion_de_linea_de_recepcion FOR EACH ROW EXECUTE FUNCTION compras_inspeccion_validar();

-- N2: la entrada de stock solo entra en la transacción que CONFIRMA la recepción (o en la que la crea ya confirmada como atajo), y nunca supera lo recibido en la línea.
CREATE FUNCTION compras_entrada_de_linea_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_nivel text;
  v_registrado timestamptz;
  v_confirmada timestamptz;
  v_recibido numeric;
  v_ya numeric;
BEGIN
  SELECT r.estado, r.nivel, r.registrado_en, r.confirmada_en INTO v_estado, v_nivel, v_registrado, v_confirmada
    FROM public.recepcion r WHERE r.id = NEW.recepcion_id AND r.empresa_id = NEW.empresa_id FOR SHARE;
  IF v_nivel IS NULL OR v_nivel NOT IN ('RECEPCION_SEPARADA', 'TRES_VIAS') THEN
    RAISE EXCEPTION 'las entradas por línea solo existen en una recepción de nivel N3 o N4' USING ERRCODE = '23514', CONSTRAINT = 'entrada_de_linea_nivel_ck';
  END IF;
  IF v_estado <> 'CONFIRMADA' OR (v_confirmada IS DISTINCT FROM now() AND v_registrado IS DISTINCT FROM now()) THEN
    RAISE EXCEPTION 'el stock solo entra en la transacción que confirma la recepción' USING ERRCODE = '23514', CONSTRAINT = 'entrada_de_linea_confirmacion';
  END IF;
  SELECT l.cantidad_en_stock INTO v_recibido FROM public.linea_de_recepcion l
   WHERE l.empresa_id = NEW.empresa_id AND l.recepcion_id = NEW.recepcion_id AND l.numero = NEW.linea;
  SELECT coalesce(sum(e.cantidad), 0) INTO v_ya FROM public.entrada_de_linea_de_recepcion e
   WHERE e.empresa_id = NEW.empresa_id AND e.recepcion_id = NEW.recepcion_id AND e.linea = NEW.linea;
  IF v_ya + NEW.cantidad > v_recibido THEN
    RAISE EXCEPTION 'las entradas de la línea superan lo recibido (% de %)', v_ya + NEW.cantidad, v_recibido USING ERRCODE = '23514', CONSTRAINT = 'entrada_de_linea_excede_lo_recibido';
  END IF;
  NEW.registrado_en := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER entrada_de_linea_validar BEFORE INSERT ON entrada_de_linea_de_recepcion FOR EACH ROW EXECUTE FUNCTION compras_entrada_de_linea_validar();

CREATE TRIGGER inspeccion_solo_insercion BEFORE UPDATE OR DELETE ON inspeccion_de_linea_de_recepcion FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER inspeccion_sin_truncate BEFORE TRUNCATE ON inspeccion_de_linea_de_recepcion FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER entrada_de_linea_solo_insercion BEFORE UPDATE OR DELETE ON entrada_de_linea_de_recepcion FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER entrada_de_linea_sin_truncate BEFORE TRUNCATE ON entrada_de_linea_de_recepcion FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ================================================================================================
-- Privilegios y RLS
-- ================================================================================================
REVOKE ALL ON inspeccion_de_linea_de_recepcion, entrada_de_linea_de_recepcion FROM PUBLIC;
GRANT SELECT ON inspeccion_de_linea_de_recepcion, entrada_de_linea_de_recepcion TO pedernal_app;
GRANT INSERT (empresa_id, recepcion_id, linea, cantidad_segun_remito, condicion, observacion, temperatura_en_c) ON inspeccion_de_linea_de_recepcion TO pedernal_app;
GRANT INSERT (empresa_id, recepcion_id, linea, deposito_id, movimiento_id, cantidad) ON entrada_de_linea_de_recepcion TO pedernal_app;

DO $$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['inspeccion_de_linea_de_recepcion', 'entrada_de_linea_de_recepcion'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()))', v_tabla || '_app_leer', v_tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO pedernal_app WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))',
      v_tabla || '_app_alta', v_tabla);
  END LOOP;
END
$$;
