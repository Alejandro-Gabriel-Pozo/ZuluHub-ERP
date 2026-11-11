-- 0033_produccion: la orden de producción en lote (E6 tramo 4): el contador de números de orden, la orden con su máquina de estados
-- (ABIERTA → CERRADA | CANCELADA, CERRADA → ANULADA) y sus renglones esperados y reales. La orden es el REGISTRO de lo que hizo el libro de
-- stock (0030): consumir ingredientes y recibir el producto son dos movimientos con origen `TRANSFORMACION:<orden>` (0032 sembró sus
-- motivos); acá no se guarda stock ni costo nuevos, solo se enlaza y se congela el costo unitario resultante.
-- Especificación: Pedernal-docs/11-especificaciones/e6-recetas-produccion-especificacion.md (§3.1, §3.3 y §4) y decisiones 24, 85, 94, 95,
-- 125 y 146 de catalogo-y-niveles-maqueta.md.
--
-- Reglas de esta migración (las mismas de 0001 a 0032):
--  * Es ADITIVA: crea tres tablas nuevas y funciones de disparador. No toca ninguna tabla anterior. Nada se rellena. Se frena con un error
--    claro si alguna ya existe.
--  * No agrega NINGUNA función SECURITY DEFINER. Toda función fija `search_path = pg_catalog, public, pg_temp` y califica sus tablas con
--    `public.`. Ninguna función nueva se otorga a la aplicación: son todas de disparador.
--  * Nadie recibe DELETE ni TRUNCATE (decisión 125: nada se borra, una orden se cancela o se anula). INSERT y UPDATE van por columna. RLS
--    activa y FORZADA; una política por comando, ninguna `FOR ALL`.
--  * Toda única de una tabla con `empresa_id` lo incluye y toda clave foránea entre tablas de empresa es COMPUESTA `(x_id, empresa_id)`.
--  * Cantidades en `numeric(18,4)` y costo en `numeric(18,6)`, exactos y con cota en ambos sentidos (`numeric` acepta `NaN`).
--  * Su reversión es un script aparte, revisado y DESTRUCTIVO si hay datos: `migraciones/reversiones/0033_revertir_produccion.sql`.
--  * DEPENDE de 0001, 0005, 0025, 0030 (stock) y 0032 (lotes y motivos de producción); se comprueba al empezar.
--
-- Decisiones de diseño (probadas por `test/integracion/produccion-migracion.test.ts`):
--
--  P1. El NÚMERO de orden lo asigna la base (el disparador de alta toma `contador_de_ordenes` con un `UPDATE ... RETURNING` en la misma
--      transacción): correlativo por empresa, sin huecos por carreras y sin hueco por un ROLLBACK. Una orden cancelada no libera su número.
--      El contador solo lo escribe ese disparador (profundidad >= 2).
--  P2. La orden nace ABIERTA y no mueve nada. Lo que identifica a la orden (producto, depósitos, versión de receta, cantidad esperada) no
--      cambia nunca; la versión de receta queda SELLADA al abrir (S-2).
--  P3. Cerrar exige, en la misma transacción, los DOS movimientos de stock con origen `TRANSFORMACION:<orden>` (consumo y producto) y que
--      `cantidad_obtenida` sea lo que entró al libro; la fecha de negocio y la hora del cierre las copia la base del movimiento del producto.
--      Anular exige las dos anulaciones espejo de esos movimientos. Cancelar solo vale con la orden ABIERTA (no movió nada).
--  P4. `cantidad_real` de cada renglón se escribe UNA vez, al cerrar; todos los renglones de una orden cerrada la tienen (diferido).

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.control_de_lote') IS NULL OR to_regclass('public.lote') IS NULL THEN
    RAISE EXCEPTION 'la producción requiere 0032_lotes_y_recetas aplicada antes (faltan los lotes)' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.movimiento_de_stock') IS NULL OR to_regclass('public.articulo_de_stock') IS NULL
     OR to_regclass('public.composicion') IS NULL OR to_regclass('public.deposito') IS NULL THEN
    RAISE EXCEPTION 'la producción requiere 0030_stock aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.fijar_version_y_fecha()') IS NULL OR to_regprocedure('public.solo_insercion()') IS NULL
     OR to_regprocedure('public.sin_borrado()') IS NULL OR to_regprocedure('public.empresa_operable(uuid)') IS NULL
     OR to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'la producción requiere 0001 y 0025 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['contador_de_ordenes', 'orden_de_produccion', 'renglon_de_orden'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'la producción nace en 0033: la tabla % ya existe (alguien la creó a mano); hay que revisarla antes de migrar', v_tabla
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Contador de órdenes: el último número de cada empresa. Solo lo escribe el disparador de alta de la orden (P1).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE contador_de_ordenes (
  empresa_id uuid PRIMARY KEY REFERENCES empresa (id),
  ultimo     integer NOT NULL CONSTRAINT contador_de_ordenes_ultimo_ck CHECK (ultimo > 0 AND ultimo < 100000000)
);

