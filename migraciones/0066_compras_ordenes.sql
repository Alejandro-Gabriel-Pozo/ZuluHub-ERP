-- 0066_compras_ordenes: compras N4 `TRES_VIAS`, primera mitad (E9 §3.8, compras.md Anexo C.4): la ORDEN DE COMPRA al proveedor, sus líneas, el saldo de lo recibido contra cada línea y
-- el vínculo «esta línea recibida es contra esta línea de la orden». Estados: BORRADOR → PEDIDA → CERRADA | ANULADA (D127; «Pedida» es el texto ya aprobado).
-- Decisiones del dueño (16/11/2026): crear, pedir, cerrar y anular una orden es de gerente o administrador (los permisos viven en el catálogo, no acá); sin segunda aprobación;
-- sin tolerancias por defecto (la tabla de tolerancias llega con 0067: acá un exceso sobre lo pedido no tiene margen).
--
-- Reglas de esta migración (las mismas de 0001 a 0065):
--  * ADITIVA: cuatro tablas, tres funciones de orden, una de vínculo y una de anulación de recepción; no toca datos ni columnas existentes. Una recepción que no es contra una orden
--    sigue exactamente igual.
--  * Sin funciones SECURITY DEFINER; toda función fija `search_path = pg_catalog, public, pg_temp`. Nadie recibe DELETE ni TRUNCATE (la orden y sus líneas no se borran: se anulan o,
--    en un borrador, se retira la línea). INSERT y UPDATE por columna. RLS activa y FORZADA, una política por comando. Toda clave foránea entre tablas de empresa es COMPUESTA.
--  * Reversión: `migraciones/reversiones/0066_revertir_compras_ordenes.sql` (FRENA si hay órdenes, líneas, saldos o vínculos).
--  * DEPENDE de 0037 (compras), 0063 (recepción separada) y 0007 (`nivel_de_control`); se comprueba al empezar.
--
-- Diseño (probado por `test/integracion/compras-ordenes-migracion.test.ts`):
--  O1. Las cantidades de la orden van en la UNIDAD BASE del producto (como la factura de N3): no hay conversión entre unidad pedida y unidad recibida.
--      (El borrador de la especificación usaba `compras_convertir_cantidad` y `compras_transicion_de_estado`, que NO existen en el código real: las transiciones las impone
--      `compras_orden_cambia`, y el saldo se suma en la unidad base de la línea recibida, `cantidad_en_stock`.)
--  O2. Transiciones: BORRADOR → PEDIDA | ANULADA; PEDIDA → CERRADA | ANULADA. Nada más (CERRADA y ANULADA son finales). En BORRADOR se edita la cabecera y las líneas; desde PEDIDA la
--      orden y sus líneas son inmutables. Pedir asigna el número (max+1 de la empresa bajo un candado por empresa: dos pedidos a la vez no repiten número) y el momento; cerrar fija
--      el motivo calculado por la base (COMPLETA si todas las líneas llegaron a lo pedido, CON_SALDO si no); anular exige motivo y falla si la orden tiene recepciones vigentes.
--  O3. El saldo de cada línea nace al pedir y SOLO lo mueve un disparador anidado. Recibir contra la orden suma lo recibido con UN UPDATE condicionado (el tope viaja en el WHERE):
--      con el control `compras.recepcion_excede_la_orden` en BLOQUEAR —o en AVISAR sin `confirmo_exceso`— lo recibido no supera lo pedido; sin fila en `nivel_de_control` = PERMITIR.
--      Anular la recepción devuelve lo recibido a la orden. Se recibe solo contra una orden PEDIDA, del mismo proveedor, del mismo producto y cuya línea no se retiró.

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.recepcion') IS NULL OR to_regclass('public.linea_de_recepcion') IS NULL THEN
    RAISE EXCEPTION 'compras N4 requiere 0037_compras aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recepcion' AND column_name = 'confirmada_por') THEN
    RAISE EXCEPTION 'compras N4 requiere 0063_compras_recepcion_separada aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.nivel_de_control') IS NULL THEN
    RAISE EXCEPTION 'compras N4 requiere nivel_de_control (0007) aplicada antes' USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['orden_de_compra', 'linea_de_orden', 'saldo_de_linea_de_orden', 'linea_de_recepcion_de_orden'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'compras N4: la tabla % ya existe; esta migración solo crea objetos nuevos', v_tabla USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- ================================================================================================
-- Tablas
-- ================================================================================================
CREATE TABLE orden_de_compra (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  numero              integer CONSTRAINT orden_numero_ck CHECK (numero > 0),                         -- se asigna al pedir
  proveedor_id        uuid NOT NULL,
  sucursal_destino_id uuid,
  fecha_de_entrega_prevista date,                                                                     -- fecha civil
  estado              text NOT NULL DEFAULT 'BORRADOR' CONSTRAINT orden_estado_ck CHECK (estado IN ('BORRADOR', 'PEDIDA', 'CERRADA', 'ANULADA')),
  cierre_motivo       text CONSTRAINT orden_cierre_motivo_ck CHECK (cierre_motivo IN ('COMPLETA', 'CON_SALDO')),
  clave_idempotencia  text NOT NULL CONSTRAINT orden_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella              text NOT NULL CONSTRAINT orden_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  creado_por          uuid NOT NULL REFERENCES persona (id),
  creado_en           timestamptz NOT NULL DEFAULT now(),
  pedida_por          uuid REFERENCES persona (id),
  pedida_en           timestamptz,
  fecha_negocio       date,                                                                           -- jornada civil de la empresa al pedir
  cerrada_por         uuid REFERENCES persona (id),
  cerrada_en          timestamptz,
  anulada_por         uuid REFERENCES persona (id),
  anulada_en          timestamptz,
  motivo_de_anulacion text CONSTRAINT orden_motivo_ck CHECK (motivo_de_anulacion IS NULL OR texto_de_catalogo_valido(motivo_de_anulacion, 500)),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT orden_de_compra_pkey PRIMARY KEY (id),
  CONSTRAINT orden_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT orden_numero_uk UNIQUE (empresa_id, numero),
  CONSTRAINT orden_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT orden_proveedor_fkey FOREIGN KEY (proveedor_id, empresa_id) REFERENCES parte (id, empresa_id),
  CONSTRAINT orden_sucursal_fkey FOREIGN KEY (sucursal_destino_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  -- Número y momento de pedido van juntos; un borrador no los tiene; pedida y cerrada sí.
  CONSTRAINT orden_pedido_ck CHECK ((numero IS NULL) = (pedida_en IS NULL) AND (numero IS NULL) = (pedida_por IS NULL) AND (numero IS NULL) = (fecha_negocio IS NULL)
    AND (estado NOT IN ('PEDIDA', 'CERRADA') OR numero IS NOT NULL) AND (estado <> 'BORRADOR' OR numero IS NULL)),
  CONSTRAINT orden_cierre_ck CHECK ((estado = 'CERRADA') = (cierre_motivo IS NOT NULL AND cerrada_por IS NOT NULL AND cerrada_en IS NOT NULL)),
  CONSTRAINT orden_anulacion_ck CHECK ((estado = 'ANULADA') = (anulada_por IS NOT NULL AND anulada_en IS NOT NULL AND motivo_de_anulacion IS NOT NULL))
);
CREATE INDEX orden_proveedor_ix ON orden_de_compra (empresa_id, proveedor_id, estado, id);
CREATE INDEX orden_pendiente_ix ON orden_de_compra (empresa_id, proveedor_id, fecha_de_entrega_prevista) WHERE estado = 'PEDIDA';

CREATE TABLE linea_de_orden (
  empresa_id      uuid NOT NULL REFERENCES empresa (id),
  orden_id        uuid NOT NULL,
  numero          integer NOT NULL CONSTRAINT linea_de_orden_numero_ck CHECK (numero >= 1),
  producto_id     uuid NOT NULL,
  cantidad_pedida numeric(18,4) NOT NULL CONSTRAINT linea_de_orden_cantidad_ck CHECK (cantidad_pedida > 0 AND cantidad_pedida < 100000000000000),   -- unidad base del producto
  precio_unitario numeric(18,6) CONSTRAINT linea_de_orden_precio_ck CHECK (precio_unitario >= 0 AND precio_unitario < 10000000000000),               -- por unidad base; NULL = sin precio
  retirada        boolean NOT NULL DEFAULT false,                                                                                                     -- en un borrador se retira sin borrar
  CONSTRAINT linea_de_orden_pkey PRIMARY KEY (empresa_id, orden_id, numero),
  CONSTRAINT linea_de_orden_orden_fkey FOREIGN KEY (orden_id, empresa_id) REFERENCES orden_de_compra (id, empresa_id),
  CONSTRAINT linea_de_orden_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id)
);

-- Lo recibido contra cada línea pedida (unidad base). Nace al pedir; solo lo mueven disparadores.
CREATE TABLE saldo_de_linea_de_orden (
  empresa_id        uuid NOT NULL REFERENCES empresa (id),
  orden_id          uuid NOT NULL,
  linea             integer NOT NULL,
  cantidad_pedida   numeric(18,4) NOT NULL CONSTRAINT saldo_de_orden_pedida_ck CHECK (cantidad_pedida > 0),
  cantidad_recibida numeric(18,4) NOT NULL DEFAULT 0 CONSTRAINT saldo_de_orden_recibida_ck CHECK (cantidad_recibida >= 0),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saldo_de_linea_de_orden_pkey PRIMARY KEY (empresa_id, orden_id, linea),
  CONSTRAINT saldo_de_orden_linea_fkey FOREIGN KEY (empresa_id, orden_id, linea) REFERENCES linea_de_orden (empresa_id, orden_id, numero)
);

-- «Esta línea de recepción es contra esta línea de la orden». `confirmo_exceso`: la confirmación explícita cuando el control está en AVISAR.
CREATE TABLE linea_de_recepcion_de_orden (
  empresa_id      uuid NOT NULL REFERENCES empresa (id),
  recepcion_id    uuid NOT NULL,
  linea           integer NOT NULL,
  orden_id        uuid NOT NULL,
  linea_de_orden  integer NOT NULL,
  confirmo_exceso boolean NOT NULL DEFAULT false,
  CONSTRAINT linea_de_recepcion_de_orden_pkey PRIMARY KEY (empresa_id, recepcion_id, linea),
  CONSTRAINT vinculo_de_orden_linea_fkey FOREIGN KEY (empresa_id, recepcion_id, linea) REFERENCES linea_de_recepcion (empresa_id, recepcion_id, numero),
  CONSTRAINT vinculo_de_orden_orden_fkey FOREIGN KEY (empresa_id, orden_id, linea_de_orden) REFERENCES linea_de_orden (empresa_id, orden_id, numero)
);
CREATE INDEX vinculo_de_orden_ix ON linea_de_recepcion_de_orden (empresa_id, orden_id, linea_de_orden);

-- ================================================================================================
-- Disparadores
-- ================================================================================================

-- Alta: la orden nace BORRADOR y la crea quien la pide (el estado no entra por el alta: el GRANT no lo incluye y el CHECK lo ata al resto).
-- Cambio: en BORRADOR se editan proveedor, sucursal y entrega; desde PEDIDA solo cambia de estado. Transiciones impuestas.
CREATE FUNCTION compras_orden_cambia() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_libres text[] := ARRAY['estado', 'cierre_motivo', 'pedida_por', 'pedida_en', 'numero', 'fecha_negocio', 'cerrada_por', 'cerrada_en', 'anulada_por', 'anulada_en',
                           'motivo_de_anulacion', 'version', 'actualizado_en'];
  v_zona text;
  v_incompletas bigint;
BEGIN
  IF OLD.estado = 'BORRADOR' THEN
    v_libres := v_libres || ARRAY['proveedor_id', 'sucursal_destino_id', 'fecha_de_entrega_prevista'];
  END IF;
  IF (to_jsonb(NEW) - v_libres) IS DISTINCT FROM (to_jsonb(OLD) - v_libres) THEN
    RAISE EXCEPTION 'una orden pedida solo cambia de estado: el resto es inmutable' USING ERRCODE = '23514', CONSTRAINT = 'orden_inmutable';
  END IF;
  IF NEW.estado = OLD.estado THEN
    IF (NEW.numero IS DISTINCT FROM OLD.numero OR NEW.pedida_en IS DISTINCT FROM OLD.pedida_en OR NEW.cierre_motivo IS DISTINCT FROM OLD.cierre_motivo
        OR NEW.cerrada_en IS DISTINCT FROM OLD.cerrada_en OR NEW.anulada_en IS DISTINCT FROM OLD.anulada_en OR NEW.fecha_negocio IS DISTINCT FROM OLD.fecha_negocio) THEN
      RAISE EXCEPTION 'el número, la fecha y el motivo de cierre solo se fijan al cambiar de estado' USING ERRCODE = '23514', CONSTRAINT = 'orden_inmutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.estado = 'BORRADOR' AND NEW.estado IN ('PEDIDA', 'ANULADA')) OR (OLD.estado = 'PEDIDA' AND NEW.estado IN ('CERRADA', 'ANULADA'))) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado USING ERRCODE = '23514', CONSTRAINT = 'orden_transicion_invalida';
  END IF;
  -- Lo que la base fija al cambiar de estado no lo manda la aplicación.
  NEW.numero := OLD.numero;
  NEW.pedida_en := OLD.pedida_en;
  NEW.fecha_negocio := OLD.fecha_negocio;
  NEW.cierre_motivo := NULL;
  NEW.cerrada_en := NULL;
  NEW.anulada_en := NULL;
  IF NEW.estado = 'PEDIDA' THEN
    SELECT e.zona_horaria INTO v_zona FROM public.empresa e WHERE e.id = NEW.empresa_id;
    NEW.pedida_en := now();
    NEW.fecha_negocio := (NEW.pedida_en AT TIME ZONE v_zona)::date;
    IF NEW.fecha_de_entrega_prevista IS NOT NULL AND NEW.fecha_de_entrega_prevista < NEW.fecha_negocio THEN
      RAISE EXCEPTION 'la entrega prevista es anterior al día del pedido' USING ERRCODE = '23514', CONSTRAINT = 'orden_entrega_anterior_al_pedido';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.linea_de_orden l WHERE l.orden_id = NEW.id AND l.empresa_id = NEW.empresa_id AND NOT l.retirada) THEN
      RAISE EXCEPTION 'una orden sin líneas no se pide' USING ERRCODE = '23514', CONSTRAINT = 'orden_sin_lineas';
    END IF;
    -- Un candado por empresa serializa la numeración: dos pedidos a la vez no toman el mismo número.
    PERFORM pg_advisory_xact_lock(hashtextextended('orden_de_compra:' || NEW.empresa_id::text, 0));
    SELECT coalesce(max(o.numero), 0) + 1 INTO NEW.numero FROM public.orden_de_compra o WHERE o.empresa_id = NEW.empresa_id;
  ELSIF NEW.estado = 'CERRADA' THEN
    NEW.cerrada_en := now();
    SELECT count(*) INTO v_incompletas FROM public.saldo_de_linea_de_orden s
     WHERE s.orden_id = NEW.id AND s.empresa_id = NEW.empresa_id AND s.cantidad_recibida < s.cantidad_pedida;
    NEW.cierre_motivo := CASE WHEN v_incompletas = 0 THEN 'COMPLETA' ELSE 'CON_SALDO' END;
  ELSE
    NEW.anulada_en := now();
    IF EXISTS (SELECT 1 FROM public.linea_de_recepcion_de_orden v JOIN public.recepcion r ON r.id = v.recepcion_id AND r.empresa_id = v.empresa_id
                WHERE v.orden_id = NEW.id AND v.empresa_id = NEW.empresa_id AND r.estado IN ('PENDIENTE', 'CONFIRMADA')) THEN
      RAISE EXCEPTION 'la orden tiene recepciones vigentes' USING ERRCODE = '23514', CONSTRAINT = 'orden_con_recepciones';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER orden_1_cambio BEFORE UPDATE ON orden_de_compra FOR EACH ROW EXECUTE FUNCTION compras_orden_cambia();
