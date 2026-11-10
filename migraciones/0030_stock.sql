-- 0030_stock: el stock por depósito (E5 tramo 2): los depósitos de cada sucursal, el artículo de stock (un producto controlado), el libro
-- de movimientos inmutable con sus renglones, el saldo por (depósito, artículo) que solo escribe el libro, el conteo físico y las
-- composiciones (recetas simples) que dicen qué descuenta cada venta. Más la tabla global y sembrada de motivos de movimiento y dos
-- únicas ADITIVAS sobre `producto` (las claves foráneas del artículo y de los componentes apuntan a ellas).
-- Especificación: Pedernal-docs/11-especificaciones/e5-stock-especificacion.md (§3.1, §4 y §5) y decisiones 5, 24, 81, 92, 94, 118, 125, 132,
-- 139, 140 y 175 de catalogo-y-niveles-maqueta.md. NO incluye los costos (`costo_de_articulo`, `costo_de_renglon`): son del tramo TCO y van en
-- su propia migración (E5-T10), así que el promedio no se toca desde acá.
--
-- Reglas de esta migración (las mismas de 0001 a 0028):
--  * Es ADITIVA: crea objetos nuevos y suma dos únicas sobre `producto` (`ADD CONSTRAINT UNIQUE`, sin tocar fila ni columna). Nada se rellena:
--    ninguna empresa tiene stock. Se comprueba al empezar y se frena con un error claro si alguna de estas tablas ya existe.
--  * No agrega NINGUNA función SECURITY DEFINER. Toda función fija `search_path = pg_catalog, public, pg_temp` y califica sus tablas con `public.`.
--    Ninguna función nueva se otorga a la aplicación: son todas de disparador.
--  * Nadie recibe DELETE ni TRUNCATE (decisión 125: nada se borra, se anula con un movimiento espejo). Los disparadores los frenan aun al dueño
--    de la base. INSERT y UPDATE van por columna. RLS activa y FORZADA en toda tabla nueva; una política por comando, ninguna `FOR ALL`. Los
--    demás roles no reciben nada.
--  * Toda única de una tabla con `empresa_id` lo incluye y toda clave foránea entre tablas de empresa es COMPUESTA `(x_id, empresa_id)`.
--  * Cantidades en `numeric(18,4)` exacto (nunca flotantes) con cota en ambos sentidos: `numeric` acepta `NaN`, que es mayor que todo número y
--    pasaría un `>= 0` (la trampa de 0009).
--  * Los textos que escribe una persona (nombre del depósito, detalle, motivo de una cancelación) se validan con la LISTA DE PERMITIDOS del
--    catálogo (`texto_de_catalogo_valido`, 0025); los códigos, las claves y las acciones con patrones que dicen lo que se PERMITE.
--  * Su reversión es un script aparte, revisado y DESTRUCTIVO si hay datos: `migraciones/reversiones/0030_revertir_stock.sql`. El ejecutor no
--    la aplica y frena si alguna tabla tiene filas (salvo confirmación explícita).
--  * DEPENDE de 0001 (`fijar_version_y_fecha`, `solo_insercion`, `empresa_operable`), de 0005 (sucursal), de 0007 (`sin_borrado`, `nivel_de_control`,
--    `hora_de_corte`), de 0025 (producto, unidad de medida, `texto_de_catalogo_valido`) y de 0027 (`fecha_de_negocio`); se comprueba al empezar.
--
-- Decisiones de diseño (todas probadas por `test/integracion/stock-migracion.test.ts`):
--
--  T1. El libro es de SOLO INSERCIÓN: movimiento, renglón, registro de conteo, versión de composición y componente no se editan ni se borran
--      (`solo_insercion()`, aun contra el dueño de la base). Un error se corrige con otro movimiento (la anulación espejo), nunca editando.
--  T2. El saldo es DERIVADO del libro: lo escribe únicamente el disparador de los renglones (`renglon_aplicar`) con un `INSERT ... ON CONFLICT DO
--      UPDATE` atómico, que toma la fila del saldo y serializa a quienes mueven lo mismo. La aplicación recibe INSERT y UPDATE sobre la tabla
--      porque los disparadores corren con sus permisos, pero `saldo_solo_por_movimientos` rechaza toda escritura que no venga de un disparador
--      anidado (`pg_trigger_depth() >= 2`): ni el código de la aplicación puede tocar un saldo.
--  T3. Un renglón solo entra en la MISMA transacción que su movimiento (`registrado_en = now()`, que es el instante de la transacción aun dentro
--      de un SAVEPOINT): un movimiento confirmado no gana renglones después. Igual con los componentes de una versión de composición
--      (`registrada_en`).
--  T4. `fecha_negocio` la fija LA BASE con la misma fórmula que caja y ventas (`fecha_de_negocio`, 0027: instante en la zona de la empresa menos
--      la hora de corte de la sucursal del depósito del acto). Única excepción: la salida por venta (`motivo = 'VENTA'`) trae la del ticket, que
--      fija ventas, y se conserva tal cual. Queda sellada: cambiar la zona o el corte después no reescribe el pasado.
--  T5. El control de existencia negativa (`stock.existencia_negativa`) se lee de `nivel_de_control` (sin fila: PERMITIR; la sucursal puede
--      endurecer el de la empresa, no aflojarlo). Solo mira la SALIDA y la pata de origen de la TRANSFERENCIA: un ajuste, un conteo o una
--      anulación nunca se bloquean (si no, un conteo que encuentra menos no se podría aplicar y una venta no se podría anular).
--  T6. La coherencia de un movimiento (tiene renglones, signos por clase, la transferencia suma cero entre dos depósitos distintos, la anulación
--      es el espejo exacto del original) se verifica DIFERIDA, al confirmar: el movimiento se arma de a un renglón y recién al final cuadra.
--  T7. Cuarentena y rechazo solo reciben y entregan por transferencia, ajuste (también el de un conteo) o anulación: no por venta, entrada ni
--      salida. Un depósito inactivo no admite ningún movimiento ni conteo. Un artículo inactivo no admite movimientos, salvo la anulación de uno
--      anterior (si no, una venta no se podría anular después de dejar de controlar el artículo).

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.sucursal') IS NULL OR to_regclass('public.persona') IS NULL OR to_regclass('public.empresa') IS NULL
     OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL OR to_regprocedure('public.solo_insercion()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL OR to_regprocedure('public.app_persona_id()') IS NULL
     OR to_regprocedure('public.app_empresa_id()') IS NULL THEN
    RAISE EXCEPTION 'stock requiere 0001 (sucursal, persona, funciones de contexto y de solo inserción) aplicada antes'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.sin_borrado()') IS NULL OR to_regclass('public.nivel_de_control') IS NULL THEN
    RAISE EXCEPTION 'stock requiere 0007_marcas_y_planes aplicada antes (falta sin_borrado() o nivel_de_control)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.producto') IS NULL OR to_regclass('public.unidad_de_medida') IS NULL
     OR to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'stock requiere 0025_catalogo aplicada antes (faltan producto, unidad_de_medida o texto_de_catalogo_valido)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.fecha_de_negocio(timestamptz, text, time)') IS NULL THEN
    RAISE EXCEPTION 'stock requiere 0027_caja aplicada antes (falta fecha_de_negocio, la fórmula única de la jornada)'
      USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['deposito', 'articulo_de_stock', 'motivo_de_movimiento', 'movimiento_de_stock', 'renglon_de_movimiento',
                                 'saldo_de_stock', 'conteo_fisico', 'conteo_registro', 'composicion', 'componente_de_composicion'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'stock nace en 0030: la tabla % ya existe (alguien la creó a mano); hay que revisarla antes de migrar', v_tabla
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Las dos únicas aditivas sobre `producto`: destino de las claves foráneas que fijan que la unidad de stock ES la base del producto y que la
-- dimensión de un componente es la del artículo (E2 las tenía pedidas, e2-catalogo-minimo-especificacion.md:428). No cambian ninguna fila.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE producto ADD CONSTRAINT producto_id_unidad_base_empresa_uk UNIQUE (id, unidad_base_id, empresa_id);
ALTER TABLE producto ADD CONSTRAINT producto_id_dimension_empresa_uk UNIQUE (id, dimension, empresa_id);

-- ---------------------------------------------------------------------------------------------
-- Depósito: de una sucursal. uso NORMAL (se vende y se cuenta como disponible), CUARENTENA o RECHAZO (no suman a lo disponible ni se venden).
-- A lo sumo UNO «de venta» por sucursal. Sin emisor exclusivo (supuesto S-5 de la especificación).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE deposito (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la idempotencia del alta
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  sucursal_id    uuid NOT NULL,
  nombre         text NOT NULL CONSTRAINT deposito_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 80)),
  nombre_clave   text NOT NULL CONSTRAINT deposito_nombre_clave_ck CHECK (char_length(nombre_clave) BETWEEN 1 AND 240),
  uso            text NOT NULL CONSTRAINT deposito_uso_ck CHECK (uso IN ('NORMAL', 'CUARENTENA', 'RECHAZO')),
  de_venta       boolean NOT NULL DEFAULT false,
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT deposito_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT deposito_nombre_uk UNIQUE (empresa_id, sucursal_id, nombre_clave),
  CONSTRAINT deposito_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  -- El de venta está activo y es de uso normal (lo vendible no sale de cuarentena ni de rechazo).
  CONSTRAINT deposito_de_venta_ck CHECK (NOT de_venta OR (activo AND uso = 'NORMAL'))
);
-- Uno solo «de venta» por sucursal.
CREATE UNIQUE INDEX deposito_de_venta_uk ON deposito (empresa_id, sucursal_id) WHERE de_venta;
CREATE INDEX deposito_sucursal_ix ON deposito (empresa_id, sucursal_id);

