-- 0084_compras_devoluciones (número provisorio): compras N4, DEVOLUCIÓN DE MERCADERÍA AL PROVEEDOR (E9 §3.8; compras.md Anexo C.5 y D-34). Decisiones del dueño: devolver mercadería NO es devolver dinero
-- (15/11/2026: la nota de crédito y el saldo a favor son otros hechos); el motivo de la devolución se ELIGE de la lista del sistema de motivos de rechazo (`MOTIVOS_DE_RECHAZO`, 16/11/2026), sin texto libre; cualquier detalle va en el remito de devolución; quién devuelve y anula:
-- gerente y administrador (SUPUESTO del ingeniero, DEC-0712, a confirmar; los permisos viven en el catálogo, no acá).
-- ADITIVA: una fila sembrada en `motivo_de_movimiento` (tabla global de solo inserción) y dos tablas nuevas; no toca datos ni columnas existentes.
-- Sin SECURITY DEFINER; toda función fija `search_path = pg_catalog, public, pg_temp`. Nadie recibe DELETE ni TRUNCATE. INSERT y UPDATE por columna. RLS activa y FORZADA, una política por comando. Toda clave foránea
-- entre tablas de empresa es COMPUESTA. Reversión: `migraciones/reversiones/0084_revertir_compras_devoluciones.sql` (FRENA si hay devoluciones; el motivo sembrado NO se borra: la tabla de motivos es de solo inserción).
-- DEPENDE de 0027 (`valor_de_lista`), 0030 (stock), 0037 (compras) y 0063 (recepción separada).
--
-- Diseño (probado por `test/integracion/compras-devoluciones-migracion.test.ts`):
--  V1. El motivo `DEVOLUCION_A_PROVEEDOR` (clase SALIDA) no entrega mercadería a un uso como una venta: sale de vuelta al proveedor. La salida de stock de cada devolución lleva origen (`DEVOLUCION_A_PROVEEDOR`, id de la devolución):
--      el único de origen de 0030 impone UNA salida por devolución.
--  V2. La devolución y sus líneas son de solo inserción salvo anularla (CONFIRMADA → ANULADA, con quién, cuándo y motivo; la base fija el momento). La línea entra en la transacción de su devolución.
--  V3. Con línea recibida de origen, lo devuelto VIGENTE (devoluciones CONFIRMADAS) no supera lo recibido de esa línea: el disparador bloquea la fila del saldo de la línea recibida y compara (dos devoluciones simultáneas de la
--      misma línea se serializan); una devolución anulada deja de contar. La recepción de origen debe estar CONFIRMADA, ser del mismo proveedor y la línea del mismo producto que el artículo devuelto.
--  V4. Una sola línea por (depósito, artículo) y devolución (lo impone el renglón de la salida de stock). El número es consecutivo por empresa (candado por empresa) y la fecha de negocio sigue la jornada de la sucursal.

DO $$
BEGIN
  IF to_regclass('public.valor_de_lista') IS NULL THEN
    RAISE EXCEPTION 'compras N4 (devoluciones) requiere 0027 aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.movimiento_de_stock') IS NULL OR to_regclass('public.recepcion') IS NULL THEN
    RAISE EXCEPTION 'compras N4 (devoluciones) requiere 0030 y 0037 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recepcion' AND column_name = 'confirmada_por') THEN
    RAISE EXCEPTION 'compras N4 (devoluciones) requiere 0063 aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.devolucion_a_proveedor') IS NOT NULL OR to_regclass('public.linea_de_devolucion') IS NOT NULL THEN
    RAISE EXCEPTION 'compras N4: las tablas de devoluciones ya existen; esta migración solo crea objetos nuevos' USING ERRCODE = '55000';
  END IF;
END
$$;

INSERT INTO motivo_de_movimiento (clase, codigo, entra_con_costo, entrega_mercaderia) VALUES ('SALIDA', 'DEVOLUCION_A_PROVEEDOR', false, false)
  ON CONFLICT (clase, codigo) DO NOTHING;   -- la reversión no borra el motivo (tabla de solo inserción): al reaplicar ya está

