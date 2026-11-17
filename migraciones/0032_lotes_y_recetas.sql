-- 0032_lotes_y_recetas: lotes, calidad y recetas dentro de recetas (E6 tramo 3). Suma al stock de E5 el lote como SEGUNDA dimensión del saldo
-- (control por artículo, lote con vencimiento, calidad con historia, reasignación entre lotes), abre las subcomposiciones (un componente
-- puede ser un producto ELABORADO, sin ciclos y hasta cinco niveles) y deja los dos motivos de movimiento de la producción.
-- Especificación: Pedernal-docs/11-especificaciones/e6-recetas-produccion-especificacion.md (§3.1, §4 y §5) y decisiones 22, 26, 27, 74, 94,
-- 96, 118, 125 y 146 de catalogo-y-niveles-maqueta.md. La orden de producción es de 0033; nada de lo de acá se enciende solo: sin control de
-- lote en un artículo no se escribe ninguna fila de lote (la perilla `lotes` y el módulo `produccion` los verifica la aplicación).
--
-- Reglas de esta migración (las mismas de 0001 a 0031):
--  * Es ADITIVA: crea seis tablas, relaja UN CHECK (`componente_compuesto_cerrado_ck`: abrir una puerta no destruye datos), agrega UNA columna
--    nula (`composicion.pasos`) y reemplaza tres funciones de disparador. Nada se rellena: ninguna empresa tiene lotes. Se comprueba al
--    empezar y se frena con un error claro si alguna de las tablas ya existe.
--  * No agrega NINGUNA función SECURITY DEFINER. Toda función fija `search_path = pg_catalog, public, pg_temp` y califica sus tablas con
--    `public.`. Ninguna función nueva se otorga a la aplicación: son todas de disparador.
--  * Nadie recibe DELETE ni TRUNCATE (decisión 125: nada se borra, se anula con un registro espejo). Los disparadores los frenan aun al dueño
--    de la base. INSERT y UPDATE van por columna. RLS activa y FORZADA en toda tabla nueva; una política por comando, ninguna `FOR ALL`.
--  * Toda única de una tabla con `empresa_id` lo incluye y toda clave foránea entre tablas de empresa es COMPUESTA `(x_id, empresa_id)`.
--  * Cantidades en `numeric(18,4)` exacto con cota en ambos sentidos (`numeric` acepta `NaN`, la trampa de 0009).
--  * Los textos que escribe una persona (código de lote, motivo, pasos) se validan con la LISTA DE PERMITIDOS del catálogo
--    (`texto_de_catalogo_valido`, 0025); los códigos y las claves con patrones que dicen lo que se PERMITE.
--  * Su reversión es un script aparte, revisado y DESTRUCTIVO si hay datos: `migraciones/reversiones/0032_revertir_lotes_y_recetas.sql`.
--  * DEPENDE de 0001, 0005, 0007, 0025 (producto, texto de catálogo), 0030 (stock) y 0031 (costos); se comprueba al empezar.
--
-- Decisiones de diseño (probadas por `test/integracion/stock-lotes-migracion.test.ts`):
--
--  L1. El lote es del ARTÍCULO y se identifica por (código, origen): el mismo código del mismo origen es el mismo lote aunque llegue otra
--      vez (`NULLS NOT DISTINCT`). Cada artículo con control tiene UN lote «SIN_ASIGNAR» (código reservado: el texto de catálogo no admite
--      el guion bajo) que recibe lo que no se puede imputar a un lote real y es el único que puede quedar negativo.
--  L2. `saldo_de_lote` es DERIVADO: lo escriben únicamente los disparadores de `renglon_de_lote` y de `reasignacion_de_lote` (el mismo
--      mecanismo que `saldo_de_stock`: profundidad de disparador mayor o igual que 2). Un lote real nunca baja de cero.
--  L3. Todo renglón del libro de un artículo con control ACTIVO queda cubierto por lotes (la suma de sus `renglon_de_lote` es su cantidad)
--      y, por depósito, Σ saldo_de_lote = saldo_de_stock: dos disparadores DIFERIDOS lo verifican al confirmar. La anulación repite los
--      lotes del original con signo contrario (el espejo exacto).
--  L4. La calidad es la ÚLTIMA fila de `calidad_de_lote` (solo inserción, con quién, cuándo y por qué); `lote.calidad` es su copia y solo la
--      escribe el disparador de la historia. Cambiar la calidad NO mueve stock (supuesto S-4).
--  L5. Una receta no puede contener, directa ni indirectamente, al propio producto, ni pasar de cinco niveles contando la receta del
--      propio producto como el primero (supuesto S-6). Un disparador DIFERIDO lo verifica al confirmar, bajo un candado de empresa que
--      serializa dos guardados cruzados (A lleva B y B lleva A): cada uno es válido solo y juntos formarían un ciclo.

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.saldo_de_stock') IS NULL OR to_regclass('public.renglon_de_movimiento') IS NULL
     OR to_regclass('public.composicion') IS NULL OR to_regclass('public.articulo_de_stock') IS NULL THEN
    RAISE EXCEPTION 'lotes y recetas requieren 0030_stock aplicada antes (faltan el saldo, el renglón, la composición o el artículo)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.costo_de_renglon') IS NULL THEN
    RAISE EXCEPTION 'lotes y recetas requieren 0031_stock_costos aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.fijar_version_y_fecha()') IS NULL OR to_regprocedure('public.solo_insercion()') IS NULL
     OR to_regprocedure('public.sin_borrado()') IS NULL OR to_regprocedure('public.empresa_operable(uuid)') IS NULL
     OR to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'lotes y recetas requieren 0001, 0007 y 0025 aplicadas antes (funciones de contexto, de solo inserción y de texto)'
      USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['control_de_lote', 'lote', 'calidad_de_lote', 'renglon_de_lote', 'saldo_de_lote', 'reasignacion_de_lote'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'lotes nace en 0032: la tabla % ya existe (alguien la creó a mano); hay que revisarla antes de migrar', v_tabla
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'composicion' AND column_name = 'pasos') THEN
    RAISE EXCEPTION 'composicion.pasos nace en 0032: la columna ya existe; hay que revisarla antes de migrar' USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Recetas: los pasos de la ficha de cocina (texto de catálogo, una sola línea), el compuesto abierto y su única, y las funciones que