-- ---------------------------------------------------------------------------------------------
-- Artículo de stock: un producto controlado, con la unidad base del producto (una sola unidad de stock, un solo pool por artículo). La unidad
-- y la dimensión las fijan dos claves foráneas contra `producto` y `unidad_de_medida`.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE articulo_de_stock (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la idempotencia del alta
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  producto_id        uuid NOT NULL,
  unidad_de_stock_id text NOT NULL,
  dimension          text NOT NULL,
  activo             boolean NOT NULL DEFAULT true,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT articulo_de_stock_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT articulo_de_stock_id_dimension_uk UNIQUE (id, dimension, empresa_id),   -- destino del componente: la misma dimensión
  CONSTRAINT articulo_de_stock_producto_uk UNIQUE (empresa_id, producto_id),
  -- La unidad de stock ES la unidad base del producto (que no cambia nunca) y la dimensión es la del producto.
  CONSTRAINT articulo_de_stock_producto_unidad_fkey FOREIGN KEY (producto_id, unidad_de_stock_id, empresa_id)
    REFERENCES producto (id, unidad_base_id, empresa_id),
  CONSTRAINT articulo_de_stock_producto_dimension_fkey FOREIGN KEY (producto_id, dimension, empresa_id)
    REFERENCES producto (id, dimension, empresa_id),
  CONSTRAINT articulo_de_stock_unidad_fkey FOREIGN KEY (unidad_de_stock_id, dimension) REFERENCES unidad_de_medida (id, dimension)
);

-- ---------------------------------------------------------------------------------------------
-- Motivos de movimiento: global, sembrada, solo inserción (como `unidad_de_medida`). La CLASE es cerrada (la entiende el núcleo: signos,
-- espejo, transferencia) y el MOTIVO es abierto: lo que sume E9 (devolución a proveedor...) es un INSERT más en su migración. Una prueba
-- compara esta tabla con `MOTIVOS_DE_MOVIMIENTO` de `src/modulos/stock/dominio/motivos.ts`.
--   entra_con_costo     = quien registra la entrada declara su costo (o que no lo tiene): compra y carga inicial. Solo en entradas.
--   entrega_mercaderia  = la salida entrega mercadería a un uso (venta, consumo interno); descartarla (merma, rotura, vencimiento) no.
--                         Solo en salidas.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE motivo_de_movimiento (
  clase              text NOT NULL CONSTRAINT motivo_clase_ck
                     CHECK (clase IN ('ENTRADA', 'SALIDA', 'TRANSFERENCIA', 'AJUSTE', 'AJUSTE_POR_CONTEO', 'ANULACION')),
  codigo             text NOT NULL CONSTRAINT motivo_codigo_ck CHECK (codigo ~ '^[A-Z][A-Z_]{1,39}$'),
  entra_con_costo    boolean NOT NULL DEFAULT false,
  entrega_mercaderia boolean NOT NULL DEFAULT false,
  CONSTRAINT motivo_de_movimiento_pkey PRIMARY KEY (clase, codigo),
  CONSTRAINT motivo_con_costo_ck CHECK (NOT entra_con_costo OR clase = 'ENTRADA'),
  CONSTRAINT motivo_entrega_ck CHECK (NOT entrega_mercaderia OR clase = 'SALIDA')
);
INSERT INTO motivo_de_movimiento (clase, codigo, entra_con_costo, entrega_mercaderia) VALUES
  ('ENTRADA', 'COMPRA', true, false),
  ('ENTRADA', 'CARGA_INICIAL', true, false),
  ('ENTRADA', 'DEVOLUCION_DE_CLIENTE', false, false),
  ('ENTRADA', 'OTRA_ENTRADA', false, false),
  ('SALIDA', 'VENTA', false, true),
  ('SALIDA', 'CONSUMO_INTERNO', false, true),
  ('SALIDA', 'MERMA', false, false),
  ('SALIDA', 'ROTURA', false, false),
  ('SALIDA', 'VENCIMIENTO', false, false),
  ('SALIDA', 'OTRA_SALIDA', false, false),
  ('TRANSFERENCIA', 'TRANSFERENCIA', false, false),
  ('AJUSTE', 'CORRECCION', false, false),
  ('AJUSTE_POR_CONTEO', 'CONTEO', false, false),
  ('ANULACION', 'ANULACION', false, false);

-- ---------------------------------------------------------------------------------------------
-- Conteo físico: de un depósito, a ciegas. ABIERTO → APLICADO | CANCELADO. Un solo ABIERTO por depósito.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE conteo_fisico (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la idempotencia de abrirlo
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  deposito_id    uuid NOT NULL,
  estado         text NOT NULL DEFAULT 'ABIERTO' CONSTRAINT conteo_fisico_estado_ck CHECK (estado IN ('ABIERTO', 'APLICADO', 'CANCELADO')),
  abierto_por    uuid NOT NULL REFERENCES persona (id),
  abierto_en     timestamptz NOT NULL,                          -- `ahora` del contexto
  resuelto_por   uuid REFERENCES persona (id),
  resuelto_en    timestamptz,
  motivo         text CONSTRAINT conteo_fisico_motivo_ck CHECK (motivo IS NULL OR texto_de_catalogo_valido(motivo, 300)),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT conteo_fisico_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT conteo_fisico_deposito_fkey FOREIGN KEY (deposito_id, empresa_id) REFERENCES deposito (id, empresa_id),
  -- Abierto = sin resolver; aplicado o cancelado = con quién y cuándo; el motivo es de la cancelación y solo de ella.
  CONSTRAINT conteo_fisico_resolucion_ck CHECK ((estado = 'ABIERTO') = (resuelto_por IS NULL AND resuelto_en IS NULL)),
  CONSTRAINT conteo_fisico_cancelacion_ck CHECK ((estado = 'CANCELADO') = (motivo IS NOT NULL))
);
-- Un solo conteo abierto por depósito (dos `abrirConteo` simultáneos: gana uno).
CREATE UNIQUE INDEX conteo_fisico_abierto_uk ON conteo_fisico (empresa_id, deposito_id) WHERE estado = 'ABIERTO';
CREATE INDEX conteo_fisico_deposito_ix ON conteo_fisico (empresa_id, deposito_id, estado);