CREATE TRIGGER orden_2_version BEFORE UPDATE ON orden_de_compra FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- Al pedir nace el saldo de cada línea que no se retiró.
CREATE FUNCTION compras_orden_abre_saldos() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  INSERT INTO public.saldo_de_linea_de_orden (empresa_id, orden_id, linea, cantidad_pedida)
  SELECT l.empresa_id, l.orden_id, l.numero, l.cantidad_pedida FROM public.linea_de_orden l
   WHERE l.orden_id = NEW.id AND l.empresa_id = NEW.empresa_id AND NOT l.retirada;
  RETURN NULL;
END
$$;
CREATE TRIGGER orden_abre_saldos AFTER UPDATE OF estado ON orden_de_compra FOR EACH ROW WHEN (OLD.estado = 'BORRADOR' AND NEW.estado = 'PEDIDA')
  EXECUTE FUNCTION compras_orden_abre_saldos();

-- Las líneas entran y se editan solo mientras la orden es BORRADOR; de una línea solo cambian la cantidad, el precio y si se retiró.
CREATE FUNCTION compras_linea_de_orden_valida() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
BEGIN
  SELECT o.estado INTO v_estado FROM public.orden_de_compra o WHERE o.id = NEW.orden_id AND o.empresa_id = NEW.empresa_id FOR SHARE;
  IF v_estado IS DISTINCT FROM 'BORRADOR' THEN
    RAISE EXCEPTION 'las líneas de una orden pedida no se tocan' USING ERRCODE = '23514', CONSTRAINT = 'linea_de_orden_orden_pedida';
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['cantidad_pedida', 'precio_unitario', 'retirada']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['cantidad_pedida', 'precio_unitario', 'retirada']) THEN
    RAISE EXCEPTION 'de una línea solo cambian la cantidad, el precio y si se retiró' USING ERRCODE = '23514', CONSTRAINT = 'linea_de_orden_inmutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER linea_de_orden_valida BEFORE INSERT OR UPDATE ON linea_de_orden FOR EACH ROW EXECUTE FUNCTION compras_linea_de_orden_valida();

