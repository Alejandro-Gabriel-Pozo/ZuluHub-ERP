-- 0067_compras_diferencias: compras N4 `TRES_VIAS`, segunda mitad (E9 §3.8; compras.md Anexo C.4 y C.5): las TOLERANCIAS de la empresa, las tolerancias aplicadas a cada conciliación (copia) y las
-- DIFERENCIAS de la conciliación con su resolución. Decisiones del dueño (14 y 16/11/2026): sin tolerancias por defecto (vacío = «no definida» = toda diferencia queda ABIERTA; las configura el gerente
-- con `compras.configurar`); «Qué hacer con la diferencia» ofrece siete resoluciones; el precio de referencia es el de la línea de la ORDEN si la recepción es contra una orden y, si no, el de la
-- RECEPCIÓN; TOTAL_NO_CIERRA y RECIBIDO_DISTINTO_DE_LO_PEDIDO quedan fuera de este tramo. Nunca se descarta una diferencia en silencio.
-- ADITIVA: tres tablas nuevas y el reemplazo de las dos funciones de 0066 que topan lo recibido contra la orden (solo agregan la tolerancia de recepción; con la tolerancia vacía son idénticas).
-- Sin SECURITY DEFINER; search_path fijo; nadie recibe DELETE ni TRUNCATE; INSERT y UPDATE por columna; RLS activa y forzada; FK compuestas con la empresa.
-- Reversión: migraciones/reversiones/0067_revertir_compras_diferencias.sql (FRENA si hay filas; restaura las dos funciones de 0066). DEPENDE de 0037, 0063 y 0066.

DO $$
DECLARE v_tabla text;
BEGIN
  IF to_regclass('public.orden_de_compra') IS NULL OR to_regclass('public.conciliacion') IS NULL THEN
    RAISE EXCEPTION 'compras N4 (diferencias) requiere 0037 y 0066 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['tolerancia_de_compras', 'tolerancia_aplicada_de_conciliacion', 'diferencia_de_compra'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'compras N4: la tabla % ya existe; esta migración solo crea objetos nuevos', v_tabla USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- Tolerancias de la empresa (clase E: rigen hacia adelante). NULL = no definida (≠ 0). Todas NULL salvo que el gerente las fije.
CREATE TABLE tolerancia_de_compras (
  empresa_id              uuid PRIMARY KEY REFERENCES empresa (id),
  tolerancia_de_cantidad  numeric(7,4) CONSTRAINT tolerancia_cantidad_ck CHECK (tolerancia_de_cantidad >= 0 AND tolerancia_de_cantidad <= 100),   -- % sobre lo recibido (conciliación)
  tolerancia_de_precio    numeric(7,4) CONSTRAINT tolerancia_precio_ck CHECK (tolerancia_de_precio >= 0 AND tolerancia_de_precio <= 100),         -- % sobre el precio de referencia
  tolerancia_de_importe   numeric(18,2) CONSTRAINT tolerancia_importe_ck CHECK (tolerancia_de_importe >= 0 AND tolerancia_de_importe <= 9999999999999.99), -- en pesos
  tolerancia_de_recepcion numeric(7,4) CONSTRAINT tolerancia_recepcion_ck CHECK (tolerancia_de_recepcion >= 0 AND tolerancia_de_recepcion <= 100),   -- % sobre lo pedido
  creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  CONSTRAINT tolerancia_de_compras_configuracion_fkey FOREIGN KEY (empresa_id) REFERENCES configuracion_de_compras (empresa_id));
CREATE TRIGGER tolerancia_de_compras_version BEFORE UPDATE ON tolerancia_de_compras FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER tolerancia_de_compras_sin_borrado BEFORE DELETE ON tolerancia_de_compras FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER tolerancia_de_compras_sin_truncate BEFORE TRUNCATE ON tolerancia_de_compras FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- Las tolerancias vigentes al conciliar, copiadas a la conciliación (que es de solo inserción). Solo inserción; entra con su conciliación.
CREATE TABLE tolerancia_aplicada_de_conciliacion (
  empresa_id uuid NOT NULL REFERENCES empresa (id), conciliacion_id uuid NOT NULL,
  tolerancia_de_cantidad numeric(7,4), tolerancia_de_precio numeric(7,4), tolerancia_de_importe numeric(18,2),
  CONSTRAINT tolerancia_aplicada_de_conciliacion_pkey PRIMARY KEY (empresa_id, conciliacion_id),
  CONSTRAINT tolerancia_aplicada_conciliacion_fkey FOREIGN KEY (conciliacion_id, empresa_id) REFERENCES conciliacion (id, empresa_id));