CREATE TABLE devolucion_a_proveedor (
  id                          uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id                  uuid NOT NULL REFERENCES empresa (id),
  numero                      integer NOT NULL CONSTRAINT devolucion_numero_ck CHECK (numero > 0),
  sucursal_id                 uuid NOT NULL,
  proveedor_id                uuid NOT NULL,
  motivo_id                   uuid NOT NULL,
  remito_de_devolucion_numero text CONSTRAINT devolucion_remito_ck CHECK (remito_de_devolucion_numero IS NULL OR texto_de_catalogo_valido(remito_de_devolucion_numero, 40)),
  remito_de_devolucion_fecha  date,
  clave_idempotencia          text NOT NULL CONSTRAINT devolucion_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella                      text NOT NULL CONSTRAINT devolucion_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  hecho_en                    timestamptz NOT NULL,
  registrado_en               timestamptz NOT NULL DEFAULT now(),
  fecha_negocio               date NOT NULL,
  estado                      text NOT NULL DEFAULT 'CONFIRMADA' CONSTRAINT devolucion_estado_ck CHECK (estado IN ('CONFIRMADA', 'ANULADA')),
  registrado_por              uuid NOT NULL REFERENCES persona (id),
  anulada_por                 uuid REFERENCES persona (id),
  anulada_en                  timestamptz,
  motivo_de_anulacion         text CONSTRAINT devolucion_motivo_de_anulacion_ck CHECK (motivo_de_anulacion IS NULL OR texto_de_catalogo_valido(motivo_de_anulacion, 500)),
  actualizado_en              timestamptz NOT NULL DEFAULT now(),
  version                     integer NOT NULL DEFAULT 1,
  CONSTRAINT devolucion_a_proveedor_pkey PRIMARY KEY (id),
  CONSTRAINT devolucion_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT devolucion_numero_uk UNIQUE (empresa_id, numero),
  CONSTRAINT devolucion_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT devolucion_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT devolucion_proveedor_fkey FOREIGN KEY (proveedor_id, empresa_id) REFERENCES parte (id, empresa_id),
  CONSTRAINT devolucion_motivo_fkey FOREIGN KEY (motivo_id) REFERENCES valor_de_lista (id),
  CONSTRAINT devolucion_remito_completo_ck CHECK ((remito_de_devolucion_numero IS NULL) = (remito_de_devolucion_fecha IS NULL)),
  CONSTRAINT devolucion_anulacion_ck CHECK ((estado = 'ANULADA') = (anulada_por IS NOT NULL AND anulada_en IS NOT NULL AND motivo_de_anulacion IS NOT NULL))
);
CREATE INDEX devolucion_fecha_ix ON devolucion_a_proveedor (empresa_id, sucursal_id, fecha_negocio DESC, id);

CREATE TABLE linea_de_devolucion (
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  devolucion_id      uuid NOT NULL,
  numero             integer NOT NULL CONSTRAINT linea_de_devolucion_numero_ck CHECK (numero >= 1),
  deposito_id        uuid NOT NULL,
  articulo_id        uuid NOT NULL,
  cantidad           numeric(18,4) NOT NULL CONSTRAINT linea_de_devolucion_cantidad_ck CHECK (cantidad > 0 AND cantidad < 100000000000000),
  recepcion_id       uuid,
  linea_de_recepcion integer,
  movimiento_id      uuid NOT NULL,
  renglon_numero     integer NOT NULL,
  CONSTRAINT linea_de_devolucion_pkey PRIMARY KEY (empresa_id, devolucion_id, numero),
  CONSTRAINT linea_de_devolucion_renglon_uk UNIQUE (empresa_id, movimiento_id, renglon_numero),
  CONSTRAINT linea_de_devolucion_devolucion_fkey FOREIGN KEY (devolucion_id, empresa_id) REFERENCES devolucion_a_proveedor (id, empresa_id),
  CONSTRAINT linea_de_devolucion_deposito_fkey FOREIGN KEY (deposito_id, empresa_id) REFERENCES deposito (id, empresa_id),
  CONSTRAINT linea_de_devolucion_articulo_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulo_de_stock (id, empresa_id),
  CONSTRAINT linea_de_devolucion_origen_fkey FOREIGN KEY (empresa_id, recepcion_id, linea_de_recepcion) REFERENCES linea_de_recepcion (empresa_id, recepcion_id, numero),
  CONSTRAINT linea_de_devolucion_renglon_fkey FOREIGN KEY (empresa_id, movimiento_id, renglon_numero) REFERENCES renglon_de_movimiento (empresa_id, movimiento_id, numero),
  CONSTRAINT linea_de_devolucion_origen_ck CHECK ((recepcion_id IS NULL) = (linea_de_recepcion IS NULL))
);
CREATE INDEX linea_de_devolucion_origen_ix ON linea_de_devolucion (empresa_id, recepcion_id, linea_de_recepcion) WHERE recepcion_id IS NOT NULL;

-- Alta: número consecutivo (candado por empresa), sello y jornada de la sucursal (igual que la recepción).
CREATE FUNCTION compras_devolucion_prepara() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_zona text;
  v_corte time;