-- El saldo lo escribe solo un disparador anidado (el de abrir saldos, el del vínculo o el de la anulación de la recepción).
CREATE FUNCTION compras_saldo_de_orden_solo_por_disparadores() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'el saldo de una línea de la orden lo escriben solo los disparadores' USING ERRCODE = '42501', CONSTRAINT = 'saldo_de_orden_solo_por_disparadores';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER saldo_de_orden_solo_por_disparadores BEFORE INSERT OR UPDATE ON saldo_de_linea_de_orden FOR EACH ROW EXECUTE FUNCTION compras_saldo_de_orden_solo_por_disparadores();

-- Recibir contra una orden: PEDIDA (se bloquea contra una anulación o un cierre simultáneos), mismo proveedor, mismo producto y línea no retirada. Lo recibido se suma con UN UPDATE
-- condicionado: la condición del tope viaja en el WHERE (como el saldo de stock). Sin margen: la tolerancia de recepción llega con 0067.
CREATE FUNCTION compras_vinculo_de_orden_aplica() RETURNS trigger LANGUAGE plpgsql
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
  v_nueva numeric;
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
  v_nivel := coalesce((SELECT n.nivel FROM public.nivel_de_control n
                        WHERE n.empresa_id = NEW.empresa_id AND n.sucursal_id IS NULL AND n.control = 'compras.recepcion_excede_la_orden'), 'PERMITIR');
  v_exige := v_nivel = 'BLOQUEAR' OR (v_nivel = 'AVISAR' AND NOT NEW.confirmo_exceso);
  UPDATE public.saldo_de_linea_de_orden s SET cantidad_recibida = s.cantidad_recibida + v_cantidad, actualizado_en = now()
   WHERE s.empresa_id = NEW.empresa_id AND s.orden_id = NEW.orden_id AND s.linea = NEW.linea_de_orden
     AND (NOT v_exige OR s.cantidad_recibida + v_cantidad <= s.cantidad_pedida)
  RETURNING s.cantidad_recibida INTO v_nueva;
  IF v_nueva IS NULL THEN
    IF v_nivel = 'BLOQUEAR' THEN
      RAISE EXCEPTION 'la recepción supera lo pedido' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_bloqueada';
    END IF;
    RAISE EXCEPTION 'la recepción supera lo pedido y no se confirmó' USING ERRCODE = '23514', CONSTRAINT = 'recepcion_excede_la_orden_sin_confirmar';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER vinculo_de_orden_aplica BEFORE INSERT ON linea_de_recepcion_de_orden FOR EACH ROW EXECUTE FUNCTION compras_vinculo_de_orden_aplica();