CREATE TRIGGER tolerancia_aplicada_solo_insercion BEFORE UPDATE OR DELETE ON tolerancia_aplicada_de_conciliacion FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER tolerancia_aplicada_sin_truncate BEFORE TRUNCATE ON tolerancia_aplicada_de_conciliacion FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- Diferencias: una por conciliación, tipo y par de líneas (reintentar la conciliación no duplica). Con los umbrales aplicados (NULL = no definida).
CREATE TABLE diferencia_de_compra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresa (id), conciliacion_id uuid NOT NULL,
  tipo text NOT NULL CONSTRAINT diferencia_tipo_ck CHECK (tipo IN ('FACTURADO_DISTINTO_DE_LO_RECIBIDO', 'PRECIO_DISTINTO', 'FACTURADO_Y_NO_RECIBIDO')),
  comprobante_id uuid NOT NULL, linea_de_comprobante integer, recepcion_id uuid, linea_de_recepcion integer,
  cantidad_de_diferencia numeric(18,4), importe_de_diferencia numeric(18,2),                         -- con signo; NULL = no aplica / sin precio
  precio_facturado numeric(18,6) CONSTRAINT diferencia_precio_facturado_ck CHECK (precio_facturado >= 0 AND precio_facturado < 10000000000000),
  precio_de_referencia numeric(18,6) CONSTRAINT diferencia_precio_referencia_ck CHECK (precio_de_referencia >= 0 AND precio_de_referencia < 10000000000000),
  origen_del_precio_de_referencia text CONSTRAINT diferencia_origen_referencia_ck CHECK (origen_del_precio_de_referencia IN ('ORDEN', 'RECEPCION')),
  dentro_de_tolerancia boolean NOT NULL,
  tolerancia_de_cantidad numeric(7,4), tolerancia_de_precio numeric(7,4), tolerancia_de_importe numeric(18,2),
  estado text NOT NULL DEFAULT 'ABIERTA' CONSTRAINT diferencia_estado_ck CHECK (estado IN ('ABIERTA', 'RESUELTA', 'ANULADA')),
  resolucion text CONSTRAINT diferencia_resolucion_ck CHECK (resolucion IN ('ACEPTADA', 'DENTRO_DE_TOLERANCIA', 'NOTA_DE_CREDITO', 'NOTA_DE_DEBITO', 'DEVOLUCION', 'FACTURA_COMPLEMENTARIA', 'CORREGIDA_POR_EL_PROVEEDOR')),
  motivo text CONSTRAINT diferencia_motivo_ck CHECK (motivo IS NULL OR (btrim(motivo) <> '' AND length(motivo) <= 500)),
  resuelta_por uuid REFERENCES persona (id), resuelta_en timestamptz,
  registrado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  CONSTRAINT diferencia_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT diferencia_unica_uk UNIQUE NULLS NOT DISTINCT (empresa_id, conciliacion_id, tipo, linea_de_comprobante, recepcion_id, linea_de_recepcion),
  CONSTRAINT diferencia_conciliacion_fkey FOREIGN KEY (conciliacion_id, empresa_id) REFERENCES conciliacion (id, empresa_id),
  CONSTRAINT diferencia_comprobante_fkey FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante_de_proveedor (id, empresa_id),
  CONSTRAINT diferencia_linea_de_comprobante_fkey FOREIGN KEY (empresa_id, comprobante_id, linea_de_comprobante) REFERENCES linea_de_comprobante (empresa_id, comprobante_id, numero),
  CONSTRAINT diferencia_linea_de_recepcion_fkey FOREIGN KEY (empresa_id, recepcion_id, linea_de_recepcion) REFERENCES linea_de_recepcion (empresa_id, recepcion_id, numero),
  -- Abierta = sin resolución ni autor; resuelta = con resolución y momento; salvo «dentro de tolerancia» toda resolución lleva motivo escrito.
  CONSTRAINT diferencia_resolucion_estado_ck CHECK ((estado <> 'ABIERTA' OR (resolucion IS NULL AND resuelta_por IS NULL AND resuelta_en IS NULL))
    AND (estado <> 'RESUELTA' OR (resolucion IS NOT NULL AND resuelta_en IS NOT NULL))
    AND (resolucion IS NULL OR resolucion = 'DENTRO_DE_TOLERANCIA' OR motivo IS NOT NULL)),
  CONSTRAINT diferencia_tolerancia_ck CHECK (resolucion IS DISTINCT FROM 'DENTRO_DE_TOLERANCIA' OR dentro_de_tolerancia),
  CONSTRAINT diferencia_precio_ck CHECK (num_nonnulls(precio_facturado, precio_de_referencia, origen_del_precio_de_referencia) IN (0, 3) AND (tipo = 'PRECIO_DISTINTO' OR precio_facturado IS NULL)));