-- ---------------------------------------------------------------------------------------------
-- Libro de movimientos (cabecera): solo inserción. `deposito_id` es el del acto (el de origen en una transferencia). `registrado_en` y
-- `fecha_negocio` los fija la base (T3 y T4). El saldo se deriva de los renglones.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE movimiento_de_stock (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  clase              text NOT NULL,
  motivo             text NOT NULL,
  detalle            text CONSTRAINT movimiento_de_stock_detalle_ck CHECK (detalle IS NULL OR texto_de_catalogo_valido(detalle, 300)),
  origen_tipo        text NOT NULL DEFAULT 'MANUAL' CONSTRAINT movimiento_de_stock_origen_tipo_ck CHECK (origen_tipo ~ '^[A-Z][A-Z_]{1,39}$'),
  origen_id          uuid,
  deposito_id        uuid NOT NULL,
  accion             text NOT NULL CONSTRAINT movimiento_de_stock_accion_ck
                     CHECK (accion ~ '^[a-z][a-z_]{0,39}\.[a-z][a-z_]{0,39}$'),    -- la autorización que lo causó (`stock.registrar_entrada`...)
  anula_a            uuid,
  conteo_id          uuid,
  clave_idempotencia text NOT NULL CONSTRAINT movimiento_de_stock_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{8,200}$'),
  huella             text NOT NULL CONSTRAINT movimiento_de_stock_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  hecho_en           timestamptz NOT NULL CONSTRAINT movimiento_de_stock_hecho_en_ck
                     CHECK (hecho_en >= timestamptz '2000-01-01 00:00:00+00' AND hecho_en < timestamptz '2200-01-01 00:00:00+00'),
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  fecha_negocio      date NOT NULL CONSTRAINT movimiento_de_stock_fecha_ck CHECK (fecha_negocio BETWEEN date '2000-01-01' AND date '2200-12-31'),
  registrado_por     uuid NOT NULL REFERENCES persona (id),
  CONSTRAINT movimiento_de_stock_id_empresa_uk UNIQUE (id, empresa_id),
  -- La misma clave en dos empresas son dos movimientos; en una empresa, uno solo.
  CONSTRAINT movimiento_de_stock_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  -- Una anulación por movimiento y un ajuste por conteo.
  CONSTRAINT movimiento_de_stock_anula_a_uk UNIQUE (empresa_id, anula_a),
  CONSTRAINT movimiento_de_stock_conteo_uk UNIQUE (empresa_id, conteo_id),
  CONSTRAINT movimiento_de_stock_motivo_fkey FOREIGN KEY (clase, motivo) REFERENCES motivo_de_movimiento (clase, codigo),
  CONSTRAINT movimiento_de_stock_deposito_fkey FOREIGN KEY (deposito_id, empresa_id) REFERENCES deposito (id, empresa_id),
  CONSTRAINT movimiento_de_stock_anula_a_fkey FOREIGN KEY (anula_a, empresa_id) REFERENCES movimiento_de_stock (id, empresa_id),
  CONSTRAINT movimiento_de_stock_conteo_fkey FOREIGN KEY (conteo_id, empresa_id) REFERENCES conteo_fisico (id, empresa_id),
  -- Lo manual no tiene identificador de origen; lo que viene de otro módulo, sí.
  CONSTRAINT movimiento_de_stock_origen_ck CHECK ((origen_tipo = 'MANUAL') = (origen_id IS NULL)),
  -- `VENTA` es la salida por el puerto de ventas, con el ejemplar del ticket como origen, y solo ella.
  CONSTRAINT movimiento_de_stock_venta_ck CHECK ((motivo = 'VENTA') = (clase = 'SALIDA' AND origen_tipo = 'EJEMPLAR_DE_TICKET')),
  -- Corregir y anular siempre dicen por qué.
  CONSTRAINT movimiento_de_stock_detalle_requerido_ck CHECK (clase NOT IN ('AJUSTE', 'ANULACION') OR detalle IS NOT NULL),
  CONSTRAINT movimiento_de_stock_anulacion_ck CHECK ((clase = 'ANULACION') = (anula_a IS NOT NULL) AND anula_a IS DISTINCT FROM id),
  CONSTRAINT movimiento_de_stock_ajuste_por_conteo_ck CHECK ((clase = 'AJUSTE_POR_CONTEO') = (conteo_id IS NOT NULL))
);
-- Una salida por ejemplar y una entrada por recepción, aunque cambie la clave de idempotencia (identidad por origen).
CREATE UNIQUE INDEX movimiento_de_stock_origen_uk ON movimiento_de_stock (empresa_id, clase, origen_tipo, origen_id)
  WHERE origen_tipo <> 'MANUAL' AND clase IN ('ENTRADA', 'SALIDA');
CREATE INDEX movimiento_de_stock_origen_ix ON movimiento_de_stock (empresa_id, origen_tipo, origen_id) WHERE origen_tipo <> 'MANUAL';
CREATE INDEX movimiento_de_stock_deposito_ix ON movimiento_de_stock (empresa_id, deposito_id, hecho_en DESC);

-- ---------------------------------------------------------------------------------------------
-- Composición (receta simple de un producto vendible): versión de solo inserción; vale la de mayor `numero`; una versión VACÍA la retira.
-- Sin `opcion_id` ni `variante_id`: lo que consume una opción es `consumo_de_opcion` (0025, decisión 139). `registrada_en` es el instante de
-- la transacción (T3): los componentes solo entran con su versión.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE composicion (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa (id),
  producto_id   uuid NOT NULL,
  numero        integer NOT NULL CONSTRAINT composicion_numero_ck CHECK (numero > 0),
  rinde         numeric(18,4) NOT NULL CONSTRAINT composicion_rinde_ck CHECK (rinde > 0 AND rinde < 100000000000000),
  creada_por    uuid NOT NULL REFERENCES persona (id),
  creada_en     timestamptz NOT NULL,                    -- `ahora` del contexto
  registrada_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT composicion_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT composicion_numero_uk UNIQUE (empresa_id, producto_id, numero),
  CONSTRAINT composicion_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id)
);

-- El componente descuenta un artículo, en una unidad de SU dimensión. `perdida` (en puntos) y `compuesto_id` (subcomposición) existen para
-- E6 sin migrar la tabla; hasta entonces la base rechaza el compuesto (nace cerrado) y la aplicación rechaza la pérdida con la perilla.
CREATE TABLE componente_de_composicion (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  composicion_id uuid NOT NULL,
  numero         smallint NOT NULL CONSTRAINT componente_numero_ck CHECK (numero > 0),
  articulo_id    uuid,
  compuesto_id   uuid,
  cantidad       numeric(18,4) NOT NULL CONSTRAINT componente_cantidad_ck CHECK (cantidad > 0 AND cantidad < 100000000000000),
  unidad_id      text NOT NULL,
  dimension      text NOT NULL,
  perdida        numeric(7,4) NOT NULL DEFAULT 0 CONSTRAINT componente_perdida_ck CHECK (perdida >= 0 AND perdida < 100),
  CONSTRAINT componente_de_composicion_pkey PRIMARY KEY (empresa_id, composicion_id, numero),
  CONSTRAINT componente_articulo_uk UNIQUE (empresa_id, composicion_id, articulo_id),
  CONSTRAINT componente_composicion_fkey FOREIGN KEY (composicion_id, empresa_id) REFERENCES composicion (id, empresa_id),
  -- La unidad es de la misma dimensión que el artículo (o que el compuesto): no se descuenta un jugo «por metro».
  CONSTRAINT componente_articulo_fkey FOREIGN KEY (articulo_id, dimension, empresa_id) REFERENCES articulo_de_stock (id, dimension, empresa_id),
  CONSTRAINT componente_compuesto_fkey FOREIGN KEY (compuesto_id, dimension, empresa_id) REFERENCES producto (id, dimension, empresa_id),
  CONSTRAINT componente_unidad_fkey FOREIGN KEY (unidad_id, dimension) REFERENCES unidad_de_medida (id, dimension),
  CONSTRAINT componente_destino_ck CHECK (num_nonnulls(articulo_id, compuesto_id) = 1),
  CONSTRAINT componente_compuesto_cerrado_ck CHECK (compuesto_id IS NULL)   -- E6 lo abre (con la prohibición de ciclos)
);