-- El vínculo solo entra en la transacción de la recepción (la línea de recepción es de solo inserción y nace con su cabecera).
CREATE TRIGGER vinculo_de_orden_en_la_transaccion BEFORE INSERT ON linea_de_recepcion_de_orden FOR EACH ROW
  EXECUTE FUNCTION compras_hija_en_la_transaccion_de_su_cabecera('recepcion', 'recepcion_id');

-- Anular una recepción devuelve lo recibido a la orden (una sola vez: PENDIENTE|CONFIRMADA → ANULADA ocurre una vez).
CREATE FUNCTION compras_recepcion_anulada_devuelve_a_la_orden() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  UPDATE public.saldo_de_linea_de_orden s SET cantidad_recibida = s.cantidad_recibida - l.cantidad_en_stock, actualizado_en = now()
    FROM public.linea_de_recepcion_de_orden v
    JOIN public.linea_de_recepcion l ON l.empresa_id = v.empresa_id AND l.recepcion_id = v.recepcion_id AND l.numero = v.linea
   WHERE v.empresa_id = NEW.empresa_id AND v.recepcion_id = NEW.id
     AND s.empresa_id = v.empresa_id AND s.orden_id = v.orden_id AND s.linea = v.linea_de_orden;
  RETURN NULL;
END
$$;
CREATE TRIGGER recepcion_devuelve_a_la_orden AFTER UPDATE OF estado ON recepcion FOR EACH ROW WHEN (OLD.estado <> 'ANULADA' AND NEW.estado = 'ANULADA')
  EXECUTE FUNCTION compras_recepcion_anulada_devuelve_a_la_orden();