CREATE INDEX diferencia_abierta_ix ON diferencia_de_compra (empresa_id, tipo, registrado_en) WHERE estado = 'ABIERTA';
CREATE INDEX diferencia_conciliacion_ix ON diferencia_de_compra (empresa_id, conciliacion_id);


-- Solo cambian la resolución y su constancia; la base fija el momento. Transiciones: ABIERTA → RESUELTA | ANULADA y RESUELTA → ANULADA (nada se reabre: al conciliar de nuevo se registra otra).
CREATE FUNCTION compras_diferencia_cambia() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_libres text[] := ARRAY['estado', 'resolucion', 'motivo', 'resuelta_por', 'resuelta_en', 'version', 'actualizado_en'];
BEGIN
  IF (to_jsonb(NEW) - v_libres) IS DISTINCT FROM (to_jsonb(OLD) - v_libres) THEN
    RAISE EXCEPTION 'de una diferencia solo cambian su estado y su resolución' USING ERRCODE = '23514', CONSTRAINT = 'diferencia_inmutable';
  END IF;
  IF NEW.estado = OLD.estado THEN
    IF NEW.resolucion IS DISTINCT FROM OLD.resolucion OR NEW.motivo IS DISTINCT FROM OLD.motivo OR NEW.resuelta_por IS DISTINCT FROM OLD.resuelta_por
       OR NEW.resuelta_en IS DISTINCT FROM OLD.resuelta_en THEN
      RAISE EXCEPTION 'la resolución solo se fija al resolver la diferencia' USING ERRCODE = '23514', CONSTRAINT = 'diferencia_inmutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.estado = 'ABIERTA' AND NEW.estado IN ('RESUELTA', 'ANULADA')) OR (OLD.estado = 'RESUELTA' AND NEW.estado = 'ANULADA')) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado USING ERRCODE = '23514', CONSTRAINT = 'diferencia_transicion_invalida';
  END IF;
  IF NEW.estado = 'RESUELTA' THEN
    NEW.resuelta_en := now();
  ELSE
    -- Al anularse con la conciliación, lo que ya estaba resuelto conserva su resolución y su autor (queda el rastro).
    NEW.resolucion := OLD.resolucion;
    NEW.motivo := OLD.motivo;
    NEW.resuelta_por := OLD.resuelta_por;
    NEW.resuelta_en := OLD.resuelta_en;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER diferencia_1_cambia BEFORE UPDATE ON diferencia_de_compra FOR EACH ROW EXECUTE FUNCTION compras_diferencia_cambia();
CREATE TRIGGER diferencia_2_version BEFORE UPDATE ON diferencia_de_compra FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- La diferencia (y la tolerancia aplicada) entran solo en la transacción de su conciliación, y de una de acto CONCILIACION.
CREATE FUNCTION compras_diferencia_en_su_conciliacion() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_ok boolean;
BEGIN
  SELECT c.registrado_en = now() AND c.acto = 'CONCILIACION' INTO v_ok FROM public.conciliacion c WHERE c.id = NEW.conciliacion_id AND c.empresa_id = NEW.empresa_id;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'la diferencia solo entra en la transacción de su conciliación' USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_conciliacion_confirmada';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER diferencia_en_su_conciliacion BEFORE INSERT ON diferencia_de_compra FOR EACH ROW EXECUTE FUNCTION compras_diferencia_en_su_conciliacion();