-- ---------------------------------------------------------------------------------------------
-- Renglón del libro: cantidad CON SIGNO en la unidad de stock del artículo. `hecho_en` y `fecha_negocio` son copias de la cabecera.
-- `composicion_id` es la versión de composición de la que salió lo descontado (para explicar una venta). Un renglón por (depósito,
-- artículo, composición) dentro de un movimiento. Sin la dimensión RESERVADO (T11 de la especificación la suma después).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE renglon_de_movimiento (
  empresa_id       uuid NOT NULL REFERENCES empresa (id),
  movimiento_id    uuid NOT NULL,
  numero           integer NOT NULL CONSTRAINT renglon_numero_ck CHECK (numero > 0 AND numero < 10000),
  deposito_id      uuid NOT NULL,
  articulo_id      uuid NOT NULL,
  cantidad         numeric(18,4) NOT NULL CONSTRAINT renglon_cantidad_ck
                   CHECK (cantidad <> 0 AND cantidad > -100000000000000 AND cantidad < 100000000000000),
  composicion_id   uuid,
  confirmo_negativo boolean NOT NULL DEFAULT false,
  hecho_en         timestamptz NOT NULL,
  fecha_negocio    date NOT NULL,
  CONSTRAINT renglon_de_movimiento_pkey PRIMARY KEY (empresa_id, movimiento_id, numero),
  CONSTRAINT renglon_de_movimiento_unico_uk UNIQUE NULLS NOT DISTINCT (empresa_id, movimiento_id, deposito_id, articulo_id, composicion_id),
  CONSTRAINT renglon_de_movimiento_movimiento_fkey FOREIGN KEY (movimiento_id, empresa_id) REFERENCES movimiento_de_stock (id, empresa_id),
  CONSTRAINT renglon_de_movimiento_deposito_fkey FOREIGN KEY (deposito_id, empresa_id) REFERENCES deposito (id, empresa_id),
  CONSTRAINT renglon_de_movimiento_articulo_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulo_de_stock (id, empresa_id),
  CONSTRAINT renglon_de_movimiento_composicion_fkey FOREIGN KEY (composicion_id, empresa_id) REFERENCES composicion (id, empresa_id)
);
CREATE INDEX renglon_de_movimiento_libro_ix ON renglon_de_movimiento (empresa_id, articulo_id, deposito_id, fecha_negocio, hecho_en);

-- ---------------------------------------------------------------------------------------------
-- Saldo: la existencia por (depósito, artículo). PUEDE ser negativa: es un control (`stock.existencia_negativa`), no una invariante. Solo la
-- escribe el disparador de los renglones (T2).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE saldo_de_stock (
  empresa_id  uuid NOT NULL REFERENCES empresa (id),
  deposito_id uuid NOT NULL,
  articulo_id uuid NOT NULL,
  existencia  numeric(18,4) NOT NULL CONSTRAINT saldo_de_stock_existencia_ck
              CHECK (existencia > -100000000000000 AND existencia < 100000000000000),
  CONSTRAINT saldo_de_stock_pkey PRIMARY KEY (empresa_id, deposito_id, articulo_id),
  CONSTRAINT saldo_de_stock_deposito_fkey FOREIGN KEY (deposito_id, empresa_id) REFERENCES deposito (id, empresa_id),
  CONSTRAINT saldo_de_stock_articulo_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulo_de_stock (id, empresa_id)
);
CREATE INDEX saldo_de_stock_articulo_ix ON saldo_de_stock (empresa_id, articulo_id);
CREATE INDEX saldo_de_stock_negativo_ix ON saldo_de_stock (empresa_id, deposito_id) WHERE existencia < 0;

-- Registro de conteo: solo inserción. Vale el último por artículo (`orden`); recontar es un registro nuevo. `existencia_al_registrar` es la
-- existencia del depósito en ese momento y la fija la base: el ajuste usa `contada − existencia_al_registrar`.
CREATE TABLE conteo_registro (
  id                      uuid NOT NULL,                    -- lo manda la app: es la idempotencia del registro
  empresa_id              uuid NOT NULL REFERENCES empresa (id),
  conteo_id               uuid NOT NULL,
  articulo_id             uuid NOT NULL,
  cantidad_contada        numeric(18,4) NOT NULL CONSTRAINT conteo_registro_cantidad_ck CHECK (cantidad_contada >= 0 AND cantidad_contada < 100000000000000),
  existencia_al_registrar numeric(18,4) NOT NULL CONSTRAINT conteo_registro_existencia_ck
                          CHECK (existencia_al_registrar > -100000000000000 AND existencia_al_registrar < 100000000000000),
  registrado_por          uuid NOT NULL REFERENCES persona (id),
  registrado_en           timestamptz NOT NULL,             -- `ahora` del contexto
  orden                   bigint GENERATED ALWAYS AS IDENTITY,
  CONSTRAINT conteo_registro_pkey PRIMARY KEY (empresa_id, id),
  CONSTRAINT conteo_registro_conteo_fkey FOREIGN KEY (conteo_id, empresa_id) REFERENCES conteo_fisico (id, empresa_id),
  CONSTRAINT conteo_registro_articulo_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulo_de_stock (id, empresa_id)
);
CREATE INDEX conteo_registro_ultimo_ix ON conteo_registro (empresa_id, conteo_id, articulo_id, orden DESC);

-- ---------------------------------------------------------------------------------------------
-- Disparadores: invariantes que la base impone aunque el código se olvide. Los nombres se eligen para que `_alta` y `_cambio` corran antes
-- que `_version` (los BEFORE de un mismo evento corren en orden alfabético).
-- ---------------------------------------------------------------------------------------------

-- Depósito: lo que no cambia (empresa, sucursal, uso), y no se desactiva con existencia ni con un conteo abierto. Quien mueve o cuenta en un
-- depósito lo lee con FOR SHARE: desactivarlo a la vez espera a ese movimiento (o ve la existencia ya confirmada y lo rechaza).
CREATE FUNCTION deposito_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id THEN
      RAISE EXCEPTION 'la empresa y la sucursal de un depósito no cambian'
        USING ERRCODE = '23514', CONSTRAINT = 'deposito_identidad_inmutable';
    END IF;
    IF NEW.uso IS DISTINCT FROM OLD.uso THEN
      RAISE EXCEPTION 'el uso de un depósito no cambia después del alta'
        USING ERRCODE = '23514', CONSTRAINT = 'deposito_uso_inmutable';
    END IF;
    IF OLD.activo AND NOT NEW.activo THEN
      IF EXISTS (SELECT 1 FROM public.saldo_de_stock s
                  WHERE s.empresa_id = OLD.empresa_id AND s.deposito_id = OLD.id AND s.existencia <> 0) THEN
        RAISE EXCEPTION 'un depósito con existencia no se desactiva'
          USING ERRCODE = '23514', CONSTRAINT = 'deposito_con_existencia';
      END IF;
      IF EXISTS (SELECT 1 FROM public.conteo_fisico c
                  WHERE c.empresa_id = OLD.empresa_id AND c.deposito_id = OLD.id AND c.estado = 'ABIERTO') THEN
        RAISE EXCEPTION 'un depósito con un conteo abierto no se desactiva'
          USING ERRCODE = '23514', CONSTRAINT = 'deposito_con_conteo_abierto';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Artículo: lo que no cambia (producto, unidad, dimensión), solo de las clases que se controlan (S-6: materia prima, insumo y reventa) y no se