BEGIN
  NEW.registrado_en := now();
  SELECT e.zona_horaria, s.hora_de_corte INTO v_zona, v_corte
    FROM public.sucursal s JOIN public.empresa e ON e.id = s.empresa_id
   WHERE s.id = NEW.sucursal_id AND s.empresa_id = NEW.empresa_id;
  IF v_zona IS NULL THEN
    RAISE EXCEPTION 'la sucursal de la devolución no existe' USING ERRCODE = '23503', CONSTRAINT = 'devolucion_sucursal_fkey';
  END IF;
  NEW.fecha_negocio := public.fecha_de_negocio(NEW.hecho_en, v_zona, v_corte);
  -- El motivo es de la lista del sistema de motivos de rechazo y está activo al devolver (como la marca de tarjeta del cobro, 0027): si después la plataforma lo desactiva, lo ya devuelto lo conserva.
  IF NOT EXISTS (SELECT 1 FROM public.valor_de_lista v WHERE v.id = NEW.motivo_id AND v.lista = 'MOTIVOS_DE_RECHAZO' AND v.activo) THEN
    RAISE EXCEPTION 'el motivo de la devolución no es un motivo de rechazo activo' USING ERRCODE = '23514', CONSTRAINT = 'devolucion_motivo_invalido';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('devolucion_a_proveedor:' || NEW.empresa_id::text, 0));
  SELECT coalesce(max(d.numero), 0) + 1 INTO NEW.numero FROM public.devolucion_a_proveedor d WHERE d.empresa_id = NEW.empresa_id;
  RETURN NEW;
END
$$;
CREATE TRIGGER devolucion_prepara BEFORE INSERT ON devolucion_a_proveedor FOR EACH ROW EXECUTE FUNCTION compras_devolucion_prepara();

-- Cambio: solo CONFIRMADA → ANULADA (quién y motivo los manda la aplicación; el momento lo fija la base); lo demás es inmutable.
CREATE FUNCTION compras_devolucion_cambia() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_libres text[] := ARRAY['estado', 'anulada_por', 'anulada_en', 'motivo_de_anulacion', 'version', 'actualizado_en'];
BEGIN
  IF (to_jsonb(NEW) - v_libres) IS DISTINCT FROM (to_jsonb(OLD) - v_libres) THEN
    RAISE EXCEPTION 'de una devolución solo cambia su estado y su anulación' USING ERRCODE = '23514', CONSTRAINT = 'devolucion_inmutable';
  END IF;
  IF NEW.estado = OLD.estado THEN
    IF NEW.anulada_por IS DISTINCT FROM OLD.anulada_por OR NEW.anulada_en IS DISTINCT FROM OLD.anulada_en OR NEW.motivo_de_anulacion IS DISTINCT FROM OLD.motivo_de_anulacion THEN
      RAISE EXCEPTION 'la anulación solo se fija al anular la devolución' USING ERRCODE = '23514', CONSTRAINT = 'devolucion_inmutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (OLD.estado = 'CONFIRMADA' AND NEW.estado = 'ANULADA') THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado USING ERRCODE = '23514', CONSTRAINT = 'devolucion_transicion_invalida';
  END IF;
  NEW.anulada_en := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER devolucion_1_cambia BEFORE UPDATE ON devolucion_a_proveedor FOR EACH ROW EXECUTE FUNCTION compras_devolucion_cambia();
CREATE TRIGGER devolucion_2_version BEFORE UPDATE ON devolucion_a_proveedor FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- La línea: con su devolución (misma transacción) y, con línea recibida de origen, sin pasarse de lo recibido (V3).
CREATE FUNCTION compras_linea_de_devolucion_valida() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_proveedor uuid;
  v_estado_recepcion text;
  v_proveedor_recepcion uuid;
  v_producto_linea uuid;
  v_producto_articulo uuid;
  v_recibida numeric;
  v_devuelta numeric;