-- ---------------------------------------------------------------------------------------------
-- Orden de producción. `tipo` solo `PRODUCCION` (el desarme se abre después relajando el CHECK, S-9).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE orden_de_produccion (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la idempotencia del alta
  empresa_id                uuid NOT NULL REFERENCES empresa (id),
  numero                    integer NOT NULL CONSTRAINT orden_numero_ck CHECK (numero > 0),   -- lo fija la base (P1)
  tipo                      text NOT NULL DEFAULT 'PRODUCCION' CONSTRAINT orden_tipo_ck CHECK (tipo = 'PRODUCCION'),
  estado                    text NOT NULL DEFAULT 'ABIERTA' CONSTRAINT orden_estado_ck CHECK (estado IN ('ABIERTA', 'CERRADA', 'CANCELADA', 'ANULADA')),
  producto_id               uuid NOT NULL,
  articulo_id               uuid NOT NULL,
  composicion_id            uuid NOT NULL,
  deposito_id               uuid NOT NULL,
  deposito_destino_id       uuid NOT NULL,
  cantidad_esperada         numeric(18,4) NOT NULL CONSTRAINT orden_esperada_ck CHECK (cantidad_esperada > 0 AND cantidad_esperada < 100000000000000),
  cantidad_obtenida         numeric(18,4) CONSTRAINT orden_obtenida_ck CHECK (cantidad_obtenida > 0 AND cantidad_obtenida < 100000000000000),
  lote_id                   uuid,
  vence                     date CONSTRAINT orden_vence_ck CHECK (vence IS NULL OR vence BETWEEN date '2000-01-01' AND date '2200-12-31'),
  costo_unitario            numeric(18,6) CONSTRAINT orden_costo_ck CHECK (costo_unitario >= 0 AND costo_unitario < 1000000000000),
  costo_estado              text CONSTRAINT orden_costo_estado_ck CHECK (costo_estado IN ('SIN_COSTO', 'DEFINITIVO')),
  moneda                    char(3) NOT NULL DEFAULT 'ARS' CONSTRAINT orden_moneda_ck CHECK (moneda = 'ARS'),
  movimiento_de_consumo_id  uuid,
  movimiento_de_producto_id uuid,
  anulacion_de_consumo_id   uuid,
  anulacion_de_producto_id  uuid,
  motivo                    text CONSTRAINT orden_motivo_ck CHECK (motivo IS NULL OR texto_de_catalogo_valido(motivo, 200)),
  abierta_por               uuid NOT NULL REFERENCES persona (id),
  abierta_en                timestamptz NOT NULL,                          -- `ahora` del contexto
  cerrada_por               uuid REFERENCES persona (id),
  cerrada_en                timestamptz,
  cancelada_por             uuid REFERENCES persona (id),
  cancelada_en              timestamptz,
  anulada_por               uuid REFERENCES persona (id),
  anulada_en                timestamptz,
  hecho_en                  timestamptz,                                   -- la copia del movimiento del producto (la fija la base)
  fecha_de_negocio          date,                                          -- ídem (la fórmula de E5)
  creado_en                 timestamptz NOT NULL DEFAULT now(),
  actualizado_en            timestamptz NOT NULL DEFAULT now(),
  version                   integer NOT NULL DEFAULT 1,
  CONSTRAINT orden_de_produccion_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT orden_de_produccion_numero_uk UNIQUE (empresa_id, numero),
  CONSTRAINT orden_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT orden_articulo_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulo_de_stock (id, empresa_id),
  CONSTRAINT orden_composicion_fkey FOREIGN KEY (composicion_id, empresa_id) REFERENCES composicion (id, empresa_id),
  CONSTRAINT orden_deposito_fkey FOREIGN KEY (deposito_id, empresa_id) REFERENCES deposito (id, empresa_id),
  CONSTRAINT orden_deposito_destino_fkey FOREIGN KEY (deposito_destino_id, empresa_id) REFERENCES deposito (id, empresa_id),
  CONSTRAINT orden_lote_fkey FOREIGN KEY (lote_id, empresa_id) REFERENCES lote (id, empresa_id),
  CONSTRAINT orden_consumo_fkey FOREIGN KEY (movimiento_de_consumo_id, empresa_id) REFERENCES movimiento_de_stock (id, empresa_id),
  CONSTRAINT orden_producto_mov_fkey FOREIGN KEY (movimiento_de_producto_id, empresa_id) REFERENCES movimiento_de_stock (id, empresa_id),
  CONSTRAINT orden_anulacion_consumo_fkey FOREIGN KEY (anulacion_de_consumo_id, empresa_id) REFERENCES movimiento_de_stock (id, empresa_id),
  CONSTRAINT orden_anulacion_producto_fkey FOREIGN KEY (anulacion_de_producto_id, empresa_id) REFERENCES movimiento_de_stock (id, empresa_id),
  -- Costo: `SIN_COSTO` es costo nulo (nunca cero); `DEFINITIVO` trae el costo; se declara solo al cerrar.
  CONSTRAINT orden_costo_coherente_ck CHECK ((costo_estado = 'DEFINITIVO') = (costo_unitario IS NOT NULL)),
  -- Coherencia entre estado y lo que la orden guarda (P3).
  CONSTRAINT orden_estado_coherente_ck CHECK (
    CASE estado
      WHEN 'ABIERTA' THEN
        num_nonnulls(cantidad_obtenida, lote_id, vence, costo_estado, movimiento_de_consumo_id, movimiento_de_producto_id,
                     anulacion_de_consumo_id, anulacion_de_producto_id, motivo, cerrada_por, cerrada_en, cancelada_por, cancelada_en,
                     anulada_por, anulada_en, hecho_en, fecha_de_negocio) = 0
      WHEN 'CANCELADA' THEN
        motivo IS NOT NULL AND cancelada_por IS NOT NULL AND cancelada_en IS NOT NULL
        AND num_nonnulls(cantidad_obtenida, lote_id, vence, costo_estado, movimiento_de_consumo_id, movimiento_de_producto_id,
                         anulacion_de_consumo_id, anulacion_de_producto_id, cerrada_por, cerrada_en, anulada_por, anulada_en,
                         hecho_en, fecha_de_negocio) = 0
      WHEN 'CERRADA' THEN
        cantidad_obtenida IS NOT NULL AND costo_estado IS NOT NULL AND movimiento_de_consumo_id IS NOT NULL
        AND movimiento_de_producto_id IS NOT NULL AND cerrada_por IS NOT NULL AND cerrada_en IS NOT NULL
        AND hecho_en IS NOT NULL AND fecha_de_negocio IS NOT NULL
        AND num_nonnulls(anulacion_de_consumo_id, anulacion_de_producto_id, motivo, cancelada_por, cancelada_en, anulada_por, anulada_en) = 0
      ELSE
        cantidad_obtenida IS NOT NULL AND costo_estado IS NOT NULL AND movimiento_de_consumo_id IS NOT NULL
        AND movimiento_de_producto_id IS NOT NULL AND cerrada_por IS NOT NULL AND cerrada_en IS NOT NULL
        AND hecho_en IS NOT NULL AND fecha_de_negocio IS NOT NULL
        AND anulacion_de_consumo_id IS NOT NULL AND anulacion_de_producto_id IS NOT NULL AND motivo IS NOT NULL
        AND anulada_por IS NOT NULL AND anulada_en IS NOT NULL AND num_nonnulls(cancelada_por, cancelada_en) = 0
    END)
);
CREATE INDEX orden_de_produccion_estado_ix ON orden_de_produccion (empresa_id, estado, numero DESC);
CREATE INDEX orden_de_produccion_producto_ix ON orden_de_produccion (empresa_id, producto_id, numero DESC);