-- deja de controlar si lo usa la composición vigente de algún producto (S-10). Un componente nuevo lo lee con FOR SHARE: o espera a quien lo
-- desactiva o este ve el componente ya confirmado.
CREATE FUNCTION articulo_de_stock_validar() RETURNS trigger LANGUAGE plpgsql
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
  IF v_clase IS NOT NULL AND v_clase NOT IN ('MATERIA_PRIMA', 'INSUMO', 'REVENTA') THEN
    RAISE EXCEPTION 'solo la materia prima, los insumos y la reventa se controlan en stock'
      USING ERRCODE = '23514', CONSTRAINT = 'articulo_de_stock_clase_no_controlable';
  END IF;
  RETURN NEW;
END
$$;

-- Composición: de un producto VENDIBLE (S-6) y con el número siguiente al último (así «vale la de mayor número» está bien definido y dos
-- versiones simultáneas chocan en la única `composicion_numero_uk`). `registrada_en` es el instante de la transacción.
CREATE FUNCTION composicion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_anterior integer;
BEGIN
  NEW.registrada_en := now();
  SELECT p.clase_de_uso INTO v_clase FROM public.producto p WHERE p.id = NEW.producto_id AND p.empresa_id = NEW.empresa_id;
  IF v_clase IS NOT NULL AND v_clase <> 'VENDIBLE' THEN
    RAISE EXCEPTION 'solo un producto vendible tiene composición'
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

-- Componente: solo entra con su versión (T3) y con un artículo activo (FOR SHARE: ver `articulo_de_stock_validar`).
CREATE FUNCTION componente_de_composicion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_de_esta_transaccion boolean;
  v_activo boolean;
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
  END IF;
  RETURN NEW;
END
$$;

-- Conteo: nace ABIERTO, en un depósito activo (FOR SHARE: no se desactiva a la vez); pasa a APLICADO o CANCELADO una sola vez y no se aplica
-- vacío (decisión 132). Lo demás no cambia.
CREATE FUNCTION conteo_fisico_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_activo boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'ABIERTO' THEN
      RAISE EXCEPTION 'un conteo nace abierto'
        USING ERRCODE = '23514', CONSTRAINT = 'conteo_fisico_nace_abierto';
    END IF;
    SELECT d.activo INTO v_activo
      FROM public.deposito d WHERE d.id = NEW.deposito_id AND d.empresa_id = NEW.empresa_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'el depósito del conteo no existe'
        USING ERRCODE = '23503', CONSTRAINT = 'conteo_fisico_deposito_fkey';
    END IF;
    IF NOT v_activo THEN
      RAISE EXCEPTION 'no se abre un conteo en un depósito inactivo'
        USING ERRCODE = '23514', CONSTRAINT = 'conteo_fisico_deposito_inactivo';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.deposito_id IS DISTINCT FROM OLD.deposito_id
     OR NEW.abierto_por IS DISTINCT FROM OLD.abierto_por OR NEW.abierto_en IS DISTINCT FROM OLD.abierto_en THEN
    RAISE EXCEPTION 'el depósito y quién abrió un conteo no cambian'
      USING ERRCODE = '23514', CONSTRAINT = 'conteo_fisico_inmutable';
  END IF;
  IF OLD.estado <> 'ABIERTO' OR NEW.estado NOT IN ('APLICADO', 'CANCELADO') THEN
    RAISE EXCEPTION 'un conteo abierto pasa a aplicado o cancelado, y después no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'conteo_fisico_transicion_invalida';
  END IF;
  IF NEW.estado = 'APLICADO' AND NOT EXISTS (
       SELECT 1 FROM public.conteo_registro r WHERE r.empresa_id = NEW.empresa_id AND r.conteo_id = NEW.id) THEN
    RAISE EXCEPTION 'un conteo sin registros no se aplica'
      USING ERRCODE = '23514', CONSTRAINT = 'conteo_fisico_sin_registros';
  END IF;
  RETURN NEW;
END
$$;

-- Registro de conteo: solo en un conteo ABIERTO (FOR SHARE: aplicarlo o cancelarlo a la vez espera a este registro, o este ve el conteo ya
-- cerrado) y de un artículo activo; fija la existencia del depósito en ese momento (0 si nunca tuvo saldo).
CREATE FUNCTION conteo_registro_preparar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_conteo record;
  v_activo boolean;
BEGIN
  SELECT c.estado, c.deposito_id INTO v_conteo
    FROM public.conteo_fisico c WHERE c.id = NEW.conteo_id AND c.empresa_id = NEW.empresa_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el conteo no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'conteo_registro_conteo_fkey';
  END IF;
  IF v_conteo.estado <> 'ABIERTO' THEN
    RAISE EXCEPTION 'el conteo no está abierto'
      USING ERRCODE = '23514', CONSTRAINT = 'conteo_registro_conteo_cerrado';
  END IF;
  SELECT a.activo INTO v_activo FROM public.articulo_de_stock a WHERE a.id = NEW.articulo_id AND a.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el artículo del registro no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'conteo_registro_articulo_fkey';
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'el artículo no está activo'
      USING ERRCODE = '23514', CONSTRAINT = 'conteo_registro_articulo_inactivo';
  END IF;
  SELECT coalesce((SELECT s.existencia FROM public.saldo_de_stock s
                    WHERE s.empresa_id = NEW.empresa_id AND s.deposito_id = v_conteo.deposito_id AND s.articulo_id = NEW.articulo_id), 0)
    INTO NEW.existencia_al_registrar;
  RETURN NEW;
END
$$;

-- Cabecera del movimiento (antes de insertar). Fija `registrado_en` (el instante de la transacción) y `fecha_negocio` (T4); falla cerrado si el
-- depósito no existe o está inactivo (lo lee con FOR SHARE: desactivarlo a la vez espera a este movimiento, o este ve el depósito ya
-- inactivo); la anulación no apunta a una anulación ni a un ajuste por conteo; el ajuste por conteo es del depósito del conteo.
CREATE FUNCTION movimiento_de_stock_preparar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_deposito record;
  v_zona text;
  v_corte time;
  v_original text;
  v_deposito_del_conteo uuid;
BEGIN
  NEW.registrado_en := now();
  SELECT d.sucursal_id, d.activo INTO v_deposito
    FROM public.deposito d WHERE d.id = NEW.deposito_id AND d.empresa_id = NEW.empresa_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el depósito del movimiento no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'movimiento_de_stock_deposito_fkey';
  END IF;
  IF NOT v_deposito.activo THEN
    RAISE EXCEPTION 'un depósito inactivo no admite movimientos'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_deposito_inactivo';
  END IF;

  -- La fecha de negocio: por reloj, salvo la salida por venta, que trae la del ticket (la fija ventas) y se conserva tal cual.
  IF NEW.clase = 'SALIDA' AND NEW.motivo = 'VENTA' THEN
    IF NEW.fecha_negocio IS NULL THEN
      RAISE EXCEPTION 'la salida por venta trae la fecha de negocio del ticket'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_venta_sin_fecha_de_negocio';
    END IF;
  ELSE
    IF NEW.fecha_negocio IS NOT NULL THEN
      RAISE EXCEPTION 'la fecha de negocio de un movimiento la fija la base (solo la salida por venta trae la del ticket)'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_fecha_de_negocio_no_admitida';
    END IF;
    SELECT e.zona_horaria, s.hora_de_corte INTO v_zona, v_corte
      FROM public.sucursal s JOIN public.empresa e ON e.id = s.empresa_id
     WHERE s.id = v_deposito.sucursal_id AND s.empresa_id = NEW.empresa_id;
    IF v_zona IS NULL THEN
      RAISE EXCEPTION 'no se pudo fechar el movimiento: sucursal desconocida'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_fecha_de_negocio_invalida';
    END IF;
    NEW.fecha_negocio := public.fecha_de_negocio(NEW.hecho_en, v_zona, v_corte);
  END IF;

  IF NEW.clase = 'ANULACION' THEN
    SELECT m.clase INTO v_original FROM public.movimiento_de_stock m WHERE m.id = NEW.anula_a AND m.empresa_id = NEW.empresa_id;
    IF v_original IN ('ANULACION', 'AJUSTE_POR_CONTEO') THEN
      RAISE EXCEPTION 'una anulación y un ajuste por conteo no se anulan'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_no_anulable';
    END IF;
  ELSIF NEW.clase = 'AJUSTE_POR_CONTEO' THEN
    SELECT c.deposito_id INTO v_deposito_del_conteo FROM public.conteo_fisico c WHERE c.id = NEW.conteo_id AND c.empresa_id = NEW.empresa_id;
    IF v_deposito_del_conteo IS NOT NULL AND v_deposito_del_conteo <> NEW.deposito_id THEN
      RAISE EXCEPTION 'el ajuste por conteo es del depósito del conteo'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_conteo_de_otro_deposito';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Renglón (antes de insertar): solo con su movimiento en esta transacción (T3); el depósito del renglón es el del acto, salvo la pata de destino