-- admiten elaborados. Aditivo: una columna nula y un CHECK relajado.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE composicion ADD COLUMN pasos text CONSTRAINT composicion_pasos_ck CHECK (pasos IS NULL OR texto_de_catalogo_valido(pasos, 2000));
ALTER TABLE componente_de_composicion DROP CONSTRAINT componente_compuesto_cerrado_ck;
-- Un elaborado una sola vez por versión (el artículo ya tenía la suya: `componente_articulo_uk`).
ALTER TABLE componente_de_composicion ADD CONSTRAINT componente_compuesto_uk UNIQUE (empresa_id, composicion_id, compuesto_id);

-- Artículo de stock: ahora también el elaborado y el vendible pueden tener stock propio (la medialuna se vende y se produce, D94). Que la
-- empresa tenga encendida la producción y que el producto tenga receta lo comprueba el caso de uso (la perilla no está en la base).
CREATE OR REPLACE FUNCTION articulo_de_stock_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.producto_id IS DISTINCT FROM OLD.producto_id
       OR NEW.unidad_de_stock_id IS DISTINCT FROM OLD.unidad_de_stock_id OR NEW.dimension IS DISTINCT FROM OLD.dimension THEN
      RAISE EXCEPTION 'el producto y la unidad de un artículo de stock no cambian'
        USING ERRCODE = '23514', CONSTRAINT = 'articulo_de_stock_inmutable';
    END IF;
    IF OLD.activo AND NOT NEW.activo AND EXISTS (
         SELECT 1
           FROM public.componente_de_composicion k
           JOIN public.composicion c ON c.id = k.composicion_id AND c.empresa_id = k.empresa_id
          WHERE k.empresa_id = OLD.empresa_id AND k.articulo_id = OLD.id
            AND c.numero = (SELECT max(c2.numero) FROM public.composicion c2
                             WHERE c2.empresa_id = c.empresa_id AND c2.producto_id = c.producto_id)) THEN
      RAISE EXCEPTION 'el artículo está en la composición vigente de un producto'
        USING ERRCODE = '23514', CONSTRAINT = 'articulo_de_stock_en_composicion_activa';
    END IF;
    RETURN NEW;
  END IF;
  SELECT p.clase_de_uso INTO v_clase FROM public.producto p WHERE p.id = NEW.producto_id AND p.empresa_id = NEW.empresa_id;
  IF v_clase IS NOT NULL AND v_clase NOT IN ('MATERIA_PRIMA', 'INSUMO', 'REVENTA', 'ELABORADO', 'VENDIBLE') THEN
    RAISE EXCEPTION 'esta clase de producto no se controla en stock'
      USING ERRCODE = '23514', CONSTRAINT = 'articulo_de_stock_clase_no_controlable';
  END IF;
  RETURN NEW;
END
$$;

-- Composición: de un producto VENDIBLE o ELABORADO (el elaborado lleva la receta de su tanda), con el número siguiente al último.
CREATE OR REPLACE FUNCTION composicion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_anterior integer;
BEGIN
  NEW.registrada_en := now();
  SELECT p.clase_de_uso INTO v_clase FROM public.producto p WHERE p.id = NEW.producto_id AND p.empresa_id = NEW.empresa_id;
  IF v_clase IS NOT NULL AND v_clase NOT IN ('VENDIBLE', 'ELABORADO') THEN
    RAISE EXCEPTION 'solo un producto vendible o elaborado tiene composición'
      USING ERRCODE = '23514', CONSTRAINT = 'composicion_producto_no_vendible';
  END IF;
  SELECT coalesce(max(c.numero), 0) INTO v_anterior
    FROM public.composicion c WHERE c.empresa_id = NEW.empresa_id AND c.producto_id = NEW.producto_id;
  IF NEW.numero <> v_anterior + 1 THEN
    RAISE EXCEPTION 'el número de versión de una composición es el siguiente al último'
      USING ERRCODE = '23514', CONSTRAINT = 'composicion_numero_salteado';
  END IF;
  RETURN NEW;
END
$$;

-- Componente: solo entra con su versión (T3 de 0030); con un artículo activo, o con un producto ELABORADO activo (FOR SHARE: no se desactiva
-- a la vez).
CREATE OR REPLACE FUNCTION componente_de_composicion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_de_esta_transaccion boolean;
  v_activo boolean;
  v_producto record;
BEGIN
  SELECT c.registrada_en = now() INTO v_de_esta_transaccion
    FROM public.composicion c WHERE c.id = NEW.composicion_id AND c.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la composición del componente no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'componente_composicion_fkey';
  END IF;
  IF NOT v_de_esta_transaccion THEN
    RAISE EXCEPTION 'los componentes solo se cargan en la misma transacción que crea la versión de la composición'
      USING ERRCODE = '23514', CONSTRAINT = 'componente_version_confirmada';
  END IF;
  IF NEW.articulo_id IS NOT NULL THEN
    SELECT a.activo INTO v_activo
      FROM public.articulo_de_stock a WHERE a.id = NEW.articulo_id AND a.empresa_id = NEW.empresa_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'el artículo del componente no existe'
        USING ERRCODE = '23503', CONSTRAINT = 'componente_articulo_fkey';
    END IF;
    IF NOT v_activo THEN
      RAISE EXCEPTION 'el artículo del componente no está activo'
        USING ERRCODE = '23514', CONSTRAINT = 'componente_articulo_inactivo';
    END IF;
  ELSIF NEW.compuesto_id IS NOT NULL THEN
    SELECT p.clase_de_uso, p.activo INTO v_producto
      FROM public.producto p WHERE p.id = NEW.compuesto_id AND p.empresa_id = NEW.empresa_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'el producto del componente no existe'
        USING ERRCODE = '23503', CONSTRAINT = 'componente_compuesto_fkey';
    END IF;
    IF v_producto.clase_de_uso <> 'ELABORADO' THEN
      RAISE EXCEPTION 'un componente que no es un artículo de stock es un producto elaborado'
        USING ERRCODE = '23514', CONSTRAINT = 'componente_compuesto_no_elaborado';
    END IF;
    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'el producto elaborado del componente no está activo'
        USING ERRCODE = '23514', CONSTRAINT = 'componente_compuesto_inactivo';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Sin ciclos y hasta cinco niveles (L5). DIFERIDO: corre una vez por versión (en el último componente), con todo lo de la transacción ya
-- visible. Baja desde el producto de la versión por la composición VIGENTE (la de mayor número) de cada elaborado. El candado de empresa
-- serializa dos guardados cruzados: el segundo en confirmar espera al primero y ve su receta.
CREATE FUNCTION composicion_sin_ciclos() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_producto uuid;
  v_ultimo integer;
  v_ciclo boolean;
  v_niveles integer;