CREATE TRIGGER tolerancia_aplicada_en_su_conciliacion BEFORE INSERT ON tolerancia_aplicada_de_conciliacion FOR EACH ROW EXECUTE FUNCTION compras_diferencia_en_su_conciliacion();
CREATE TRIGGER diferencia_sin_borrado BEFORE DELETE ON diferencia_de_compra FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER diferencia_sin_truncate BEFORE TRUNCATE ON diferencia_de_compra FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- Las dos funciones de 0066 que topan lo recibido contra la orden respetan la tolerancia de recepción (% sobre lo pedido; NULL = ninguna: con la tolerancia vacía son idénticas a las de 0066).
CREATE OR REPLACE FUNCTION compras_vinculo_de_orden_valida() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_prov_orden uuid;
  v_prov_recepcion uuid;
  v_retirada boolean;
  v_producto_orden uuid;
  v_producto_recepcion uuid;
  v_cantidad numeric;
  v_nivel text;
  v_exige boolean;
BEGIN
  SELECT o.estado, o.proveedor_id INTO v_estado, v_prov_orden FROM public.orden_de_compra o WHERE o.id = NEW.orden_id AND o.empresa_id = NEW.empresa_id FOR SHARE;
  IF v_estado IS DISTINCT FROM 'PEDIDA' THEN
    RAISE EXCEPTION 'se recibe contra una orden pedida' USING ERRCODE = '23514', CONSTRAINT = 'orden_no_pedida';
  END IF;
  SELECT r.proveedor_id INTO v_prov_recepcion FROM public.recepcion r WHERE r.id = NEW.recepcion_id AND r.empresa_id = NEW.empresa_id;
  IF v_prov_recepcion IS DISTINCT FROM v_prov_orden THEN
    RAISE EXCEPTION 'el proveedor de la recepción no es el de la orden' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_de_orden_proveedor_distinto';
  END IF;
  SELECT l.retirada, l.producto_id INTO v_retirada, v_producto_orden FROM public.linea_de_orden l
   WHERE l.empresa_id = NEW.empresa_id AND l.orden_id = NEW.orden_id AND l.numero = NEW.linea_de_orden;
  IF v_retirada THEN
    RAISE EXCEPTION 'la línea de la orden se retiró' USING ERRCODE = '23514', CONSTRAINT = 'linea_de_orden_retirada';
  END IF;
  SELECT l.cantidad_en_stock, l.producto_id INTO v_cantidad, v_producto_recepcion FROM public.linea_de_recepcion l
   WHERE l.empresa_id = NEW.empresa_id AND l.recepcion_id = NEW.recepcion_id AND l.numero = NEW.linea;
  IF v_producto_recepcion IS DISTINCT FROM v_producto_orden THEN
    RAISE EXCEPTION 'el producto de la línea recibida no es el de la línea de la orden' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_de_orden_producto_distinto';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inspeccion_de_linea_de_recepcion i WHERE i.empresa_id = NEW.empresa_id AND i.recepcion_id = NEW.recepcion_id AND i.linea = NEW.linea
                  AND i.condicion = 'RECHAZADA') THEN
    v_nivel := coalesce((SELECT n.nivel FROM public.nivel_de_control n
                          WHERE n.empresa_id = NEW.empresa_id AND n.sucursal_id IS NULL AND n.control = 'compras.recepcion_excede_la_orden'), 'PERMITIR');
    v_exige := v_nivel = 'BLOQUEAR' OR (v_nivel = 'AVISAR' AND NOT NEW.confirmo_exceso);
    IF v_exige AND EXISTS (SELECT 1 FROM public.saldo_de_linea_de_orden s WHERE s.empresa_id = NEW.empresa_id AND s.orden_id = NEW.orden_id AND s.linea = NEW.linea_de_orden
                            AND s.cantidad_recibida + v_cantidad > s.cantidad_pedida * (1 + coalesce((SELECT t.tolerancia_de_recepcion FROM public.tolerancia_de_compras t WHERE t.empresa_id = NEW.empresa_id), 0) / 100)) THEN
      IF v_nivel = 'BLOQUEAR' THEN
        RAISE EXCEPTION 'la recepción supera lo pedido' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_bloqueada';
      END IF;
      RAISE EXCEPTION 'la recepción supera lo pedido y no se confirmó' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_sin_confirmar';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION compras_recepcion_confirmada_suma_a_la_orden() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_nivel text;
  v_exige boolean;
  v_estado text;
  v_nueva numeric;
  r record;