-- de una transferencia y las patas de la anulación de una (que cuadra después); cuarentena y rechazo no admiten venta, entrada ni salida (T7); el
-- artículo está activo (salvo en una anulación, T7). Copia `hecho_en` y `fecha_negocio` de la cabecera.
CREATE FUNCTION renglon_de_movimiento_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  m record;
  v_deposito record;
  v_activo boolean;
BEGIN
  SELECT x.clase, x.deposito_id, x.hecho_en, x.fecha_negocio, x.registrado_en = now() AS de_esta_transaccion INTO m
    FROM public.movimiento_de_stock x WHERE x.id = NEW.movimiento_id AND x.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el movimiento del renglón no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'renglon_de_movimiento_movimiento_fkey';
  END IF;
  IF NOT m.de_esta_transaccion THEN
    RAISE EXCEPTION 'los renglones solo se cargan en la misma transacción que crea el movimiento'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_movimiento_confirmado';
  END IF;
  NEW.hecho_en := m.hecho_en;
  NEW.fecha_negocio := m.fecha_negocio;
  IF m.clase NOT IN ('TRANSFERENCIA', 'ANULACION') AND NEW.deposito_id <> m.deposito_id THEN
    RAISE EXCEPTION 'el depósito del renglón es el del movimiento'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_deposito_distinto_del_acto';
  END IF;
  SELECT d.uso, d.activo INTO v_deposito
    FROM public.deposito d WHERE d.id = NEW.deposito_id AND d.empresa_id = NEW.empresa_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el depósito del renglón no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'renglon_de_movimiento_deposito_fkey';
  END IF;
  IF NOT v_deposito.activo THEN
    RAISE EXCEPTION 'un depósito inactivo no admite movimientos'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_deposito_inactivo';
  END IF;
  IF v_deposito.uso <> 'NORMAL' AND m.clase NOT IN ('TRANSFERENCIA', 'AJUSTE', 'AJUSTE_POR_CONTEO', 'ANULACION') THEN
    RAISE EXCEPTION 'cuarentena y rechazo solo reciben y entregan por transferencia, ajuste o anulación'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_deposito_de_uso_restringido';
  END IF;
  SELECT a.activo INTO v_activo FROM public.articulo_de_stock a WHERE a.id = NEW.articulo_id AND a.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el artículo del renglón no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'renglon_de_movimiento_articulo_fkey';
  END IF;
  IF NOT v_activo AND m.clase <> 'ANULACION' THEN
    RAISE EXCEPTION 'un artículo inactivo no admite movimientos'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_articulo_inactivo';
  END IF;
  RETURN NEW;
END
$$;

-- Renglón (después de insertar): aplica la cantidad al saldo con un `INSERT ... ON CONFLICT DO UPDATE` atómico (T2: toma la fila y serializa a
-- quienes mueven lo mismo) y aplica el control de existencia negativa (T5). El nivel: el más exigente entre el de la empresa y el de la sucursal
-- del depósito (BLOQUEAR antes que AVISAR antes que PERMITIR); sin fila rige PERMITIR.
CREATE FUNCTION renglon_de_movimiento_aplicar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  m record;
  v_existencia numeric;
  v_nivel integer;
BEGIN
  SELECT x.clase INTO m
    FROM public.movimiento_de_stock x WHERE x.id = NEW.movimiento_id AND x.empresa_id = NEW.empresa_id;
  INSERT INTO public.saldo_de_stock AS s (empresa_id, deposito_id, articulo_id, existencia)
  VALUES (NEW.empresa_id, NEW.deposito_id, NEW.articulo_id, NEW.cantidad)
  ON CONFLICT (empresa_id, deposito_id, articulo_id) DO UPDATE SET existencia = s.existencia + EXCLUDED.existencia
  RETURNING s.existencia INTO v_existencia;
  -- Solo resta una SALIDA o la pata de ORIGEN de una transferencia (la única que resta; el destino solo suma y `movimiento_de_stock_coherente`
  -- rechaza al confirmar una pata que resta fuera del origen).
  IF NEW.cantidad < 0 AND v_existencia < 0 AND m.clase IN ('SALIDA', 'TRANSFERENCIA') THEN
    SELECT coalesce(max(CASE n.nivel WHEN 'BLOQUEAR' THEN 2 WHEN 'AVISAR' THEN 1 ELSE 0 END), 0) INTO v_nivel
      FROM public.nivel_de_control n
     WHERE n.empresa_id = NEW.empresa_id AND n.control = 'stock.existencia_negativa'
       AND (n.sucursal_id IS NULL
            OR n.sucursal_id = (SELECT d.sucursal_id FROM public.deposito d WHERE d.id = NEW.deposito_id AND d.empresa_id = NEW.empresa_id));
    IF v_nivel = 2 THEN
      RAISE EXCEPTION 'no hay stock suficiente: la existencia quedaría en negativo'
        USING ERRCODE = '23514', CONSTRAINT = 'stock_existencia_negativa_bloqueada';
    ELSIF v_nivel = 1 AND NOT NEW.confirmo_negativo THEN
      RAISE EXCEPTION 'la existencia quedaría en negativo y falta la confirmación'
        USING ERRCODE = '23514', CONSTRAINT = 'stock_existencia_negativa_sin_confirmar';
    END IF;
  END IF;
  RETURN NULL;
END
$$;

-- Saldo (antes de insertar o cambiar): solo desde un disparador anidado (T2). Directo de la aplicación la profundidad es 1 y se rechaza.
CREATE FUNCTION saldo_de_stock_solo_por_movimientos() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'el saldo de stock lo escribe solo el libro de movimientos'
      USING ERRCODE = '42501', CONSTRAINT = 'saldo_de_stock_solo_por_movimientos';
  END IF;
  RETURN NEW;
END
$$;

-- Coherencia del movimiento, DIFERIDA (T6). Corre una vez por movimiento: el evento de la cabecera, y de los renglones solo el del último
-- (el de mayor número), así un movimiento de n renglones no hace n verificaciones completas.
CREATE FUNCTION movimiento_de_stock_coherente() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_id uuid;
  v_ultimo integer;
  m record;
  v_original record;
  v_estado text;
  v_deposito_del_conteo uuid;