BEGIN
  SELECT max(k.numero) INTO v_ultimo
    FROM public.componente_de_composicion k WHERE k.empresa_id = NEW.empresa_id AND k.composicion_id = NEW.composicion_id;
  IF NEW.numero <> v_ultimo THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('composicion_sin_ciclos:' || NEW.empresa_id::text, 0));
  SELECT c.producto_id INTO v_producto FROM public.composicion c WHERE c.id = NEW.composicion_id AND c.empresa_id = NEW.empresa_id;
  WITH RECURSIVE camino (producto_id, nivel, ruta, ciclo) AS (
    SELECT v_producto, 1, ARRAY[v_producto], false
    UNION ALL
    SELECT k.compuesto_id, camino.nivel + 1, camino.ruta || k.compuesto_id, k.compuesto_id = ANY (camino.ruta)
      FROM camino
      JOIN LATERAL (SELECT c.id FROM public.composicion c
                     WHERE c.empresa_id = NEW.empresa_id AND c.producto_id = camino.producto_id
                     ORDER BY c.numero DESC LIMIT 1) vigente ON true
      JOIN public.componente_de_composicion k
        ON k.empresa_id = NEW.empresa_id AND k.composicion_id = vigente.id AND k.compuesto_id IS NOT NULL
     WHERE NOT camino.ciclo AND camino.nivel < 7
  )
  SELECT coalesce(bool_or(ciclo), false), coalesce(max(nivel) FILTER (WHERE NOT ciclo), 1) INTO v_ciclo, v_niveles FROM camino;
  IF v_ciclo THEN
    RAISE EXCEPTION 'una receta no puede contener, directa ni indirectamente, al propio producto'
      USING ERRCODE = '23514', CONSTRAINT = 'composicion_con_ciclo';
  END IF;
  IF v_niveles > 5 THEN
    RAISE EXCEPTION 'una receta admite hasta cinco niveles de recetas dentro de recetas'
      USING ERRCODE = '23514', CONSTRAINT = 'composicion_demasiado_anidada';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER componente_de_composicion_sin_ciclos AFTER INSERT ON componente_de_composicion
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION composicion_sin_ciclos();