BEGIN
  IF NEW.recepcion_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT d.proveedor_id INTO v_proveedor FROM public.devolucion_a_proveedor d WHERE d.id = NEW.devolucion_id AND d.empresa_id = NEW.empresa_id;
  SELECT r.estado, r.proveedor_id INTO v_estado_recepcion, v_proveedor_recepcion FROM public.recepcion r WHERE r.id = NEW.recepcion_id AND r.empresa_id = NEW.empresa_id;
  IF v_estado_recepcion IS DISTINCT FROM 'CONFIRMADA' THEN
    RAISE EXCEPTION 'solo se devuelve de una recepción confirmada' USING ERRCODE = '23514', CONSTRAINT = 'devolucion_recepcion_no_confirmada';
  END IF;
  IF v_proveedor_recepcion IS DISTINCT FROM v_proveedor THEN
    RAISE EXCEPTION 'la recepción de origen no es del proveedor de la devolución' USING ERRCODE = '23514', CONSTRAINT = 'devolucion_de_otro_proveedor';
  END IF;
  SELECT l.producto_id INTO v_producto_linea FROM public.linea_de_recepcion l WHERE l.empresa_id = NEW.empresa_id AND l.recepcion_id = NEW.recepcion_id AND l.numero = NEW.linea_de_recepcion;
  SELECT a.producto_id INTO v_producto_articulo FROM public.articulo_de_stock a WHERE a.id = NEW.articulo_id AND a.empresa_id = NEW.empresa_id;
  IF v_producto_linea IS DISTINCT FROM v_producto_articulo THEN
    RAISE EXCEPTION 'el artículo devuelto no es el de la línea recibida' USING ERRCODE = '23514', CONSTRAINT = 'devolucion_de_otro_producto';
  END IF;
  -- Se bloquea el saldo de la línea recibida: dos devoluciones de la misma línea a la vez se serializan.
  SELECT s.cantidad_recibida INTO v_recibida FROM public.saldo_de_linea_de_recepcion s
   WHERE s.empresa_id = NEW.empresa_id AND s.recepcion_id = NEW.recepcion_id AND s.numero = NEW.linea_de_recepcion FOR UPDATE;
  SELECT coalesce(sum(l.cantidad), 0) INTO v_devuelta
    FROM public.linea_de_devolucion l JOIN public.devolucion_a_proveedor d ON d.id = l.devolucion_id AND d.empresa_id = l.empresa_id
   WHERE l.empresa_id = NEW.empresa_id AND l.recepcion_id = NEW.recepcion_id AND l.linea_de_recepcion = NEW.linea_de_recepcion AND d.estado = 'CONFIRMADA';
  IF v_devuelta + NEW.cantidad > v_recibida THEN
    RAISE EXCEPTION 'lo devuelto supera lo recibido (% de %)', v_devuelta + NEW.cantidad, v_recibida USING ERRCODE = '23514', CONSTRAINT = 'devolucion_excede_lo_recibido';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER linea_de_devolucion_valida BEFORE INSERT ON linea_de_devolucion FOR EACH ROW EXECUTE FUNCTION compras_linea_de_devolucion_valida();
CREATE TRIGGER linea_de_devolucion_en_la_transaccion BEFORE INSERT ON linea_de_devolucion FOR EACH ROW
  EXECUTE FUNCTION compras_hija_en_la_transaccion_de_su_cabecera('devolucion_a_proveedor', 'devolucion_id');

CREATE TRIGGER devolucion_sin_borrado BEFORE DELETE ON devolucion_a_proveedor FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER devolucion_sin_truncate BEFORE TRUNCATE ON devolucion_a_proveedor FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER linea_de_devolucion_solo_insercion BEFORE UPDATE OR DELETE ON linea_de_devolucion FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER linea_de_devolucion_sin_truncate BEFORE TRUNCATE ON linea_de_devolucion FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- Privilegios y RLS
REVOKE ALL ON devolucion_a_proveedor, linea_de_devolucion FROM PUBLIC;
GRANT SELECT ON devolucion_a_proveedor, linea_de_devolucion TO pedernal_app;
GRANT INSERT (id, empresa_id, sucursal_id, proveedor_id, motivo_id, remito_de_devolucion_numero, remito_de_devolucion_fecha, clave_idempotencia, huella, hecho_en, registrado_por) ON devolucion_a_proveedor TO pedernal_app;
GRANT UPDATE (estado, anulada_por, motivo_de_anulacion) ON devolucion_a_proveedor TO pedernal_app;
GRANT INSERT (empresa_id, devolucion_id, numero, deposito_id, articulo_id, cantidad, recepcion_id, linea_de_recepcion, movimiento_id, renglon_numero) ON linea_de_devolucion TO pedernal_app;

DO $$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['devolucion_a_proveedor', 'linea_de_devolucion'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()))', v_tabla || '_app_leer', v_tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO pedernal_app WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))', v_tabla || '_app_alta', v_tabla);
  END LOOP;
  EXECUTE 'CREATE POLICY devolucion_a_proveedor_app_cambiar ON devolucion_a_proveedor FOR UPDATE TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
    WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))';
END
$$;