BEGIN
  IF TG_TABLE_NAME = 'renglon_de_movimiento' THEN
    v_id := NEW.movimiento_id;
    SELECT max(r.numero) INTO v_ultimo FROM public.renglon_de_movimiento r WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = v_id;
    IF NEW.numero <> v_ultimo THEN
      RETURN NULL;
    END IF;
  ELSE
    v_id := NEW.id;
  END IF;
  SELECT x.clase, x.deposito_id, x.anula_a, x.conteo_id INTO m
    FROM public.movimiento_de_stock x WHERE x.id = v_id AND x.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.renglon_de_movimiento r WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = v_id) THEN
    RAISE EXCEPTION 'un movimiento tiene al menos un renglón'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_sin_renglones';
  END IF;

  IF m.clase = 'ENTRADA' THEN
    IF EXISTS (SELECT 1 FROM public.renglon_de_movimiento r WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = v_id AND r.cantidad < 0) THEN
      RAISE EXCEPTION 'una entrada solo suma'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_signo_invalido';
    END IF;
  ELSIF m.clase = 'SALIDA' THEN
    IF EXISTS (SELECT 1 FROM public.renglon_de_movimiento r WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = v_id AND r.cantidad > 0) THEN
      RAISE EXCEPTION 'una salida solo resta'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_signo_invalido';
    END IF;
  ELSIF m.clase = 'TRANSFERENCIA' THEN
    -- Dos depósitos distintos: el del acto (origen, solo resta) y uno más (destino, solo suma).
    IF (SELECT count(DISTINCT r.deposito_id) FROM public.renglon_de_movimiento r
         WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = v_id) <> 2 THEN
      RAISE EXCEPTION 'una transferencia mueve entre dos depósitos distintos'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_transferencia_entre_depositos_distintos';
    END IF;
    IF EXISTS (SELECT 1 FROM public.renglon_de_movimiento r
                WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = v_id
                  AND ((r.deposito_id = m.deposito_id AND r.cantidad > 0) OR (r.deposito_id <> m.deposito_id AND r.cantidad < 0))) THEN
      RAISE EXCEPTION 'una transferencia resta en el origen y suma en el destino'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_signo_invalido';
    END IF;
    IF EXISTS (SELECT 1 FROM public.renglon_de_movimiento r
                WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = v_id
                GROUP BY r.articulo_id HAVING sum(r.cantidad) <> 0) THEN
      RAISE EXCEPTION 'una transferencia suma cero por artículo'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_transferencia_no_suma_cero';
    END IF;
  ELSIF m.clase = 'AJUSTE_POR_CONTEO' THEN
    SELECT c.estado, c.deposito_id INTO v_estado, v_deposito_del_conteo
      FROM public.conteo_fisico c WHERE c.id = m.conteo_id AND c.empresa_id = NEW.empresa_id;
    IF v_estado IS DISTINCT FROM 'APLICADO' OR v_deposito_del_conteo IS DISTINCT FROM m.deposito_id THEN
      RAISE EXCEPTION 'el ajuste por conteo es de un conteo aplicado, del mismo depósito'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_conteo_no_aplicado';
    END IF;
  ELSIF m.clase = 'ANULACION' THEN
    -- El espejo exacto: mismo depósito del acto y, renglón por renglón, los mismos depósitos, artículos y composiciones con la cantidad opuesta.
    SELECT x.deposito_id INTO v_original FROM public.movimiento_de_stock x WHERE x.id = m.anula_a AND x.empresa_id = NEW.empresa_id;
    IF v_original.deposito_id IS DISTINCT FROM m.deposito_id
       OR EXISTS (
         (SELECT r.deposito_id, r.articulo_id, r.composicion_id, r.cantidad FROM public.renglon_de_movimiento r
           WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = m.anula_a)
         EXCEPT
         (SELECT r.deposito_id, r.articulo_id, r.composicion_id, -r.cantidad FROM public.renglon_de_movimiento r
           WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = v_id))
       OR EXISTS (
         (SELECT r.deposito_id, r.articulo_id, r.composicion_id, -r.cantidad FROM public.renglon_de_movimiento r
           WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = v_id)
         EXCEPT
         (SELECT r.deposito_id, r.articulo_id, r.composicion_id, r.cantidad FROM public.renglon_de_movimiento r
           WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = m.anula_a))
    THEN
      RAISE EXCEPTION 'la anulación es el espejo exacto del movimiento original'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_stock_anulacion_no_es_espejo';
    END IF;
  END IF;
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Disparadores: se instalan
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER deposito_alta BEFORE INSERT ON deposito
  FOR EACH ROW EXECUTE FUNCTION deposito_validar();
CREATE TRIGGER deposito_cambio BEFORE UPDATE ON deposito
  FOR EACH ROW EXECUTE FUNCTION deposito_validar();
CREATE TRIGGER deposito_version BEFORE UPDATE ON deposito
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

CREATE TRIGGER articulo_de_stock_alta BEFORE INSERT ON articulo_de_stock
  FOR EACH ROW EXECUTE FUNCTION articulo_de_stock_validar();
CREATE TRIGGER articulo_de_stock_cambio BEFORE UPDATE ON articulo_de_stock
  FOR EACH ROW EXECUTE FUNCTION articulo_de_stock_validar();
CREATE TRIGGER articulo_de_stock_version BEFORE UPDATE ON articulo_de_stock
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

CREATE TRIGGER composicion_alta BEFORE INSERT ON composicion
  FOR EACH ROW EXECUTE FUNCTION composicion_validar();
CREATE TRIGGER componente_de_composicion_alta BEFORE INSERT ON componente_de_composicion
  FOR EACH ROW EXECUTE FUNCTION componente_de_composicion_validar();

CREATE TRIGGER conteo_fisico_alta BEFORE INSERT ON conteo_fisico
  FOR EACH ROW EXECUTE FUNCTION conteo_fisico_validar();
CREATE TRIGGER conteo_fisico_cambio BEFORE UPDATE ON conteo_fisico
  FOR EACH ROW EXECUTE FUNCTION conteo_fisico_validar();
CREATE TRIGGER conteo_fisico_version BEFORE UPDATE ON conteo_fisico
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER conteo_registro_alta BEFORE INSERT ON conteo_registro
  FOR EACH ROW EXECUTE FUNCTION conteo_registro_preparar();

CREATE TRIGGER movimiento_de_stock_alta BEFORE INSERT ON movimiento_de_stock
  FOR EACH ROW EXECUTE FUNCTION movimiento_de_stock_preparar();
CREATE CONSTRAINT TRIGGER movimiento_de_stock_coherente_del_movimiento AFTER INSERT ON movimiento_de_stock
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION movimiento_de_stock_coherente();
CREATE TRIGGER renglon_de_movimiento_alta BEFORE INSERT ON renglon_de_movimiento
  FOR EACH ROW EXECUTE FUNCTION renglon_de_movimiento_validar();
CREATE TRIGGER renglon_de_movimiento_aplicar AFTER INSERT ON renglon_de_movimiento
  FOR EACH ROW EXECUTE FUNCTION renglon_de_movimiento_aplicar();
CREATE CONSTRAINT TRIGGER movimiento_de_stock_coherente_del_renglon AFTER INSERT ON renglon_de_movimiento
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION movimiento_de_stock_coherente();

CREATE TRIGGER saldo_de_stock_solo_por_movimientos BEFORE INSERT OR UPDATE ON saldo_de_stock
  FOR EACH ROW EXECUTE FUNCTION saldo_de_stock_solo_por_movimientos();