BEGIN
  v_nivel := coalesce((SELECT n.nivel FROM public.nivel_de_control n
                        WHERE n.empresa_id = NEW.empresa_id AND n.sucursal_id IS NULL AND n.control = 'compras.recepcion_excede_la_orden'), 'PERMITIR');
  FOR r IN
    SELECT v.orden_id, v.linea_de_orden, v.confirmo_exceso, l.cantidad_en_stock AS cantidad
      FROM public.linea_de_recepcion_de_orden v
      JOIN public.linea_de_recepcion l ON l.empresa_id = v.empresa_id AND l.recepcion_id = v.recepcion_id AND l.numero = v.linea
     WHERE v.empresa_id = NEW.empresa_id AND v.recepcion_id = NEW.id
       AND NOT EXISTS (SELECT 1 FROM public.inspeccion_de_linea_de_recepcion i WHERE i.empresa_id = v.empresa_id AND i.recepcion_id = v.recepcion_id AND i.linea = v.linea
                        AND i.condicion = 'RECHAZADA')
     ORDER BY v.orden_id, v.linea_de_orden
  LOOP
    SELECT o.estado INTO v_estado FROM public.orden_de_compra o WHERE o.id = r.orden_id AND o.empresa_id = NEW.empresa_id FOR SHARE;
    IF v_estado IS DISTINCT FROM 'PEDIDA' THEN
      RAISE EXCEPTION 'se recibe contra una orden pedida' USING ERRCODE = '23514', CONSTRAINT = 'orden_no_pedida';
    END IF;
    v_exige := v_nivel = 'BLOQUEAR' OR (v_nivel = 'AVISAR' AND NOT r.confirmo_exceso);
    UPDATE public.saldo_de_linea_de_orden s SET cantidad_recibida = s.cantidad_recibida + r.cantidad, actualizado_en = now()
     WHERE s.empresa_id = NEW.empresa_id AND s.orden_id = r.orden_id AND s.linea = r.linea_de_orden
       AND (NOT v_exige OR s.cantidad_recibida + r.cantidad <= s.cantidad_pedida * (1 + coalesce((SELECT t.tolerancia_de_recepcion FROM public.tolerancia_de_compras t WHERE t.empresa_id = NEW.empresa_id), 0) / 100))
    RETURNING s.cantidad_recibida INTO v_nueva;
    IF v_nueva IS NULL THEN
      IF v_nivel = 'BLOQUEAR' THEN
        RAISE EXCEPTION 'la recepción supera lo pedido' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_bloqueada';
      END IF;
      RAISE EXCEPTION 'la recepción supera lo pedido y no se confirmó' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_sin_confirmar';
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;

-- ================================================================================================
-- Privilegios y RLS
-- ================================================================================================
REVOKE ALL ON tolerancia_de_compras, tolerancia_aplicada_de_conciliacion, diferencia_de_compra FROM PUBLIC;
GRANT SELECT ON tolerancia_de_compras, tolerancia_aplicada_de_conciliacion, diferencia_de_compra TO pedernal_app;
GRANT INSERT (empresa_id, tolerancia_de_cantidad, tolerancia_de_precio, tolerancia_de_importe, tolerancia_de_recepcion) ON tolerancia_de_compras TO pedernal_app;
GRANT UPDATE (tolerancia_de_cantidad, tolerancia_de_precio, tolerancia_de_importe, tolerancia_de_recepcion) ON tolerancia_de_compras TO pedernal_app;
GRANT INSERT (empresa_id, conciliacion_id, tolerancia_de_cantidad, tolerancia_de_precio, tolerancia_de_importe) ON tolerancia_aplicada_de_conciliacion TO pedernal_app;
GRANT INSERT (id, empresa_id, conciliacion_id, tipo, comprobante_id, linea_de_comprobante, recepcion_id, linea_de_recepcion, cantidad_de_diferencia, importe_de_diferencia,
  precio_facturado, precio_de_referencia, origen_del_precio_de_referencia, dentro_de_tolerancia, tolerancia_de_cantidad, tolerancia_de_precio, tolerancia_de_importe,
  estado, resolucion, motivo, resuelta_por) ON diferencia_de_compra TO pedernal_app;
GRANT UPDATE (estado, resolucion, motivo, resuelta_por) ON diferencia_de_compra TO pedernal_app;

DO $$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['tolerancia_de_compras', 'tolerancia_aplicada_de_conciliacion', 'diferencia_de_compra'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()))', v_tabla || '_app_leer', v_tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO pedernal_app WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))', v_tabla || '_app_alta', v_tabla);
  END LOOP;
  FOREACH v_tabla IN ARRAY ARRAY['tolerancia_de_compras', 'diferencia_de_compra'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
      WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))', v_tabla || '_app_cambiar', v_tabla);
  END LOOP;
END
$$;