-- Sin borrado ni truncado.
CREATE TRIGGER orden_sin_borrado BEFORE DELETE ON orden_de_compra FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER orden_sin_truncate BEFORE TRUNCATE ON orden_de_compra FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER linea_de_orden_sin_borrado BEFORE DELETE ON linea_de_orden FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER linea_de_orden_sin_truncate BEFORE TRUNCATE ON linea_de_orden FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER saldo_de_orden_sin_borrado BEFORE DELETE ON saldo_de_linea_de_orden FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER saldo_de_orden_sin_truncate BEFORE TRUNCATE ON saldo_de_linea_de_orden FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER vinculo_de_orden_solo_insercion BEFORE UPDATE OR DELETE ON linea_de_recepcion_de_orden FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER vinculo_de_orden_sin_truncate BEFORE TRUNCATE ON linea_de_recepcion_de_orden FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ================================================================================================
-- Privilegios y RLS
-- ================================================================================================
REVOKE ALL ON orden_de_compra, linea_de_orden, saldo_de_linea_de_orden, linea_de_recepcion_de_orden FROM PUBLIC;
GRANT SELECT ON orden_de_compra, linea_de_orden, saldo_de_linea_de_orden, linea_de_recepcion_de_orden TO pedernal_app;
GRANT INSERT (id, empresa_id, proveedor_id, sucursal_destino_id, fecha_de_entrega_prevista, clave_idempotencia, huella, creado_por) ON orden_de_compra TO pedernal_app;
GRANT UPDATE (proveedor_id, sucursal_destino_id, fecha_de_entrega_prevista, estado, pedida_por, cerrada_por, anulada_por, motivo_de_anulacion) ON orden_de_compra TO pedernal_app;
GRANT INSERT (empresa_id, orden_id, numero, producto_id, cantidad_pedida, precio_unitario) ON linea_de_orden TO pedernal_app;
GRANT UPDATE (cantidad_pedida, precio_unitario, retirada) ON linea_de_orden TO pedernal_app;
GRANT INSERT (empresa_id, orden_id, linea, cantidad_pedida) ON saldo_de_linea_de_orden TO pedernal_app;
GRANT UPDATE (cantidad_recibida, actualizado_en) ON saldo_de_linea_de_orden TO pedernal_app;
GRANT INSERT (empresa_id, recepcion_id, linea, orden_id, linea_de_orden, confirmo_exceso) ON linea_de_recepcion_de_orden TO pedernal_app;

DO $$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['orden_de_compra', 'linea_de_orden', 'saldo_de_linea_de_orden', 'linea_de_recepcion_de_orden'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()))', v_tabla || '_app_leer', v_tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO pedernal_app WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))',
      v_tabla || '_app_alta', v_tabla);
  END LOOP;
  FOREACH v_tabla IN ARRAY ARRAY['orden_de_compra', 'linea_de_orden', 'saldo_de_linea_de_orden'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
      WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))', v_tabla || '_app_cambiar', v_tabla);
  END LOOP;
END
$$;