-- Nada de estas tablas se borra ni se vacía (ni el dueño de la base): el depósito, el artículo y el conteo se desactivan o se resuelven, y el
-- saldo no se reinicia.
CREATE TRIGGER deposito_sin_borrado BEFORE DELETE ON deposito
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER deposito_sin_truncate BEFORE TRUNCATE ON deposito
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER articulo_de_stock_sin_borrado BEFORE DELETE ON articulo_de_stock
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER articulo_de_stock_sin_truncate BEFORE TRUNCATE ON articulo_de_stock
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER conteo_fisico_sin_borrado BEFORE DELETE ON conteo_fisico
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER conteo_fisico_sin_truncate BEFORE TRUNCATE ON conteo_fisico
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER saldo_de_stock_sin_borrado BEFORE DELETE ON saldo_de_stock
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER saldo_de_stock_sin_truncate BEFORE TRUNCATE ON saldo_de_stock
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- De solo inserción: `solo_insercion()` rechaza el UPDATE, el DELETE y el vaciado, aun al dueño de la base.
CREATE TRIGGER motivo_de_movimiento_solo_insercion BEFORE UPDATE OR DELETE ON motivo_de_movimiento
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER motivo_de_movimiento_sin_truncate BEFORE TRUNCATE ON motivo_de_movimiento
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER movimiento_de_stock_solo_insercion BEFORE UPDATE OR DELETE ON movimiento_de_stock
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER movimiento_de_stock_sin_truncate BEFORE TRUNCATE ON movimiento_de_stock
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER renglon_de_movimiento_solo_insercion BEFORE UPDATE OR DELETE ON renglon_de_movimiento
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER renglon_de_movimiento_sin_truncate BEFORE TRUNCATE ON renglon_de_movimiento
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER conteo_registro_solo_insercion BEFORE UPDATE OR DELETE ON conteo_registro
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER conteo_registro_sin_truncate BEFORE TRUNCATE ON conteo_registro
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER composicion_solo_insercion BEFORE UPDATE OR DELETE ON composicion
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER composicion_sin_truncate BEFORE TRUNCATE ON composicion
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER componente_de_composicion_solo_insercion BEFORE UPDATE OR DELETE ON componente_de_composicion
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER componente_de_composicion_sin_truncate BEFORE TRUNCATE ON componente_de_composicion
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE ni TRUNCATE. Solo la aplicación (`pedernal_app`) recibe algo.
-- `registrado_en`, `fecha_negocio` (salvo la salida por venta), `hecho_en` y `fecha_negocio` de los renglones, `existencia_al_registrar`,
-- `registrada_en` y `orden` no se conceden: los fija la base. El saldo se concede para que lo escriba el disparador, que corre con los
-- permisos de quien inserta el renglón (T2); `saldo_de_stock_solo_por_movimientos` rechaza todo lo que no venga de un disparador.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON deposito, articulo_de_stock, motivo_de_movimiento, movimiento_de_stock, renglon_de_movimiento, saldo_de_stock, conteo_fisico,
  conteo_registro, composicion, componente_de_composicion FROM PUBLIC;

GRANT SELECT ON deposito, articulo_de_stock, motivo_de_movimiento, movimiento_de_stock, renglon_de_movimiento, saldo_de_stock, conteo_fisico,
  conteo_registro, composicion, componente_de_composicion TO pedernal_app;

GRANT INSERT (id, empresa_id, sucursal_id, nombre, nombre_clave, uso, de_venta) ON deposito TO pedernal_app;
GRANT UPDATE (nombre, nombre_clave, de_venta, activo) ON deposito TO pedernal_app;

GRANT INSERT (id, empresa_id, producto_id, unidad_de_stock_id, dimension) ON articulo_de_stock TO pedernal_app;
GRANT UPDATE (activo) ON articulo_de_stock TO pedernal_app;

GRANT INSERT (id, empresa_id, clase, motivo, detalle, origen_tipo, origen_id, deposito_id, accion, anula_a, conteo_id, clave_idempotencia,
              huella, hecho_en, fecha_negocio, registrado_por)
  ON movimiento_de_stock TO pedernal_app;
GRANT INSERT (empresa_id, movimiento_id, numero, deposito_id, articulo_id, cantidad, composicion_id, confirmo_negativo)
  ON renglon_de_movimiento TO pedernal_app;

GRANT INSERT (empresa_id, deposito_id, articulo_id, existencia) ON saldo_de_stock TO pedernal_app;
GRANT UPDATE (existencia) ON saldo_de_stock TO pedernal_app;

GRANT INSERT (id, empresa_id, deposito_id, abierto_por, abierto_en) ON conteo_fisico TO pedernal_app;
GRANT UPDATE (estado, resuelto_por, resuelto_en, motivo) ON conteo_fisico TO pedernal_app;
GRANT INSERT (id, empresa_id, conteo_id, articulo_id, cantidad_contada, registrado_por, registrado_en) ON conteo_registro TO pedernal_app;

GRANT INSERT (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) ON composicion TO pedernal_app;
GRANT INSERT (empresa_id, composicion_id, numero, articulo_id, cantidad, unidad_id, dimension, perdida) ON componente_de_composicion TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada en toda tabla nueva; sin política no hay acceso
-- ---------------------------------------------------------------------------------------------
ALTER TABLE deposito ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposito FORCE ROW LEVEL SECURITY;
ALTER TABLE articulo_de_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE articulo_de_stock FORCE ROW LEVEL SECURITY;
ALTER TABLE motivo_de_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE motivo_de_movimiento FORCE ROW LEVEL SECURITY;
ALTER TABLE movimiento_de_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimiento_de_stock FORCE ROW LEVEL SECURITY;
ALTER TABLE renglon_de_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE renglon_de_movimiento FORCE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_stock FORCE ROW LEVEL SECURITY;
ALTER TABLE conteo_fisico ENABLE ROW LEVEL SECURITY;
ALTER TABLE conteo_fisico FORCE ROW LEVEL SECURITY;
ALTER TABLE conteo_registro ENABLE ROW LEVEL SECURITY;
ALTER TABLE conteo_registro FORCE ROW LEVEL SECURITY;
ALTER TABLE composicion ENABLE ROW LEVEL SECURITY;
ALTER TABLE composicion FORCE ROW LEVEL SECURITY;
ALTER TABLE componente_de_composicion ENABLE ROW LEVEL SECURITY;
ALTER TABLE componente_de_composicion FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- Políticas. La aplicación siempre con `empresa_id = (SELECT app_empresa_id())` y, en altas y cambios, `empresa_operable(empresa_id)`; los
-- autores con la persona del contexto. Sin `FOR ALL`: cada comando tiene su política. El saldo se puede leer, insertar y cambiar en la
-- empresa del contexto, y lo demás lo decide el disparador (T2).
-- ---------------------------------------------------------------------------------------------
CREATE POLICY motivo_de_movimiento_app_leer ON motivo_de_movimiento FOR SELECT TO pedernal_app USING (true);

CREATE POLICY deposito_app_leer ON deposito FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY deposito_app_alta ON deposito FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY deposito_app_cambiar ON deposito FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY articulo_de_stock_app_leer ON articulo_de_stock FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY articulo_de_stock_app_alta ON articulo_de_stock FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY articulo_de_stock_app_cambiar ON articulo_de_stock FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY movimiento_de_stock_app_leer ON movimiento_de_stock FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY movimiento_de_stock_app_alta ON movimiento_de_stock FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND registrado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );

CREATE POLICY renglon_de_movimiento_app_leer ON renglon_de_movimiento FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY renglon_de_movimiento_app_alta ON renglon_de_movimiento FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY saldo_de_stock_app_leer ON saldo_de_stock FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY saldo_de_stock_app_alta ON saldo_de_stock FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY saldo_de_stock_app_cambiar ON saldo_de_stock FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY conteo_fisico_app_leer ON conteo_fisico FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY conteo_fisico_app_alta ON conteo_fisico FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND abierto_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY conteo_fisico_app_cambiar ON conteo_fisico FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND resuelto_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );

CREATE POLICY conteo_registro_app_leer ON conteo_registro FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY conteo_registro_app_alta ON conteo_registro FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND registrado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );

CREATE POLICY composicion_app_leer ON composicion FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY composicion_app_alta ON composicion FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creada_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );

CREATE POLICY componente_de_composicion_app_leer ON componente_de_composicion FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY componente_de_composicion_app_alta ON componente_de_composicion FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