-- ---------------------------------------------------------------------------------------------
-- Control de lote: qué artículos llevan lote y cómo. Todo artículo nace sin control (D26: «los que se declaren, uno por uno»). `activo` en
-- falso congela: los lotes y saldos siguen consultables y el libro deja de pedirlos.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE control_de_lote (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  articulo_id    uuid NOT NULL,
  modo           text NOT NULL CONSTRAINT control_de_lote_modo_ck CHECK (modo IN ('LOTE', 'LOTE_Y_VENCIMIENTO')),
  con_calidad    boolean NOT NULL DEFAULT false,
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT control_de_lote_pkey PRIMARY KEY (empresa_id, articulo_id),
  CONSTRAINT control_de_lote_articulo_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulo_de_stock (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- Lote: de un artículo. `calidad` nula = el artículo no lleva calidad; solo la escribe el disparador de la historia (L4).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE lote (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la idempotencia del alta
  empresa_id              uuid NOT NULL REFERENCES empresa (id),
  articulo_id             uuid NOT NULL,
  codigo                  text NOT NULL,
  referencia_de_origen    text CONSTRAINT lote_referencia_ck CHECK (referencia_de_origen IS NULL OR texto_de_catalogo_valido(referencia_de_origen, 80)),
  fecha_de_elaboracion    date CONSTRAINT lote_elaboracion_ck CHECK (fecha_de_elaboracion IS NULL OR fecha_de_elaboracion BETWEEN date '2000-01-01' AND date '2200-12-31'),
  fecha_de_vencimiento    date CONSTRAINT lote_vencimiento_ck CHECK (fecha_de_vencimiento IS NULL OR fecha_de_vencimiento BETWEEN date '2000-01-01' AND date '2200-12-31'),
  es_sin_asignar          boolean NOT NULL DEFAULT false,
  calidad                 text CONSTRAINT lote_calidad_ck CHECK (calidad IS NULL OR calidad IN ('EN_CUARENTENA', 'EN_REVISION', 'LIBERADO', 'RECHAZADO')),
  fecha_de_primer_ingreso date NOT NULL CONSTRAINT lote_primer_ingreso_ck CHECK (fecha_de_primer_ingreso BETWEEN date '2000-01-01' AND date '2200-12-31'),
  creado_por              uuid NOT NULL REFERENCES persona (id),
  creado_en               timestamptz NOT NULL,                          -- `ahora` del contexto
  actualizado_en          timestamptz NOT NULL DEFAULT now(),
  version                 integer NOT NULL DEFAULT 1,
  CONSTRAINT lote_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT lote_id_articulo_uk UNIQUE (id, articulo_id, empresa_id),      -- destino de las claves que fijan el artículo del lote
  -- El mismo código del mismo origen es el mismo lote (L1).
  CONSTRAINT lote_identidad_uk UNIQUE NULLS NOT DISTINCT (empresa_id, articulo_id, codigo, referencia_de_origen),
  CONSTRAINT lote_articulo_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulo_de_stock (id, empresa_id),
  -- «SIN_ASIGNAR» es el código reservado del lote sin asignar; el resto es texto de catálogo (que no admite el guion bajo).
  CONSTRAINT lote_codigo_ck CHECK ((es_sin_asignar AND codigo = 'SIN_ASIGNAR') OR (NOT es_sin_asignar AND texto_de_catalogo_valido(codigo, 40))),
  CONSTRAINT lote_sin_asignar_ck CHECK (NOT es_sin_asignar OR (referencia_de_origen IS NULL AND fecha_de_elaboracion IS NULL
                                                                AND fecha_de_vencimiento IS NULL AND calidad IS NULL)),
  CONSTRAINT lote_fechas_ck CHECK (fecha_de_elaboracion IS NULL OR fecha_de_vencimiento IS NULL OR fecha_de_elaboracion <= fecha_de_vencimiento)
);
-- Un solo «sin asignar» por artículo.
CREATE UNIQUE INDEX lote_sin_asignar_uk ON lote (empresa_id, articulo_id) WHERE es_sin_asignar;
-- Candidatos de una salida: primero el que vence antes (FEFO), después el que entró antes.
CREATE INDEX lote_fefo_ix ON lote (empresa_id, articulo_id, fecha_de_vencimiento NULLS LAST, fecha_de_primer_ingreso, id);

-- ---------------------------------------------------------------------------------------------
-- Calidad del lote: historia de SOLO INSERCIÓN; vale la de mayor `orden`. El motivo es obligatorio.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE calidad_de_lote (
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  lote_id    uuid NOT NULL,
  estado     text NOT NULL CONSTRAINT calidad_de_lote_estado_ck CHECK (estado IN ('EN_CUARENTENA', 'EN_REVISION', 'LIBERADO', 'RECHAZADO')),
  motivo     text NOT NULL CONSTRAINT calidad_de_lote_motivo_ck CHECK (texto_de_catalogo_valido(motivo, 300)),
  por        uuid NOT NULL REFERENCES persona (id),
  en         timestamptz NOT NULL,                                      -- `ahora` del contexto
  orden      bigint GENERATED ALWAYS AS IDENTITY,
  CONSTRAINT calidad_de_lote_pkey PRIMARY KEY (empresa_id, lote_id, orden),
  CONSTRAINT calidad_de_lote_lote_fkey FOREIGN KEY (lote_id, empresa_id) REFERENCES lote (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- Renglón de lote: de qué lote salió (o a cuál entró) cada renglón del libro. SOLO INSERCIÓN. La suma por renglón ES la cantidad del
-- renglón (L3).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE renglon_de_lote (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  movimiento_id  uuid NOT NULL,
  renglon_numero integer NOT NULL,
  lote_id        uuid NOT NULL,
  cantidad       numeric(18,4) NOT NULL CONSTRAINT renglon_de_lote_cantidad_ck
                 CHECK (cantidad <> 0 AND cantidad > -100000000000000 AND cantidad < 100000000000000),
  CONSTRAINT renglon_de_lote_pkey PRIMARY KEY (empresa_id, movimiento_id, renglon_numero, lote_id),
  CONSTRAINT renglon_de_lote_renglon_fkey FOREIGN KEY (empresa_id, movimiento_id, renglon_numero)
    REFERENCES renglon_de_movimiento (empresa_id, movimiento_id, numero),
  CONSTRAINT renglon_de_lote_lote_fkey FOREIGN KEY (lote_id, empresa_id) REFERENCES lote (id, empresa_id)
);
CREATE INDEX renglon_de_lote_lote_ix ON renglon_de_lote (empresa_id, lote_id);

-- ---------------------------------------------------------------------------------------------
-- Saldo de lote: la existencia por (depósito, artículo, lote). Solo la escriben los disparadores (L2). Solo el «sin asignar» puede ser
-- negativo.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE saldo_de_lote (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  deposito_id    uuid NOT NULL,
  articulo_id    uuid NOT NULL,
  lote_id        uuid NOT NULL,
  es_sin_asignar boolean NOT NULL,
  existencia     numeric(18,4) NOT NULL CONSTRAINT saldo_de_lote_existencia_ck
                 CHECK (existencia > -100000000000000 AND existencia < 100000000000000),
  CONSTRAINT saldo_de_lote_pkey PRIMARY KEY (empresa_id, deposito_id, articulo_id, lote_id),
  CONSTRAINT saldo_de_lote_deposito_fkey FOREIGN KEY (deposito_id, empresa_id) REFERENCES deposito (id, empresa_id),
  CONSTRAINT saldo_de_lote_lote_fkey FOREIGN KEY (lote_id, articulo_id, empresa_id) REFERENCES lote (id, articulo_id, empresa_id)
);
CREATE INDEX saldo_de_lote_lote_ix ON saldo_de_lote (empresa_id, lote_id);

-- ---------------------------------------------------------------------------------------------
-- Reasignación de lote: mueve saldo ENTRE lotes de un mismo depósito y artículo sin tocar el libro ni el saldo del artículo (la suma no
-- cambia). Sin origen (`lote_origen_id` nulo) es la APERTURA: lo que ya había al activar el control entra al «sin asignar». SOLO INSERCIÓN.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE reasignacion_de_lote (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  deposito_id        uuid NOT NULL,
  articulo_id        uuid NOT NULL,
  lote_origen_id     uuid,
  lote_destino_id    uuid NOT NULL,
  cantidad           numeric(18,4) NOT NULL CONSTRAINT reasignacion_cantidad_ck
                     CHECK (cantidad <> 0 AND cantidad > -100000000000000 AND cantidad < 100000000000000),
  motivo             text NOT NULL CONSTRAINT reasignacion_motivo_ck CHECK (texto_de_catalogo_valido(motivo, 300)),
  clave_idempotencia text NOT NULL CONSTRAINT reasignacion_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{8,200}$'),
  por                uuid NOT NULL REFERENCES persona (id),
  en                 timestamptz NOT NULL,                                -- `ahora` del contexto
  CONSTRAINT reasignacion_de_lote_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT reasignacion_de_lote_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT reasignacion_de_lote_deposito_fkey FOREIGN KEY (deposito_id, empresa_id) REFERENCES deposito (id, empresa_id),
  CONSTRAINT reasignacion_de_lote_origen_fkey FOREIGN KEY (lote_origen_id, articulo_id, empresa_id) REFERENCES lote (id, articulo_id, empresa_id),
  CONSTRAINT reasignacion_de_lote_destino_fkey FOREIGN KEY (lote_destino_id, articulo_id, empresa_id) REFERENCES lote (id, articulo_id, empresa_id),
  -- Con origen se mueve una cantidad positiva a OTRO lote; sin origen es la apertura (puede ser negativa).
  CONSTRAINT reasignacion_forma_ck CHECK (lote_origen_id IS NULL OR (cantidad > 0 AND lote_origen_id <> lote_destino_id))
);

-- ---------------------------------------------------------------------------------------------
-- Funciones de disparador
-- ---------------------------------------------------------------------------------------------

-- Control de lote: el artículo es de la empresa y se puede activar solo si Σ lotes = saldo (la apertura ya está hecha). DIFERIDO.
CREATE FUNCTION control_de_lote_coherente() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.activo AND EXISTS (
       SELECT 1
         FROM (SELECT l.deposito_id, sum(l.existencia) AS suma
                 FROM public.saldo_de_lote l WHERE l.empresa_id = NEW.empresa_id AND l.articulo_id = NEW.articulo_id
                GROUP BY l.deposito_id) l
         FULL JOIN (SELECT s.deposito_id, s.existencia FROM public.saldo_de_stock s
                     WHERE s.empresa_id = NEW.empresa_id AND s.articulo_id = NEW.articulo_id) s ON s.deposito_id = l.deposito_id
        WHERE coalesce(l.suma, 0) <> coalesce(s.existencia, 0)) THEN
    RAISE EXCEPTION 'al activar el control de lote, los lotes tienen que sumar la existencia de cada depósito'
      USING ERRCODE = '23514', CONSTRAINT = 'control_de_lote_sin_apertura';
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION control_de_lote_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.articulo_id IS DISTINCT FROM OLD.articulo_id) THEN
    RAISE EXCEPTION 'el artículo de un control de lote no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'control_de_lote_inmutable';
  END IF;
  RETURN NEW;
END
$$;

-- Lote: solo de un artículo con control ACTIVO; con `LOTE_Y_VENCIMIENTO` el vencimiento es obligatorio (D118: «sin la fecha no se confirma»);
-- lo que identifica al lote no cambia; la calidad solo cambia desde el disparador de la historia (profundidad >= 2, L4).
CREATE FUNCTION lote_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_control record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.articulo_id IS DISTINCT FROM OLD.articulo_id
       OR NEW.codigo IS DISTINCT FROM OLD.codigo OR NEW.referencia_de_origen IS DISTINCT FROM OLD.referencia_de_origen
       OR NEW.es_sin_asignar IS DISTINCT FROM OLD.es_sin_asignar OR NEW.fecha_de_primer_ingreso IS DISTINCT FROM OLD.fecha_de_primer_ingreso
       OR NEW.creado_por IS DISTINCT FROM OLD.creado_por OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
      RAISE EXCEPTION 'la identidad de un lote no cambia: solo sus fechas'
        USING ERRCODE = '23514', CONSTRAINT = 'lote_inmutable';
    END IF;
    IF NEW.calidad IS DISTINCT FROM OLD.calidad AND pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'la calidad de un lote la escribe solo su historia'
        USING ERRCODE = '42501', CONSTRAINT = 'lote_calidad_solo_por_historial';
    END IF;
    IF NOT NEW.es_sin_asignar AND OLD.fecha_de_vencimiento IS NOT NULL AND NEW.fecha_de_vencimiento IS NULL THEN
      SELECT c.modo INTO v_control FROM public.control_de_lote c WHERE c.empresa_id = NEW.empresa_id AND c.articulo_id = NEW.articulo_id;
      IF v_control.modo = 'LOTE_Y_VENCIMIENTO' THEN
        RAISE EXCEPTION 'el lote de este artículo lleva vencimiento'
          USING ERRCODE = '23514', CONSTRAINT = 'lote_vencimiento_requerido';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  SELECT c.modo, c.activo INTO v_control
    FROM public.control_de_lote c WHERE c.empresa_id = NEW.empresa_id AND c.articulo_id = NEW.articulo_id FOR SHARE;
  IF NOT FOUND OR NOT v_control.activo THEN
    RAISE EXCEPTION 'el artículo no lleva control de lote'
      USING ERRCODE = '23514', CONSTRAINT = 'lote_sin_control';
  END IF;
  IF NOT NEW.es_sin_asignar AND v_control.modo = 'LOTE_Y_VENCIMIENTO' AND NEW.fecha_de_vencimiento IS NULL THEN
    RAISE EXCEPTION 'el lote de este artículo lleva vencimiento'
      USING ERRCODE = '23514', CONSTRAINT = 'lote_vencimiento_requerido';
  END IF;
  IF NEW.calidad IS NOT NULL AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'la calidad de un lote la escribe solo su historia'
      USING ERRCODE = '42501', CONSTRAINT = 'lote_calidad_solo_por_historial';
  END IF;
  RETURN NEW;
END
$$;

-- Calidad (antes de insertar): solo de un artículo cuyo control lleva calidad (FOR SHARE).
CREATE FUNCTION calidad_de_lote_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_con_calidad boolean;
BEGIN
  SELECT c.con_calidad INTO v_con_calidad
    FROM public.lote l JOIN public.control_de_lote c ON c.empresa_id = l.empresa_id AND c.articulo_id = l.articulo_id
   WHERE l.id = NEW.lote_id AND l.empresa_id = NEW.empresa_id AND NOT l.es_sin_asignar FOR SHARE OF c;
  IF NOT FOUND OR NOT v_con_calidad THEN
    RAISE EXCEPTION 'el lote no lleva calidad'
      USING ERRCODE = '23514', CONSTRAINT = 'calidad_de_lote_sin_calidad';
  END IF;
  RETURN NEW;
END
$$;

-- Calidad (después de insertar): copia el estado al lote (L4). Corre anidado: la copia pasa la guarda de profundidad.
CREATE FUNCTION calidad_de_lote_aplicar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  UPDATE public.lote SET calidad = NEW.estado WHERE id = NEW.lote_id AND empresa_id = NEW.empresa_id;
  RETURN NULL;
END
$$;

-- Renglón de lote (antes de insertar): solo en la misma transacción que su movimiento; el lote es del artículo del renglón y la cantidad
-- lleva el signo del renglón.
CREATE FUNCTION renglon_de_lote_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  r record;
  v_lote_articulo uuid;
BEGIN
  SELECT x.articulo_id, x.cantidad, m.registrado_en = now() AS de_esta_transaccion INTO r
    FROM public.renglon_de_movimiento x
    JOIN public.movimiento_de_stock m ON m.id = x.movimiento_id AND m.empresa_id = x.empresa_id
   WHERE x.empresa_id = NEW.empresa_id AND x.movimiento_id = NEW.movimiento_id AND x.numero = NEW.renglon_numero;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el renglón del lote no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'renglon_de_lote_renglon_fkey';
  END IF;
  IF NOT r.de_esta_transaccion THEN
    RAISE EXCEPTION 'los lotes de un renglón solo se cargan en la misma transacción que crea el movimiento'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_de_lote_movimiento_confirmado';
  END IF;
  SELECT l.articulo_id INTO v_lote_articulo FROM public.lote l WHERE l.id = NEW.lote_id AND l.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el lote del renglón no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'renglon_de_lote_lote_fkey';
  END IF;
  IF v_lote_articulo <> r.articulo_id THEN
    RAISE EXCEPTION 'el lote es de otro artículo que el del renglón'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_de_lote_otro_articulo';
  END IF;
  IF (NEW.cantidad > 0) <> (r.cantidad > 0) THEN
    RAISE EXCEPTION 'la cantidad del lote lleva el signo del renglón'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_de_lote_signo_invalido';
  END IF;
  RETURN NEW;
END
$$;

-- Renglón de lote (después de insertar): aplica la cantidad al saldo del lote con un `INSERT ... ON CONFLICT DO UPDATE` atómico, que toma la
-- fila y serializa a quienes mueven lo mismo (L2). El CHECK del saldo impide que un lote real baje de cero.
CREATE FUNCTION renglon_de_lote_aplicar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  r record;
  v_sin_asignar boolean;
BEGIN
  SELECT x.deposito_id, x.articulo_id INTO r
    FROM public.renglon_de_movimiento x
   WHERE x.empresa_id = NEW.empresa_id AND x.movimiento_id = NEW.movimiento_id AND x.numero = NEW.renglon_numero;
  SELECT l.es_sin_asignar INTO v_sin_asignar FROM public.lote l WHERE l.id = NEW.lote_id AND l.empresa_id = NEW.empresa_id;
  INSERT INTO public.saldo_de_lote AS s (empresa_id, deposito_id, articulo_id, lote_id, es_sin_asignar, existencia)
  VALUES (NEW.empresa_id, r.deposito_id, r.articulo_id, NEW.lote_id, v_sin_asignar, NEW.cantidad)
  ON CONFLICT (empresa_id, deposito_id, articulo_id, lote_id) DO UPDATE SET existencia = s.existencia + EXCLUDED.existencia;
  RETURN NULL;
END
$$;

-- Renglón cubierto por lotes (L3), DIFERIDO: si el artículo tiene control ACTIVO, los lotes del renglón suman su cantidad; y una anulación
-- repite los lotes del original con signo contrario (el espejo exacto: lo que volvió a cada lote es lo que había salido de él).
CREATE FUNCTION renglon_cubierto_por_lotes() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_activo boolean;
  v_suma numeric;
  m record;
  v_original integer;
BEGIN
  SELECT c.activo INTO v_activo FROM public.control_de_lote c WHERE c.empresa_id = NEW.empresa_id AND c.articulo_id = NEW.articulo_id;
  IF NOT FOUND OR NOT v_activo THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(sum(l.cantidad), 0) INTO v_suma
    FROM public.renglon_de_lote l
   WHERE l.empresa_id = NEW.empresa_id AND l.movimiento_id = NEW.movimiento_id AND l.renglon_numero = NEW.numero;
  IF v_suma <> NEW.cantidad THEN
    RAISE EXCEPTION 'los lotes de un renglón suman su cantidad: el artículo lleva control de lote'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_sin_lotes_completos';
  END IF;
  SELECT x.clase, x.anula_a INTO m FROM public.movimiento_de_stock x WHERE x.id = NEW.movimiento_id AND x.empresa_id = NEW.empresa_id;
  IF m.clase = 'ANULACION' THEN
    SELECT o.numero INTO v_original
      FROM public.renglon_de_movimiento o
     WHERE o.empresa_id = NEW.empresa_id AND o.movimiento_id = m.anula_a AND o.deposito_id = NEW.deposito_id
       AND o.articulo_id = NEW.articulo_id AND o.composicion_id IS NOT DISTINCT FROM NEW.composicion_id;
    IF FOUND AND EXISTS (SELECT 1 FROM public.renglon_de_lote l
                          WHERE l.empresa_id = NEW.empresa_id AND l.movimiento_id = m.anula_a AND l.renglon_numero = v_original) THEN
      IF EXISTS (
           (SELECT l.lote_id, l.cantidad FROM public.renglon_de_lote l
             WHERE l.empresa_id = NEW.empresa_id AND l.movimiento_id = m.anula_a AND l.renglon_numero = v_original)
           EXCEPT
           (SELECT l.lote_id, -l.cantidad FROM public.renglon_de_lote l
             WHERE l.empresa_id = NEW.empresa_id AND l.movimiento_id = NEW.movimiento_id AND l.renglon_numero = NEW.numero))
         OR EXISTS (
           (SELECT l.lote_id, -l.cantidad FROM public.renglon_de_lote l
             WHERE l.empresa_id = NEW.empresa_id AND l.movimiento_id = NEW.movimiento_id AND l.renglon_numero = NEW.numero)
           EXCEPT
           (SELECT l.lote_id, l.cantidad FROM public.renglon_de_lote l
             WHERE l.empresa_id = NEW.empresa_id AND l.movimiento_id = m.anula_a AND l.renglon_numero = v_original)) THEN
        RAISE EXCEPTION 'la anulación repite los lotes del movimiento original'
          USING ERRCODE = '23514', CONSTRAINT = 'anulacion_no_repite_lotes';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END
$$;

-- Saldo de lote: solo desde un disparador anidado (L2).
CREATE FUNCTION saldo_de_lote_solo_por_movimientos() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'el saldo de lote lo escribe solo el libro de movimientos'
      USING ERRCODE = '42501', CONSTRAINT = 'saldo_de_lote_solo_por_movimientos';
  END IF;
  RETURN NEW;
END
$$;

-- Un lote real nunca baja de cero (L2). Va en un disparador POSTERIOR y no en un CHECK: `INSERT ... ON CONFLICT DO UPDATE` verifica los CHECK
-- sobre la fila propuesta (una salida propone `-3`) antes de resolver el conflicto, y rechazaría salidas válidas.
CREATE FUNCTION saldo_de_lote_no_negativo() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.existencia < 0 AND NOT NEW.es_sin_asignar THEN
    RAISE EXCEPTION 'un lote no puede quedar con existencia negativa (solo el lote sin asignar)'
      USING ERRCODE = '23514', CONSTRAINT = 'saldo_de_lote_no_negativo_ck';
  END IF;
  RETURN NULL;
END
$$;

-- Los lotes cierran con el núcleo (L3), DIFERIDO: para el artículo con control activo, Σ saldo_de_lote = saldo_de_stock por depósito.
CREATE FUNCTION saldo_de_lote_cierra_con_el_nucleo() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_activo boolean;
  v_suma numeric;
  v_saldo numeric;
BEGIN
  SELECT c.activo INTO v_activo FROM public.control_de_lote c WHERE c.empresa_id = NEW.empresa_id AND c.articulo_id = NEW.articulo_id;
  IF NOT FOUND OR NOT v_activo THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(sum(l.existencia), 0) INTO v_suma
    FROM public.saldo_de_lote l WHERE l.empresa_id = NEW.empresa_id AND l.deposito_id = NEW.deposito_id AND l.articulo_id = NEW.articulo_id;
  SELECT coalesce(max(s.existencia), 0) INTO v_saldo
    FROM public.saldo_de_stock s WHERE s.empresa_id = NEW.empresa_id AND s.deposito_id = NEW.deposito_id AND s.articulo_id = NEW.articulo_id;
  IF v_suma <> v_saldo THEN
    RAISE EXCEPTION 'los lotes no suman la existencia del artículo en el depósito'
      USING ERRCODE = '23514', CONSTRAINT = 'saldo_de_lote_no_cierra_con_el_nucleo';
  END IF;
  RETURN NULL;
END
$$;

-- Reasignación (antes de insertar): en un depósito activo y de un artículo con control; el destino de una apertura es el «sin asignar».
CREATE FUNCTION reasignacion_de_lote_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_activo boolean;
  v_destino_sin_asignar boolean;
BEGIN
  SELECT d.activo INTO v_activo
    FROM public.deposito d WHERE d.id = NEW.deposito_id AND d.empresa_id = NEW.empresa_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el depósito de la reasignación no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'reasignacion_de_lote_deposito_fkey';
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'un depósito inactivo no admite reasignaciones'
      USING ERRCODE = '23514', CONSTRAINT = 'reasignacion_deposito_inactivo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.control_de_lote c WHERE c.empresa_id = NEW.empresa_id AND c.articulo_id = NEW.articulo_id) THEN
    RAISE EXCEPTION 'el artículo no lleva control de lote'
      USING ERRCODE = '23514', CONSTRAINT = 'reasignacion_sin_control';
  END IF;
  SELECT l.es_sin_asignar INTO v_destino_sin_asignar
    FROM public.lote l WHERE l.id = NEW.lote_destino_id AND l.empresa_id = NEW.empresa_id;
  IF NEW.lote_origen_id IS NULL AND NOT coalesce(v_destino_sin_asignar, false) THEN
    RAISE EXCEPTION 'la apertura de un control entra al lote sin asignar'
      USING ERRCODE = '23514', CONSTRAINT = 'reasignacion_apertura_a_sin_asignar';
  END IF;
  RETURN NEW;
END
$$;

-- Reasignación (después de insertar): mueve el saldo entre los lotes (L2); el origen no baja de cero por el CHECK del saldo, salvo el
-- «sin asignar».
CREATE FUNCTION reasignacion_de_lote_aplicar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_sin_asignar boolean;
BEGIN
  IF NEW.lote_origen_id IS NOT NULL THEN
    SELECT l.es_sin_asignar INTO v_sin_asignar FROM public.lote l WHERE l.id = NEW.lote_origen_id AND l.empresa_id = NEW.empresa_id;
    INSERT INTO public.saldo_de_lote AS s (empresa_id, deposito_id, articulo_id, lote_id, es_sin_asignar, existencia)
    VALUES (NEW.empresa_id, NEW.deposito_id, NEW.articulo_id, NEW.lote_origen_id, v_sin_asignar, -NEW.cantidad)
    ON CONFLICT (empresa_id, deposito_id, articulo_id, lote_id) DO UPDATE SET existencia = s.existencia + EXCLUDED.existencia;
  END IF;
  SELECT l.es_sin_asignar INTO v_sin_asignar FROM public.lote l WHERE l.id = NEW.lote_destino_id AND l.empresa_id = NEW.empresa_id;
  INSERT INTO public.saldo_de_lote AS s (empresa_id, deposito_id, articulo_id, lote_id, es_sin_asignar, existencia)
  VALUES (NEW.empresa_id, NEW.deposito_id, NEW.articulo_id, NEW.lote_destino_id, v_sin_asignar, NEW.cantidad)
  ON CONFLICT (empresa_id, deposito_id, articulo_id, lote_id) DO UPDATE SET existencia = s.existencia + EXCLUDED.existencia;
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Disparadores: se instalan (`_alta` y `_cambio` antes que `_version`, por orden alfabético)
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER control_de_lote_alta BEFORE INSERT ON control_de_lote
  FOR EACH ROW EXECUTE FUNCTION control_de_lote_validar();
CREATE TRIGGER control_de_lote_cambio BEFORE UPDATE ON control_de_lote
  FOR EACH ROW EXECUTE FUNCTION control_de_lote_validar();
CREATE TRIGGER control_de_lote_version BEFORE UPDATE ON control_de_lote
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE CONSTRAINT TRIGGER control_de_lote_coherente AFTER INSERT OR UPDATE ON control_de_lote
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION control_de_lote_coherente();

CREATE TRIGGER lote_alta BEFORE INSERT ON lote
  FOR EACH ROW EXECUTE FUNCTION lote_validar();
CREATE TRIGGER lote_cambio BEFORE UPDATE ON lote
  FOR EACH ROW EXECUTE FUNCTION lote_validar();
CREATE TRIGGER lote_version BEFORE UPDATE ON lote
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

CREATE TRIGGER calidad_de_lote_alta BEFORE INSERT ON calidad_de_lote
  FOR EACH ROW EXECUTE FUNCTION calidad_de_lote_validar();
CREATE TRIGGER calidad_de_lote_aplicar AFTER INSERT ON calidad_de_lote
  FOR EACH ROW EXECUTE FUNCTION calidad_de_lote_aplicar();

CREATE TRIGGER renglon_de_lote_alta BEFORE INSERT ON renglon_de_lote
  FOR EACH ROW EXECUTE FUNCTION renglon_de_lote_validar();
CREATE TRIGGER renglon_de_lote_aplicar AFTER INSERT ON renglon_de_lote
  FOR EACH ROW EXECUTE FUNCTION renglon_de_lote_aplicar();
CREATE CONSTRAINT TRIGGER renglon_de_movimiento_cubierto_por_lotes AFTER INSERT ON renglon_de_movimiento
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION renglon_cubierto_por_lotes();

CREATE TRIGGER saldo_de_lote_solo_por_movimientos BEFORE INSERT OR UPDATE ON saldo_de_lote
  FOR EACH ROW EXECUTE FUNCTION saldo_de_lote_solo_por_movimientos();
CREATE TRIGGER saldo_de_lote_no_negativo AFTER INSERT OR UPDATE ON saldo_de_lote
  FOR EACH ROW EXECUTE FUNCTION saldo_de_lote_no_negativo();
CREATE CONSTRAINT TRIGGER saldo_de_lote_cierra_con_el_nucleo AFTER INSERT OR UPDATE ON saldo_de_lote
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION saldo_de_lote_cierra_con_el_nucleo();

CREATE TRIGGER reasignacion_de_lote_alta BEFORE INSERT ON reasignacion_de_lote
  FOR EACH ROW EXECUTE FUNCTION reasignacion_de_lote_validar();
CREATE TRIGGER reasignacion_de_lote_aplicar AFTER INSERT ON reasignacion_de_lote
  FOR EACH ROW EXECUTE FUNCTION reasignacion_de_lote_aplicar();

-- Nada se borra ni se vacía (ni el dueño de la base); la historia, los renglones y las reasignaciones además no se modifican.
CREATE TRIGGER control_de_lote_sin_borrado BEFORE DELETE ON control_de_lote
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER control_de_lote_sin_truncate BEFORE TRUNCATE ON control_de_lote
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER lote_sin_borrado BEFORE DELETE ON lote
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER lote_sin_truncate BEFORE TRUNCATE ON lote
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER saldo_de_lote_sin_borrado BEFORE DELETE ON saldo_de_lote
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER saldo_de_lote_sin_truncate BEFORE TRUNCATE ON saldo_de_lote
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER calidad_de_lote_solo_insercion BEFORE UPDATE OR DELETE ON calidad_de_lote
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER calidad_de_lote_sin_truncate BEFORE TRUNCATE ON calidad_de_lote
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER renglon_de_lote_solo_insercion BEFORE UPDATE OR DELETE ON renglon_de_lote
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER renglon_de_lote_sin_truncate BEFORE TRUNCATE ON renglon_de_lote
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER reasignacion_de_lote_solo_insercion BEFORE UPDATE OR DELETE ON reasignacion_de_lote
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER reasignacion_de_lote_sin_truncate BEFORE TRUNCATE ON reasignacion_de_lote
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ---------------------------------------------------------------------------------------------
-- Los motivos de la producción (D95): la salida que consume los ingredientes y la entrada del producto obtenido. El origen del movimiento es
-- `TRANSFORMACION:<orden>` (el patrón del origen ya lo admite); el único de origen impone UNA salida y UNA entrada por orden.
-- ---------------------------------------------------------------------------------------------
INSERT INTO motivo_de_movimiento (clase, codigo, entra_con_costo, entrega_mercaderia) VALUES
  ('ENTRADA', 'PRODUCTO_DE_TRANSFORMACION', true, false),
  ('SALIDA', 'CONSUMO_DE_TRANSFORMACION', false, true);

-- Los motivos de la producción van con el origen de la orden y ese origen solo con ellos (una anulación puede llevar el origen del
-- movimiento que revierte). Ninguna fila anterior los usa: el CHECK se valida sobre datos que no lo contradicen.
ALTER TABLE movimiento_de_stock ADD CONSTRAINT movimiento_de_stock_transformacion_ck
  CHECK ((motivo IN ('PRODUCTO_DE_TRANSFORMACION', 'CONSUMO_DE_TRANSFORMACION'))
         = (clase IN ('ENTRADA', 'SALIDA') AND origen_tipo = 'TRANSFORMACION'));

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE ni TRUNCATE. Solo la aplicación (`pedernal_app`) recibe algo. `lote.calidad` y el saldo se
-- conceden para que los escriban los disparadores (corren con los permisos de quien inserta); las guardas de profundidad rechazan todo lo
-- que no venga de un disparador anidado.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON control_de_lote, lote, calidad_de_lote, renglon_de_lote, saldo_de_lote, reasignacion_de_lote FROM PUBLIC;
GRANT SELECT ON control_de_lote, lote, calidad_de_lote, renglon_de_lote, saldo_de_lote, reasignacion_de_lote TO pedernal_app;

GRANT INSERT (pasos) ON composicion TO pedernal_app;
GRANT INSERT (compuesto_id) ON componente_de_composicion TO pedernal_app;

GRANT INSERT (empresa_id, articulo_id, modo, con_calidad) ON control_de_lote TO pedernal_app;
GRANT UPDATE (modo, con_calidad, activo) ON control_de_lote TO pedernal_app;

GRANT INSERT (id, empresa_id, articulo_id, codigo, referencia_de_origen, fecha_de_elaboracion, fecha_de_vencimiento, es_sin_asignar,
              fecha_de_primer_ingreso, creado_por, creado_en)
  ON lote TO pedernal_app;
GRANT UPDATE (fecha_de_elaboracion, fecha_de_vencimiento, calidad) ON lote TO pedernal_app;

GRANT INSERT (empresa_id, lote_id, estado, motivo, por, en) ON calidad_de_lote TO pedernal_app;
GRANT INSERT (empresa_id, movimiento_id, renglon_numero, lote_id, cantidad) ON renglon_de_lote TO pedernal_app;
GRANT INSERT (empresa_id, deposito_id, articulo_id, lote_id, es_sin_asignar, existencia) ON saldo_de_lote TO pedernal_app;
GRANT UPDATE (existencia) ON saldo_de_lote TO pedernal_app;
GRANT INSERT (id, empresa_id, deposito_id, articulo_id, lote_origen_id, lote_destino_id, cantidad, motivo, clave_idempotencia, por, en)
  ON reasignacion_de_lote TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada en toda tabla nueva; sin política no hay acceso. Siempre con la empresa del contexto; los autores, con la persona
-- del contexto.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE control_de_lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_de_lote FORCE ROW LEVEL SECURITY;
ALTER TABLE lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote FORCE ROW LEVEL SECURITY;
ALTER TABLE calidad_de_lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE calidad_de_lote FORCE ROW LEVEL SECURITY;
ALTER TABLE renglon_de_lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE renglon_de_lote FORCE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_lote FORCE ROW LEVEL SECURITY;
ALTER TABLE reasignacion_de_lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE reasignacion_de_lote FORCE ROW LEVEL SECURITY;

CREATE POLICY control_de_lote_app_leer ON control_de_lote FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY control_de_lote_app_alta ON control_de_lote FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY control_de_lote_app_cambiar ON control_de_lote FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY lote_app_leer ON lote FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY lote_app_alta ON lote FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY lote_app_cambiar ON lote FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY calidad_de_lote_app_leer ON calidad_de_lote FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY calidad_de_lote_app_alta ON calidad_de_lote FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );

CREATE POLICY renglon_de_lote_app_leer ON renglon_de_lote FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY renglon_de_lote_app_alta ON renglon_de_lote FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY saldo_de_lote_app_leer ON saldo_de_lote FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY saldo_de_lote_app_alta ON saldo_de_lote FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY saldo_de_lote_app_cambiar ON saldo_de_lote FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY reasignacion_de_lote_app_leer ON reasignacion_de_lote FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY reasignacion_de_lote_app_alta ON reasignacion_de_lote FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