-- ---------------------------------------------------------------------------------------------
-- Renglón de la orden: lo esperado (sellado al abrir) y lo real (una vez, al cerrar), en la unidad de stock del artículo.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE renglon_de_orden (
  empresa_id        uuid NOT NULL REFERENCES empresa (id),
  orden_id          uuid NOT NULL,
  numero            integer NOT NULL CONSTRAINT renglon_de_orden_numero_ck CHECK (numero > 0 AND numero < 10000),
  articulo_id       uuid NOT NULL,
  composicion_id    uuid,
  cantidad_esperada numeric(18,4) NOT NULL CONSTRAINT renglon_de_orden_esperada_ck CHECK (cantidad_esperada > 0 AND cantidad_esperada < 100000000000000),
  cantidad_real     numeric(18,4) CONSTRAINT renglon_de_orden_real_ck CHECK (cantidad_real >= 0 AND cantidad_real < 100000000000000),
  CONSTRAINT renglon_de_orden_pkey PRIMARY KEY (empresa_id, orden_id, numero),
  CONSTRAINT renglon_de_orden_unico_uk UNIQUE NULLS NOT DISTINCT (empresa_id, orden_id, articulo_id, composicion_id),
  CONSTRAINT renglon_de_orden_orden_fkey FOREIGN KEY (orden_id, empresa_id) REFERENCES orden_de_produccion (id, empresa_id),
  CONSTRAINT renglon_de_orden_articulo_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulo_de_stock (id, empresa_id),
  CONSTRAINT renglon_de_orden_composicion_fkey FOREIGN KEY (composicion_id, empresa_id) REFERENCES composicion (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- Funciones de disparador
-- ---------------------------------------------------------------------------------------------

-- Contador: solo desde un disparador anidado (P1).
CREATE FUNCTION contador_de_ordenes_solo_por_ordenes() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'el contador de órdenes lo escribe solo el alta de una orden'
      USING ERRCODE = '42501', CONSTRAINT = 'contador_de_ordenes_solo_por_ordenes';
  END IF;
  RETURN NEW;
END
$$;

-- Orden: alta y cambios. Alta: nace ABIERTA, el número lo da el contador (P1), el producto tiene el artículo y la receta, los depósitos son
-- normales y activos. Cambio: lo que identifica la orden no cambia, y las transiciones y sus movimientos (P3).
CREATE FUNCTION orden_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_articulo record;
  v_deposito record;
  v_composicion_producto uuid;
  v_movimiento record;
  v_persona uuid := app_persona_id();
  v_suma numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'ABIERTA' THEN
      RAISE EXCEPTION 'una orden nace abierta'
        USING ERRCODE = '23514', CONSTRAINT = 'orden_nace_abierta';
    END IF;
    SELECT a.producto_id, a.activo INTO v_articulo
      FROM public.articulo_de_stock a WHERE a.id = NEW.articulo_id AND a.empresa_id = NEW.empresa_id FOR SHARE;
    IF NOT FOUND OR v_articulo.producto_id <> NEW.producto_id OR NOT v_articulo.activo THEN
      RAISE EXCEPTION 'el artículo de la orden es el del producto y está activo'
        USING ERRCODE = '23514', CONSTRAINT = 'orden_articulo_del_producto';
    END IF;
    SELECT c.producto_id INTO v_composicion_producto
      FROM public.composicion c WHERE c.id = NEW.composicion_id AND c.empresa_id = NEW.empresa_id;
    IF v_composicion_producto IS DISTINCT FROM NEW.producto_id THEN
      RAISE EXCEPTION 'la receta de la orden es del producto'
        USING ERRCODE = '23514', CONSTRAINT = 'orden_receta_del_producto';
    END IF;
    FOR v_deposito IN
      SELECT d.uso, d.activo FROM public.deposito d
       WHERE d.empresa_id = NEW.empresa_id AND d.id IN (NEW.deposito_id, NEW.deposito_destino_id) FOR SHARE
    LOOP
      IF v_deposito.uso <> 'NORMAL' OR NOT v_deposito.activo THEN
        RAISE EXCEPTION 'los depósitos de una orden son normales y están activos'
          USING ERRCODE = '23514', CONSTRAINT = 'orden_depositos_normales';
      END IF;
    END LOOP;
    INSERT INTO public.contador_de_ordenes AS k (empresa_id, ultimo) VALUES (NEW.empresa_id, 1)
    ON CONFLICT (empresa_id) DO UPDATE SET ultimo = k.ultimo + 1
    RETURNING k.ultimo INTO NEW.numero;
    NEW.creado_en := now();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.numero IS DISTINCT FROM OLD.numero
     OR NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.producto_id IS DISTINCT FROM OLD.producto_id
     OR NEW.articulo_id IS DISTINCT FROM OLD.articulo_id OR NEW.composicion_id IS DISTINCT FROM OLD.composicion_id
     OR NEW.deposito_id IS DISTINCT FROM OLD.deposito_id OR NEW.deposito_destino_id IS DISTINCT FROM OLD.deposito_destino_id
     OR NEW.cantidad_esperada IS DISTINCT FROM OLD.cantidad_esperada OR NEW.abierta_por IS DISTINCT FROM OLD.abierta_por
     OR NEW.abierta_en IS DISTINCT FROM OLD.abierta_en THEN
    RAISE EXCEPTION 'lo que identifica a una orden de producción no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'orden_inmutable';
  END IF;
  IF NOT ((OLD.estado = 'ABIERTA' AND NEW.estado IN ('CERRADA', 'CANCELADA')) OR (OLD.estado = 'CERRADA' AND NEW.estado = 'ANULADA')) THEN
    RAISE EXCEPTION 'una orden abierta pasa a cerrada o cancelada, una cerrada a anulada, y después no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'orden_transicion_invalida';
  END IF;

  IF NEW.estado = 'CERRADA' THEN
    IF NEW.cerrada_por IS DISTINCT FROM v_persona THEN
      RAISE EXCEPTION 'cierra la persona del contexto' USING ERRCODE = '23514', CONSTRAINT = 'orden_persona_del_contexto';
    END IF;
    -- Los dos movimientos con el origen de la orden: el consumo (salida) y el producto (entrada, del mismo depósito de destino y artículo).
    IF NOT EXISTS (SELECT 1 FROM public.movimiento_de_stock m
                    WHERE m.id = NEW.movimiento_de_consumo_id AND m.empresa_id = NEW.empresa_id AND m.clase = 'SALIDA'
                      AND m.motivo = 'CONSUMO_DE_TRANSFORMACION' AND m.origen_tipo = 'TRANSFORMACION' AND m.origen_id = NEW.id
                      AND m.deposito_id = NEW.deposito_id AND m.registrado_en = now()) THEN
      RAISE EXCEPTION 'cerrar exige el movimiento de consumo de esta orden, en esta transacción'
        USING ERRCODE = '23514', CONSTRAINT = 'orden_cierre_sin_consumo';
    END IF;
    SELECT m.hecho_en, m.fecha_negocio INTO v_movimiento
      FROM public.movimiento_de_stock m
     WHERE m.id = NEW.movimiento_de_producto_id AND m.empresa_id = NEW.empresa_id AND m.clase = 'ENTRADA'
       AND m.motivo = 'PRODUCTO_DE_TRANSFORMACION' AND m.origen_tipo = 'TRANSFORMACION' AND m.origen_id = NEW.id
       AND m.deposito_id = NEW.deposito_destino_id AND m.registrado_en = now();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cerrar exige el movimiento del producto de esta orden, en esta transacción'
        USING ERRCODE = '23514', CONSTRAINT = 'orden_cierre_sin_producto';
    END IF;
    SELECT coalesce(sum(r.cantidad), 0) INTO v_suma
      FROM public.renglon_de_movimiento r
     WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = NEW.movimiento_de_producto_id AND r.articulo_id = NEW.articulo_id
       AND r.deposito_id = NEW.deposito_destino_id;
    IF v_suma <> NEW.cantidad_obtenida THEN
      RAISE EXCEPTION 'la cantidad obtenida es la que entró al libro'
        USING ERRCODE = '23514', CONSTRAINT = 'orden_obtenida_es_la_del_libro';
    END IF;
    NEW.hecho_en := v_movimiento.hecho_en;
    NEW.fecha_de_negocio := v_movimiento.fecha_negocio;
  ELSIF NEW.estado = 'CANCELADA' THEN
    IF NEW.cancelada_por IS DISTINCT FROM v_persona THEN
      RAISE EXCEPTION 'cancela la persona del contexto' USING ERRCODE = '23514', CONSTRAINT = 'orden_persona_del_contexto';
    END IF;
  ELSE
    IF NEW.anulada_por IS DISTINCT FROM v_persona THEN
      RAISE EXCEPTION 'anula la persona del contexto' USING ERRCODE = '23514', CONSTRAINT = 'orden_persona_del_contexto';
    END IF;
    IF NEW.cantidad_obtenida IS DISTINCT FROM OLD.cantidad_obtenida OR NEW.lote_id IS DISTINCT FROM OLD.lote_id
       OR NEW.vence IS DISTINCT FROM OLD.vence OR NEW.costo_unitario IS DISTINCT FROM OLD.costo_unitario
       OR NEW.costo_estado IS DISTINCT FROM OLD.costo_estado OR NEW.movimiento_de_consumo_id IS DISTINCT FROM OLD.movimiento_de_consumo_id
       OR NEW.movimiento_de_producto_id IS DISTINCT FROM OLD.movimiento_de_producto_id OR NEW.cerrada_por IS DISTINCT FROM OLD.cerrada_por
       OR NEW.cerrada_en IS DISTINCT FROM OLD.cerrada_en OR NEW.hecho_en IS DISTINCT FROM OLD.hecho_en
       OR NEW.fecha_de_negocio IS DISTINCT FROM OLD.fecha_de_negocio THEN
      RAISE EXCEPTION 'anular no cambia lo que se cerró: el costo congelado, el lote y los movimientos quedan como estaban'
        USING ERRCODE = '23514', CONSTRAINT = 'orden_cerrada_no_cambia';
    END IF;
    -- Las dos anulaciones espejo de los movimientos de la orden, en esta transacción.
    IF NOT EXISTS (SELECT 1 FROM public.movimiento_de_stock m
                    WHERE m.id = NEW.anulacion_de_consumo_id AND m.empresa_id = NEW.empresa_id AND m.clase = 'ANULACION'
                      AND m.anula_a = NEW.movimiento_de_consumo_id AND m.registrado_en = now())
       OR NOT EXISTS (SELECT 1 FROM public.movimiento_de_stock m
                    WHERE m.id = NEW.anulacion_de_producto_id AND m.empresa_id = NEW.empresa_id AND m.clase = 'ANULACION'
                      AND m.anula_a = NEW.movimiento_de_producto_id AND m.registrado_en = now()) THEN
      RAISE EXCEPTION 'anular exige las dos anulaciones espejo de los movimientos de la orden, en esta transacción'
        USING ERRCODE = '23514', CONSTRAINT = 'orden_anulacion_sin_espejos';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Orden cerrada: todos sus renglones tienen lo real (P4). DIFERIDO.
CREATE FUNCTION orden_cerrada_con_reales() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.estado = 'CERRADA' AND EXISTS (
       SELECT 1 FROM public.renglon_de_orden r
        WHERE r.empresa_id = NEW.empresa_id AND r.orden_id = NEW.id AND r.cantidad_real IS NULL) THEN
    RAISE EXCEPTION 'cerrar una orden carga lo real de todos sus renglones'
      USING ERRCODE = '23514', CONSTRAINT = 'orden_cerrada_con_reales';
  END IF;
  RETURN NULL;
END
$$;

-- Renglón de la orden: alta solo con su orden, en la misma transacción y abierta; después solo se carga `cantidad_real` UNA vez, con la orden
-- abierta o recién cerrada en esta transacción.
CREATE FUNCTION renglon_de_orden_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  o record;
BEGIN
  SELECT x.estado, x.creado_en = now() AS de_esta_transaccion, x.actualizado_en = now() AS tocada_ahora INTO o
    FROM public.orden_de_produccion x WHERE x.id = NEW.orden_id AND x.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la orden del renglón no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'renglon_de_orden_orden_fkey';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT o.de_esta_transaccion OR o.estado <> 'ABIERTA' THEN
      RAISE EXCEPTION 'los renglones solo se cargan en la misma transacción que abre la orden'
        USING ERRCODE = '23514', CONSTRAINT = 'renglon_de_orden_orden_confirmada';
    END IF;
    IF NEW.cantidad_real IS NOT NULL THEN
      RAISE EXCEPTION 'lo real se carga al cerrar' USING ERRCODE = '23514', CONSTRAINT = 'renglon_de_orden_real_al_cerrar';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.orden_id IS DISTINCT FROM OLD.orden_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.numero IS DISTINCT FROM OLD.numero
     OR NEW.articulo_id IS DISTINCT FROM OLD.articulo_id OR NEW.composicion_id IS DISTINCT FROM OLD.composicion_id
     OR NEW.cantidad_esperada IS DISTINCT FROM OLD.cantidad_esperada THEN
    RAISE EXCEPTION 'lo esperado de una orden no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_de_orden_inmutable';
  END IF;
  IF OLD.cantidad_real IS NOT NULL OR NOT (o.estado = 'ABIERTA' OR (o.estado = 'CERRADA' AND o.tocada_ahora)) THEN
    RAISE EXCEPTION 'lo real se carga una sola vez, al cerrar la orden'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_de_orden_real_una_vez';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Disparadores
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER contador_de_ordenes_solo_por_ordenes BEFORE INSERT OR UPDATE ON contador_de_ordenes
  FOR EACH ROW EXECUTE FUNCTION contador_de_ordenes_solo_por_ordenes();
CREATE TRIGGER orden_de_produccion_alta BEFORE INSERT ON orden_de_produccion
  FOR EACH ROW EXECUTE FUNCTION orden_validar();
CREATE TRIGGER orden_de_produccion_cambio BEFORE UPDATE ON orden_de_produccion
  FOR EACH ROW EXECUTE FUNCTION orden_validar();
CREATE TRIGGER orden_de_produccion_version BEFORE UPDATE ON orden_de_produccion
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE CONSTRAINT TRIGGER orden_de_produccion_cerrada_con_reales AFTER UPDATE ON orden_de_produccion
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orden_cerrada_con_reales();
CREATE TRIGGER renglon_de_orden_alta BEFORE INSERT ON renglon_de_orden
  FOR EACH ROW EXECUTE FUNCTION renglon_de_orden_validar();
CREATE TRIGGER renglon_de_orden_cambio BEFORE UPDATE ON renglon_de_orden
  FOR EACH ROW EXECUTE FUNCTION renglon_de_orden_validar();

-- Nada se borra ni se vacía (ni el dueño de la base).
CREATE TRIGGER contador_de_ordenes_sin_borrado BEFORE DELETE ON contador_de_ordenes
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER contador_de_ordenes_sin_truncate BEFORE TRUNCATE ON contador_de_ordenes
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER orden_de_produccion_sin_borrado BEFORE DELETE ON orden_de_produccion
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER orden_de_produccion_sin_truncate BEFORE TRUNCATE ON orden_de_produccion
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER renglon_de_orden_sin_borrado BEFORE DELETE ON renglon_de_orden
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER renglon_de_orden_sin_truncate BEFORE TRUNCATE ON renglon_de_orden
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE ni TRUNCATE. No se conceden `numero`, `creado_en`, `hecho_en`, `fecha_de_negocio`, `moneda`
-- ni `tipo`: los fija la base. El contador se concede para que lo escriba el disparador (corre con los permisos de quien inserta la orden).
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON contador_de_ordenes, orden_de_produccion, renglon_de_orden FROM PUBLIC;
GRANT SELECT ON contador_de_ordenes, orden_de_produccion, renglon_de_orden TO pedernal_app;
GRANT INSERT (empresa_id, ultimo) ON contador_de_ordenes TO pedernal_app;
GRANT UPDATE (ultimo) ON contador_de_ordenes TO pedernal_app;
GRANT INSERT (id, empresa_id, producto_id, articulo_id, composicion_id, deposito_id, deposito_destino_id, cantidad_esperada, abierta_por, abierta_en)
  ON orden_de_produccion TO pedernal_app;
GRANT UPDATE (estado, cantidad_obtenida, lote_id, vence, costo_unitario, costo_estado, movimiento_de_consumo_id, movimiento_de_producto_id,
              anulacion_de_consumo_id, anulacion_de_producto_id, motivo, cerrada_por, cerrada_en, cancelada_por, cancelada_en,
              anulada_por, anulada_en)
  ON orden_de_produccion TO pedernal_app;
GRANT INSERT (empresa_id, orden_id, numero, articulo_id, composicion_id, cantidad_esperada) ON renglon_de_orden TO pedernal_app;
GRANT UPDATE (cantidad_real) ON renglon_de_orden TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada; una política por comando, siempre con la empresa del contexto; quien abre es la persona del contexto.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE contador_de_ordenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contador_de_ordenes FORCE ROW LEVEL SECURITY;
ALTER TABLE orden_de_produccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_de_produccion FORCE ROW LEVEL SECURITY;
ALTER TABLE renglon_de_orden ENABLE ROW LEVEL SECURITY;
ALTER TABLE renglon_de_orden FORCE ROW LEVEL SECURITY;

CREATE POLICY contador_de_ordenes_app_leer ON contador_de_ordenes FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY contador_de_ordenes_app_alta ON contador_de_ordenes FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY contador_de_ordenes_app_cambiar ON contador_de_ordenes FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY orden_de_produccion_app_leer ON orden_de_produccion FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY orden_de_produccion_app_alta ON orden_de_produccion FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND abierta_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY orden_de_produccion_app_cambiar ON orden_de_produccion FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY renglon_de_orden_app_leer ON renglon_de_orden FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY renglon_de_orden_app_alta ON renglon_de_orden FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY renglon_de_orden_app_cambiar ON renglon_de_orden FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
