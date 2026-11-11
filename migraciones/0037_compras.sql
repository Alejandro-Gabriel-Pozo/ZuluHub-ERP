-- 0037_compras: compras N1 y N2 (E9 tramo 6): la ficha de compra del proveedor (letra esperada, comprobantes que emite, puntos de venta y pedidos), las
-- presentaciones de compra de un producto, las ofertas por proveedor, la recepción con sus líneas (peso real obligatorio si es de peso variable), el
-- comprobante del proveedor con sus líneas, importes por alícuota y tributos, la conciliación atajo con sus asignaciones y los saldos que solo escriben
-- los disparadores, el pago mínimo de la factura (sin mover caja) y la corrección de una compra por ajuste.
-- Especificación: Pedernal-docs/11-especificaciones/e9-compras-especificacion.md (§3.2 a §3.7, §4 y §5) y e9-arca-datos-de-compras-panorama.md.
-- N3 (recepción separada) y N4 (tres vías) NO están acá: van en sus propias migraciones, apagadas por perilla.
--
-- Reglas de esta migración (las mismas de 0001 a 0034):
--  * ADITIVA: crea objetos nuevos; no toca ninguna tabla existente. Se frena con un error claro si alguna ya existe o si falta una dependencia.
--  * Sin funciones SECURITY DEFINER; toda función fija `search_path = pg_catalog, public, pg_temp`. Ninguna se otorga a la aplicación.
--  * Nadie recibe DELETE ni TRUNCATE (nada se borra: se anula con un registro espejo). INSERT y UPDATE por columna. RLS activa y FORZADA, una política
--    por comando. Toda única de una tabla con `empresa_id` lo incluye y toda clave foránea entre tablas de empresa es COMPUESTA.
--  * Dinero en `numeric` exacto con cota en ambos sentidos (`NaN` pasaría un `>= 0`), moneda explícita `ARS`. Los textos se validan con la LISTA DE
--    PERMITIDOS del catálogo (`texto_de_catalogo_valido`, 0025).
--  * Su reversión es un script aparte, DESTRUCTIVO si hay datos: `migraciones/reversiones/0037_revertir_compras.sql`.
--  * DEPENDE de 0001, 0005 (sucursal), 0007 (`sin_borrado`), 0025 (producto, unidad, `texto_de_catalogo_valido`), 0027 (`fecha_de_negocio`), 0030 (depósito y
--    movimiento de stock) y 0034 (`parte`); se comprueba al empezar.
--
-- Decisiones de diseño (probadas por `test/integracion/compras-migracion.test.ts`):
--  C1. Recepción, comprobante, líneas, importes, tributos, asignaciones, pagos y correcciones son de solo inserción en lo que describen; solo cambian
--      el estado (CONFIRMADA→ANULADA, REGISTRADO→ANULADO, VIGENTE→ANULADO) y los datos de su anulación, con un disparador de transiciones.
--  C2. `numero` de la recepción lo asigna un disparador (max+1 por empresa) con única: el segundo choca y reintenta.
--  C3. `fecha_negocio` de la recepción la fija LA BASE con la fórmula de caja, ventas y stock (`fecha_de_negocio`); la del comprobante es la fecha civil
--      de la empresa (sin hora de corte, S-7). Quedan selladas.
--  C4. Duplicados: un remito por proveedor (entre las confirmadas), una factura por (proveedor, tipo, punto de venta, número) entre las no anuladas y un
--      pago vigente por factura; la clave de idempotencia es única por empresa en todo comando.
--  C5. Los saldos (recibido y asignado por línea) los escribe solo el disparador de las asignaciones (profundidad >= 2): una asignación nunca supera lo
--      recibido ni lo facturado (`UPDATE ... WHERE asignada + n <= recibida` y CHECK).
--  C6. Una línea solo entra en la MISMA transacción que su cabecera (`registrado_en = now()`).

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.empresa') IS NULL OR to_regclass('public.persona') IS NULL OR to_regclass('public.sucursal') IS NULL
     OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL OR to_regprocedure('public.solo_insercion()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL OR to_regprocedure('public.app_persona_id()') IS NULL
     OR to_regprocedure('public.app_empresa_id()') IS NULL OR to_regprocedure('public.sin_borrado()') IS NULL THEN
    RAISE EXCEPTION 'compras requiere 0001, 0005 y 0007 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.producto') IS NULL OR to_regclass('public.unidad_de_medida') IS NULL
     OR to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'compras requiere 0025_catalogo aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.fecha_de_negocio(timestamptz, text, time)') IS NULL THEN
    RAISE EXCEPTION 'compras requiere 0027_caja aplicada antes (falta fecha_de_negocio)' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.deposito') IS NULL OR to_regclass('public.movimiento_de_stock') IS NULL THEN
    RAISE EXCEPTION 'compras requiere 0030_stock aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.parte') IS NULL THEN
    RAISE EXCEPTION 'compras requiere 0034_clientes aplicada antes' USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['configuracion_de_compras', 'ficha_de_compra_del_proveedor', 'comprobante_de_la_ficha', 'punto_de_venta_de_la_ficha',
      'pedido_de_ficha', 'presentacion_de_producto', 'oferta_de_proveedor', 'recepcion', 'linea_de_recepcion', 'saldo_de_linea_de_recepcion',
      'comprobante_de_proveedor', 'linea_de_comprobante', 'importe_por_alicuota', 'tributo_de_comprobante', 'saldo_de_linea_de_comprobante',
      'conciliacion', 'asignacion_de_conciliacion', 'pago_de_comprobante', 'correccion_de_compra'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'compras: la tabla % ya existe; esta migración solo crea objetos nuevos', v_tabla USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- ================================================================================================
-- Configuración, ficha de compra del proveedor y pedidos de ficha
-- ================================================================================================
CREATE TABLE configuracion_de_compras (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  nivel          text NOT NULL DEFAULT 'COMPRA_SIMPLE' CONSTRAINT configuracion_de_compras_nivel_ck
                   CHECK (nivel IN ('COMPRA_SIMPLE', 'CON_COMPROBANTE', 'RECEPCION_SEPARADA', 'TRES_VIAS')),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT configuracion_de_compras_pkey PRIMARY KEY (empresa_id)
);

CREATE TABLE ficha_de_compra_del_proveedor (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  parte_id       uuid NOT NULL,
  letra_esperada char(1) CONSTRAINT ficha_letra_ck CHECK (letra_esperada IN ('A', 'B', 'C')),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT ficha_de_compra_pkey PRIMARY KEY (empresa_id, parte_id),
  CONSTRAINT ficha_parte_fkey FOREIGN KEY (parte_id, empresa_id) REFERENCES parte (id, empresa_id)
);

CREATE TABLE comprobante_de_la_ficha (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  parte_id       uuid NOT NULL,
  tipo           text NOT NULL CONSTRAINT comprobante_de_la_ficha_tipo_ck CHECK (tipo IN ('FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'NOTA_DEBITO_A',
                   'NOTA_DEBITO_B', 'NOTA_DEBITO_C', 'NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C')),
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT comprobante_de_la_ficha_pkey PRIMARY KEY (empresa_id, parte_id, tipo),
  CONSTRAINT comprobante_de_la_ficha_ficha_fkey FOREIGN KEY (parte_id, empresa_id) REFERENCES ficha_de_compra_del_proveedor (parte_id, empresa_id)
);

CREATE TABLE punto_de_venta_de_la_ficha (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  parte_id       uuid NOT NULL,
  numero         integer NOT NULL CONSTRAINT punto_de_venta_de_la_ficha_numero_ck CHECK (numero BETWEEN 1 AND 99998),
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT punto_de_venta_de_la_ficha_pkey PRIMARY KEY (empresa_id, parte_id, numero),
  CONSTRAINT punto_de_venta_de_la_ficha_ficha_fkey FOREIGN KEY (parte_id, empresa_id) REFERENCES ficha_de_compra_del_proveedor (parte_id, empresa_id)
);

CREATE TABLE pedido_de_ficha (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa (id),
  parte_id    uuid NOT NULL,
  objeto      text NOT NULL CONSTRAINT pedido_de_ficha_objeto_ck CHECK (objeto IN ('PUNTO_DE_VENTA', 'COMPROBANTE')),
  valor       text NOT NULL CONSTRAINT pedido_de_ficha_valor_ck CHECK (valor ~ '^[A-Z0-9_]{1,20}$'),
  estado      text NOT NULL DEFAULT 'PENDIENTE' CONSTRAINT pedido_de_ficha_estado_ck CHECK (estado IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
  pedido_por  uuid NOT NULL REFERENCES persona (id),
  pedido_en   timestamptz NOT NULL DEFAULT now(),
  resuelto_por uuid REFERENCES persona (id),
  resuelto_en  timestamptz,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT pedido_de_ficha_pkey PRIMARY KEY (id),
  CONSTRAINT pedido_de_ficha_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT pedido_de_ficha_ficha_fkey FOREIGN KEY (parte_id, empresa_id) REFERENCES ficha_de_compra_del_proveedor (parte_id, empresa_id),
  CONSTRAINT pedido_de_ficha_resolucion_ck CHECK ((estado = 'PENDIENTE') = (resuelto_por IS NULL AND resuelto_en IS NULL))
);
-- Pedir dos veces lo mismo es un pedido.
CREATE UNIQUE INDEX pedido_de_ficha_pendiente_uk ON pedido_de_ficha (empresa_id, parte_id, objeto, valor) WHERE estado = 'PENDIENTE';

-- ================================================================================================
-- Cómo se compra: presentaciones y ofertas
-- ================================================================================================
CREATE TABLE presentacion_de_producto (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresa (id),
  producto_id      uuid NOT NULL,
  nombre           text NOT NULL CONSTRAINT presentacion_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 80)),
  nombre_clave     text NOT NULL CONSTRAINT presentacion_nombre_clave_ck CHECK (nombre_clave = lower(nombre_clave) AND char_length(nombre_clave) BETWEEN 1 AND 80),
  cantidad         numeric(18,4) NOT NULL CONSTRAINT presentacion_cantidad_ck CHECK (cantidad > 0 AND cantidad < 100000000000000),
  de_peso_variable boolean NOT NULL DEFAULT false,
  activa           boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT presentacion_de_producto_pkey PRIMARY KEY (id),
  CONSTRAINT presentacion_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT presentacion_nombre_uk UNIQUE (empresa_id, producto_id, nombre_clave),
  CONSTRAINT presentacion_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id)
);

CREATE TABLE oferta_de_proveedor (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  proveedor_id        uuid NOT NULL,
  producto_id         uuid NOT NULL,
  presentacion_id     uuid,
  precio_por_tipo     text NOT NULL CONSTRAINT oferta_precio_por_tipo_ck CHECK (precio_por_tipo IN ('PRESENTACION', 'UNIDAD')),
  unidad_de_precio_id text REFERENCES unidad_de_medida (id),
  ultimo_precio       numeric(18,6) NOT NULL CONSTRAINT oferta_ultimo_precio_ck CHECK (ultimo_precio > 0 AND ultimo_precio < 10000000000000),
  ultimo_costo_por_unidad_de_stock numeric(18,6) NOT NULL CONSTRAINT oferta_ultimo_costo_ck CHECK (ultimo_costo_por_unidad_de_stock > 0 AND ultimo_costo_por_unidad_de_stock < 10000000000000),
  ultima_compra_id    uuid NOT NULL,
  ultima_compra_en    timestamptz NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT oferta_de_proveedor_pkey PRIMARY KEY (id),
  CONSTRAINT oferta_unica_uk UNIQUE NULLS NOT DISTINCT (empresa_id, proveedor_id, producto_id, presentacion_id),
  CONSTRAINT oferta_proveedor_fkey FOREIGN KEY (proveedor_id, empresa_id) REFERENCES parte (id, empresa_id),
  CONSTRAINT oferta_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT oferta_presentacion_fkey FOREIGN KEY (presentacion_id, empresa_id) REFERENCES presentacion_de_producto (id, empresa_id)
);

-- ================================================================================================
-- Recepción y sus líneas
-- ================================================================================================
CREATE TABLE recepcion (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  sucursal_id        uuid NOT NULL,
  proveedor_id       uuid NOT NULL,
  numero             integer NOT NULL,
  nivel              text NOT NULL CONSTRAINT recepcion_nivel_ck CHECK (nivel IN ('COMPRA_SIMPLE', 'CON_COMPROBANTE', 'RECEPCION_SEPARADA', 'TRES_VIAS')),
  es_atajo           boolean NOT NULL DEFAULT false,
  remito_punto_de_venta integer CONSTRAINT recepcion_remito_pv_ck CHECK (remito_punto_de_venta BETWEEN 1 AND 99998),
  remito_numero      integer CONSTRAINT recepcion_remito_numero_ck CHECK (remito_numero BETWEEN 1 AND 99999999),
  remito_fecha       date,
  hecho_en           timestamptz NOT NULL,
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  fecha_negocio      date NOT NULL,
  estado             text NOT NULL DEFAULT 'CONFIRMADA' CONSTRAINT recepcion_estado_ck CHECK (estado IN ('CONFIRMADA', 'ANULADA')),
  clave_idempotencia text NOT NULL CONSTRAINT recepcion_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella             text NOT NULL CONSTRAINT recepcion_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  registrado_por     uuid NOT NULL REFERENCES persona (id),
  anulada_por        uuid REFERENCES persona (id),
  anulada_en         timestamptz,
  motivo_de_anulacion text CONSTRAINT recepcion_motivo_ck CHECK (motivo_de_anulacion IS NULL OR texto_de_catalogo_valido(motivo_de_anulacion, 500)),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT recepcion_pkey PRIMARY KEY (id),
  CONSTRAINT recepcion_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT recepcion_numero_uk UNIQUE (empresa_id, numero),
  CONSTRAINT recepcion_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT recepcion_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT recepcion_proveedor_fkey FOREIGN KEY (proveedor_id, empresa_id) REFERENCES parte (id, empresa_id),
  CONSTRAINT recepcion_remito_completo_ck CHECK ((remito_punto_de_venta IS NULL) = (remito_numero IS NULL) AND (remito_numero IS NULL OR remito_fecha IS NOT NULL)),
  CONSTRAINT recepcion_anulacion_ck CHECK ((estado = 'ANULADA') = (anulada_por IS NOT NULL AND anulada_en IS NOT NULL AND motivo_de_anulacion IS NOT NULL))
);
-- Un remito del mismo proveedor no se carga dos veces (entre las confirmadas: la anulada libera el número).
CREATE UNIQUE INDEX recepcion_remito_uk ON recepcion (empresa_id, proveedor_id, remito_punto_de_venta, remito_numero)
  WHERE remito_numero IS NOT NULL AND estado = 'CONFIRMADA';
CREATE INDEX recepcion_fecha_ix ON recepcion (empresa_id, sucursal_id, fecha_negocio DESC, id);

CREATE TABLE linea_de_recepcion (
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  recepcion_id       uuid NOT NULL,
  numero             integer NOT NULL CONSTRAINT linea_de_recepcion_numero_ck CHECK (numero >= 1),
  producto_id        uuid NOT NULL,
  presentacion_id    uuid,
  unidad_de_compra_id text NOT NULL REFERENCES unidad_de_medida (id),
  cantidad_de_compra numeric(18,4) NOT NULL CONSTRAINT linea_de_recepcion_compra_ck CHECK (cantidad_de_compra > 0 AND cantidad_de_compra < 100000000000000),
  de_peso_variable   boolean NOT NULL DEFAULT false,
  peso_real          numeric(18,4) CONSTRAINT linea_de_recepcion_peso_ck CHECK (peso_real > 0 AND peso_real < 100000000000000),
  cantidad_en_stock  numeric(18,4) NOT NULL CONSTRAINT linea_de_recepcion_stock_ck CHECK (cantidad_en_stock > 0 AND cantidad_en_stock < 100000000000000),
  precio_por_tipo    text CONSTRAINT linea_de_recepcion_precio_por_ck CHECK (precio_por_tipo IN ('PRESENTACION', 'UNIDAD')),
  unidad_de_precio_id text REFERENCES unidad_de_medida (id),
  precio             numeric(18,6) CONSTRAINT linea_de_recepcion_precio_ck CHECK (precio > 0 AND precio < 10000000000000),
  importe            numeric(18,2) CONSTRAINT linea_de_recepcion_importe_ck CHECK (importe >= 0 AND importe < 10000000000000000),
  costo_por_unidad_de_stock numeric(18,6) CONSTRAINT linea_de_recepcion_costo_ck CHECK (costo_por_unidad_de_stock > 0 AND costo_por_unidad_de_stock < 10000000000000),
  deposito_id        uuid,
  movimiento_id      uuid,
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linea_de_recepcion_pkey PRIMARY KEY (empresa_id, recepcion_id, numero),
  CONSTRAINT linea_de_recepcion_recepcion_fkey FOREIGN KEY (recepcion_id, empresa_id) REFERENCES recepcion (id, empresa_id),
  CONSTRAINT linea_de_recepcion_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT linea_de_recepcion_presentacion_fkey FOREIGN KEY (presentacion_id, empresa_id) REFERENCES presentacion_de_producto (id, empresa_id),
  CONSTRAINT linea_de_recepcion_deposito_fkey FOREIGN KEY (deposito_id, empresa_id) REFERENCES deposito (id, empresa_id),
  CONSTRAINT linea_de_recepcion_movimiento_fkey FOREIGN KEY (movimiento_id, empresa_id) REFERENCES movimiento_de_stock (id, empresa_id),
  -- Peso variable sin pesar no se confirma (D135, D109).
  CONSTRAINT linea_de_recepcion_peso_real_ck CHECK (NOT de_peso_variable OR peso_real IS NOT NULL),
  -- «Sin precio»: precio, importe y costo nulos juntos, nunca cero (D125).
  CONSTRAINT linea_de_recepcion_sin_precio_ck CHECK ((precio IS NULL) = (importe IS NULL) AND (importe IS NULL) = (costo_por_unidad_de_stock IS NULL)
    AND (precio IS NULL) = (precio_por_tipo IS NULL)),
  CONSTRAINT linea_de_recepcion_stock_ptr_ck CHECK (movimiento_id IS NULL OR deposito_id IS NOT NULL)
);

CREATE TABLE saldo_de_linea_de_recepcion (
  empresa_id        uuid NOT NULL REFERENCES empresa (id),
  recepcion_id      uuid NOT NULL,
  numero            integer NOT NULL,
  cantidad_recibida numeric(18,4) NOT NULL CONSTRAINT saldo_de_linea_de_recepcion_recibida_ck CHECK (cantidad_recibida > 0 AND cantidad_recibida < 100000000000000),
  cantidad_asignada numeric(18,4) NOT NULL DEFAULT 0 CONSTRAINT saldo_de_linea_de_recepcion_asignada_ck CHECK (cantidad_asignada >= 0 AND cantidad_asignada < 100000000000000),
  CONSTRAINT saldo_de_linea_de_recepcion_pkey PRIMARY KEY (empresa_id, recepcion_id, numero),
  CONSTRAINT saldo_de_linea_de_recepcion_linea_fkey FOREIGN KEY (empresa_id, recepcion_id, numero) REFERENCES linea_de_recepcion (empresa_id, recepcion_id, numero),
  CONSTRAINT saldo_de_linea_de_recepcion_tope_ck CHECK (cantidad_asignada <= cantidad_recibida)
);

-- ================================================================================================
-- Comprobante del proveedor y sus líneas
-- ================================================================================================
CREATE TABLE comprobante_de_proveedor (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  proveedor_id       uuid NOT NULL,
  clase              text NOT NULL CONSTRAINT cp_clase_ck CHECK (clase IN ('SIN_COMPROBANTE', 'FACTURA', 'NOTA_DE_DEBITO', 'NOTA_DE_CREDITO')),
  tipo               text CONSTRAINT cp_tipo_ck CHECK (tipo IN ('FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'NOTA_DEBITO_A', 'NOTA_DEBITO_B',
                       'NOTA_DEBITO_C', 'NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C')),
  punto_de_venta     integer CONSTRAINT cp_pv_ck CHECK (punto_de_venta BETWEEN 1 AND 99998),
  numero             integer CONSTRAINT cp_numero_ck CHECK (numero BETWEEN 1 AND 99999999),
  fecha_del_comprobante date,
  fecha_de_vencimiento_de_pago date,
  neto_gravado       numeric(18,2) NOT NULL CONSTRAINT cp_neto_ck CHECK (neto_gravado >= 0 AND neto_gravado < 10000000000000000),
  no_gravado         numeric(18,2) NOT NULL CONSTRAINT cp_no_gravado_ck CHECK (no_gravado >= 0 AND no_gravado < 10000000000000000),
  exento             numeric(18,2) NOT NULL CONSTRAINT cp_exento_ck CHECK (exento >= 0 AND exento < 10000000000000000),
  iva                numeric(18,2) NOT NULL CONSTRAINT cp_iva_ck CHECK (iva >= 0 AND iva < 10000000000000000),
  tributos_total     numeric(18,2) NOT NULL CONSTRAINT cp_tributos_ck CHECK (tributos_total >= 0 AND tributos_total < 10000000000000000),
  credito_fiscal_computable numeric(18,2) NOT NULL CONSTRAINT cp_credito_ck CHECK (credito_fiscal_computable >= 0 AND credito_fiscal_computable < 10000000000000000),
  total_calculado    numeric(18,2) NOT NULL CONSTRAINT cp_total_calculado_ck CHECK (total_calculado >= 0 AND total_calculado < 10000000000000000),
  total_segun_factura numeric(18,2) NOT NULL CONSTRAINT cp_total_factura_ck CHECK (total_segun_factura >= 0 AND total_segun_factura < 10000000000000000),
  moneda             char(3) NOT NULL DEFAULT 'ARS' CONSTRAINT cp_moneda_ck CHECK (moneda = 'ARS'),
  proveedor_cuit     text CONSTRAINT cp_proveedor_cuit_ck CHECK (proveedor_cuit IS NULL OR cuit_valido(proveedor_cuit)),
  proveedor_razon_social text NOT NULL CONSTRAINT cp_razon_social_ck CHECK (texto_de_catalogo_valido(proveedor_razon_social, 200)),
  letra_no_esperada  boolean NOT NULL DEFAULT false,
  nivel              text NOT NULL CONSTRAINT cp_nivel_ck CHECK (nivel IN ('COMPRA_SIMPLE', 'CON_COMPROBANTE', 'RECEPCION_SEPARADA', 'TRES_VIAS')),
  es_atajo           boolean NOT NULL DEFAULT false,
  estado             text NOT NULL DEFAULT 'REGISTRADO' CONSTRAINT cp_estado_ck CHECK (estado IN ('REGISTRADO', 'ANULADO')),
  fecha_negocio      date NOT NULL,
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  clave_idempotencia text NOT NULL CONSTRAINT cp_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella             text NOT NULL CONSTRAINT cp_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  registrado_por     uuid NOT NULL REFERENCES persona (id),
  anulado_por        uuid REFERENCES persona (id),
  anulado_en         timestamptz,
  motivo_de_anulacion text CONSTRAINT cp_motivo_ck CHECK (motivo_de_anulacion IS NULL OR texto_de_catalogo_valido(motivo_de_anulacion, 500)),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT comprobante_de_proveedor_pkey PRIMARY KEY (id),
  CONSTRAINT cp_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT cp_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT cp_proveedor_fkey FOREIGN KEY (proveedor_id, empresa_id) REFERENCES parte (id, empresa_id),
  CONSTRAINT cp_forma_ck CHECK ((clase = 'SIN_COMPROBANTE') = (tipo IS NULL)
    AND (tipo IS NULL) = (punto_de_venta IS NULL) AND (tipo IS NULL) = (numero IS NULL) AND (tipo IS NULL) = (fecha_del_comprobante IS NULL)),
  CONSTRAINT cp_clase_tipo_ck CHECK (tipo IS NULL OR (clase = 'FACTURA' AND tipo LIKE 'FACTURA\_%')
    OR (clase = 'NOTA_DE_DEBITO' AND tipo LIKE 'NOTA\_DEBITO\_%') OR (clase = 'NOTA_DE_CREDITO' AND tipo LIKE 'NOTA\_CREDITO\_%')),
  CONSTRAINT cp_total_ck CHECK (total_calculado = neto_gravado + no_gravado + exento + iva + tributos_total),
  CONSTRAINT cp_anulacion_ck CHECK ((estado = 'ANULADO') = (anulado_por IS NOT NULL AND anulado_en IS NOT NULL AND motivo_de_anulacion IS NOT NULL))
);
-- Duplicado único: la factura de un proveedor no se carga dos veces (la anulada libera el número).
CREATE UNIQUE INDEX cp_duplicado_uk ON comprobante_de_proveedor (empresa_id, proveedor_id, tipo, punto_de_venta, numero)
  WHERE estado <> 'ANULADO' AND tipo IS NOT NULL;

CREATE TABLE linea_de_comprobante (
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  comprobante_id     uuid NOT NULL,
  numero             integer NOT NULL CONSTRAINT linea_de_comprobante_numero_ck CHECK (numero >= 1),
  descripcion        text NOT NULL CONSTRAINT linea_de_comprobante_descripcion_ck CHECK (texto_de_catalogo_valido(descripcion, 200)),
  unidad             text NOT NULL CONSTRAINT linea_de_comprobante_unidad_ck CHECK (texto_de_catalogo_valido(unidad, 40)),
  cantidad_facturada numeric(18,4) NOT NULL CONSTRAINT linea_de_comprobante_cantidad_ck CHECK (cantidad_facturada > 0 AND cantidad_facturada < 100000000000000),
  precio_neto        numeric(18,6) NOT NULL CONSTRAINT linea_de_comprobante_precio_ck CHECK (precio_neto >= 0 AND precio_neto < 10000000000000),
  alicuota           text CONSTRAINT linea_de_comprobante_alicuota_ck CHECK (alicuota IN ('0', '2.5', '5', '10.5', '21', '27', 'EXENTO', 'NO_GRAVADO')),
  neto_de_linea      numeric(18,2) NOT NULL CONSTRAINT linea_de_comprobante_neto_ck CHECK (neto_de_linea >= 0 AND neto_de_linea < 10000000000000000),
  iva_de_linea       numeric(18,2) NOT NULL CONSTRAINT linea_de_comprobante_iva_ck CHECK (iva_de_linea >= 0 AND iva_de_linea < 10000000000000000),
  recepcion_id       uuid,
  linea_de_recepcion integer,
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linea_de_comprobante_pkey PRIMARY KEY (empresa_id, comprobante_id, numero),
  CONSTRAINT linea_de_comprobante_comprobante_fkey FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante_de_proveedor (id, empresa_id),
  CONSTRAINT linea_de_comprobante_recepcion_fkey FOREIGN KEY (empresa_id, recepcion_id, linea_de_recepcion) REFERENCES linea_de_recepcion (empresa_id, recepcion_id, numero),
  CONSTRAINT linea_de_comprobante_ptr_ck CHECK ((recepcion_id IS NULL) = (linea_de_recepcion IS NULL))
);

CREATE TABLE importe_por_alicuota (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  comprobante_id uuid NOT NULL,
  alicuota       text NOT NULL CONSTRAINT importe_por_alicuota_alicuota_ck CHECK (alicuota IN ('0', '2.5', '5', '10.5', '21', '27', 'EXENTO', 'NO_GRAVADO')),
  neto           numeric(18,2) NOT NULL CONSTRAINT importe_por_alicuota_neto_ck CHECK (neto >= 0 AND neto < 10000000000000000),
  iva            numeric(18,2) NOT NULL CONSTRAINT importe_por_alicuota_iva_ck CHECK (iva >= 0 AND iva < 10000000000000000),
  registrado_en  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT importe_por_alicuota_pkey PRIMARY KEY (empresa_id, comprobante_id, alicuota),
  CONSTRAINT importe_por_alicuota_comprobante_fkey FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante_de_proveedor (id, empresa_id)
);

CREATE TABLE tributo_de_comprobante (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  comprobante_id uuid NOT NULL,
  numero         integer NOT NULL CONSTRAINT tributo_numero_ck CHECK (numero >= 1),
  tipo           text NOT NULL CONSTRAINT tributo_tipo_ck CHECK (tipo IN ('PERCEPCION_IVA', 'PERCEPCION_OTROS_NACIONALES', 'PERCEPCION_INGRESOS_BRUTOS',
                   'PERCEPCION_MUNICIPAL', 'IMPUESTO_INTERNO', 'OTRO_TRIBUTO', 'PERCEPCION_SIN_CLASIFICAR')),
  descripcion    text CONSTRAINT tributo_descripcion_ck CHECK (descripcion IS NULL OR texto_de_catalogo_valido(descripcion, 80)),
  base_imponible numeric(18,2) CONSTRAINT tributo_base_ck CHECK (base_imponible >= 0 AND base_imponible < 10000000000000000),
  alicuota       numeric(5,2) CONSTRAINT tributo_alicuota_ck CHECK (alicuota >= 0 AND alicuota <= 100),
  importe        numeric(18,2) NOT NULL CONSTRAINT tributo_importe_ck CHECK (importe >= 0 AND importe < 10000000000000000),
  registrado_en  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tributo_de_comprobante_pkey PRIMARY KEY (empresa_id, comprobante_id, numero),
  CONSTRAINT tributo_comprobante_fkey FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante_de_proveedor (id, empresa_id),
  CONSTRAINT tributo_descripcion_otro_ck CHECK (tipo <> 'OTRO_TRIBUTO' OR descripcion IS NOT NULL)
);

CREATE TABLE saldo_de_linea_de_comprobante (
  empresa_id        uuid NOT NULL REFERENCES empresa (id),
  comprobante_id    uuid NOT NULL,
  numero            integer NOT NULL,
  cantidad_facturada numeric(18,4) NOT NULL CONSTRAINT saldo_de_linea_de_comprobante_facturada_ck CHECK (cantidad_facturada > 0 AND cantidad_facturada < 100000000000000),
  cantidad_asignada numeric(18,4) NOT NULL DEFAULT 0 CONSTRAINT saldo_de_linea_de_comprobante_asignada_ck CHECK (cantidad_asignada >= 0 AND cantidad_asignada < 100000000000000),
  CONSTRAINT saldo_de_linea_de_comprobante_pkey PRIMARY KEY (empresa_id, comprobante_id, numero),
  CONSTRAINT saldo_de_linea_de_comprobante_linea_fkey FOREIGN KEY (empresa_id, comprobante_id, numero) REFERENCES linea_de_comprobante (empresa_id, comprobante_id, numero),
  CONSTRAINT saldo_de_linea_de_comprobante_tope_ck CHECK (cantidad_asignada <= cantidad_facturada)
);

-- ================================================================================================
-- Conciliación atajo y sus asignaciones
-- ================================================================================================
CREATE TABLE conciliacion (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  acto               text NOT NULL CONSTRAINT conciliacion_acto_ck CHECK (acto IN ('CONCILIACION', 'ANULACION')),
  anula_a            uuid,
  comprobante_id     uuid NOT NULL,
  es_atajo           boolean NOT NULL DEFAULT false,
  nivel              text NOT NULL CONSTRAINT conciliacion_nivel_ck CHECK (nivel IN ('COMPRA_SIMPLE', 'CON_COMPROBANTE', 'RECEPCION_SEPARADA', 'TRES_VIAS')),
  clave_idempotencia text NOT NULL CONSTRAINT conciliacion_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  registrado_por     uuid NOT NULL REFERENCES persona (id),
  CONSTRAINT conciliacion_pkey PRIMARY KEY (id),
  CONSTRAINT conciliacion_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT conciliacion_id_acto_uk UNIQUE (id, empresa_id, acto),
  CONSTRAINT conciliacion_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  -- La anulación es el espejo, una sola vez.
  CONSTRAINT conciliacion_anula_a_uk UNIQUE (empresa_id, anula_a),
  CONSTRAINT conciliacion_comprobante_fkey FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante_de_proveedor (id, empresa_id),
  CONSTRAINT conciliacion_anula_a_fkey FOREIGN KEY (anula_a, empresa_id) REFERENCES conciliacion (id, empresa_id),
  CONSTRAINT conciliacion_anulacion_ck CHECK ((acto = 'ANULACION') = (anula_a IS NOT NULL))
);

CREATE TABLE asignacion_de_conciliacion (
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  conciliacion_id     uuid NOT NULL,
  acto                text NOT NULL,
  numero              integer NOT NULL CONSTRAINT asignacion_numero_ck CHECK (numero >= 1),
  comprobante_id      uuid NOT NULL,
  linea_de_comprobante integer NOT NULL,
  recepcion_id        uuid NOT NULL,
  linea_de_recepcion  integer NOT NULL,
  -- Positiva al conciliar, negativa en el espejo de la anulación.
  cantidad            numeric(18,4) NOT NULL CONSTRAINT asignacion_cantidad_ck CHECK (cantidad <> 0 AND cantidad > -100000000000000 AND cantidad < 100000000000000),
  CONSTRAINT asignacion_de_conciliacion_pkey PRIMARY KEY (empresa_id, conciliacion_id, numero),
  CONSTRAINT asignacion_conciliacion_fkey FOREIGN KEY (conciliacion_id, empresa_id, acto) REFERENCES conciliacion (id, empresa_id, acto),
  CONSTRAINT asignacion_linea_comprobante_fkey FOREIGN KEY (empresa_id, comprobante_id, linea_de_comprobante) REFERENCES linea_de_comprobante (empresa_id, comprobante_id, numero),
  CONSTRAINT asignacion_linea_recepcion_fkey FOREIGN KEY (empresa_id, recepcion_id, linea_de_recepcion) REFERENCES linea_de_recepcion (empresa_id, recepcion_id, numero),
  CONSTRAINT asignacion_signo_ck CHECK ((acto = 'CONCILIACION') = (cantidad > 0))
);

-- ================================================================================================
-- Pago mínimo de la factura (D142) y corrección por ajuste (D143)
-- ================================================================================================
CREATE TABLE pago_de_comprobante (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  comprobante_id     uuid NOT NULL,
  fecha_de_pago      date NOT NULL,
  medio              text NOT NULL CONSTRAINT pago_medio_ck CHECK (medio IN ('EFECTIVO', 'TARJETA_DEBITO', 'TARJETA_CREDITO', 'TRANSFERENCIA', 'QR', 'OTRO')),
  importe            numeric(18,2) NOT NULL CONSTRAINT pago_importe_ck CHECK (importe >= 0 AND importe < 10000000000000000),
  moneda             char(3) NOT NULL DEFAULT 'ARS' CONSTRAINT pago_moneda_ck CHECK (moneda = 'ARS'),
  estado             text NOT NULL DEFAULT 'VIGENTE' CONSTRAINT pago_estado_ck CHECK (estado IN ('VIGENTE', 'ANULADO')),
  clave_idempotencia text NOT NULL CONSTRAINT pago_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella             text NOT NULL CONSTRAINT pago_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  registrado_por     uuid NOT NULL REFERENCES persona (id),
  anulado_por        uuid REFERENCES persona (id),
  anulado_en         timestamptz,
  motivo_de_anulacion text CONSTRAINT pago_motivo_ck CHECK (motivo_de_anulacion IS NULL OR texto_de_catalogo_valido(motivo_de_anulacion, 500)),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT pago_de_comprobante_pkey PRIMARY KEY (id),
  CONSTRAINT pago_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT pago_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT pago_comprobante_fkey FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante_de_proveedor (id, empresa_id),
  CONSTRAINT pago_anulacion_ck CHECK ((estado = 'ANULADO') = (anulado_por IS NOT NULL AND anulado_en IS NOT NULL AND motivo_de_anulacion IS NOT NULL))
);
-- Un pago vigente por factura, sin parciales.
CREATE UNIQUE INDEX pago_vigente_uk ON pago_de_comprobante (empresa_id, comprobante_id) WHERE estado = 'VIGENTE';

CREATE TABLE correccion_de_compra (
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  recepcion_id       uuid NOT NULL,
  linea              integer NOT NULL,
  -- La versión optimista: dos correcciones de la misma línea a la vez, gana una.
  numero             integer NOT NULL CONSTRAINT correccion_de_compra_numero_ck CHECK (numero >= 1),
  precio_anterior    numeric(18,6) CONSTRAINT correccion_de_compra_precio_anterior_ck CHECK (precio_anterior > 0 AND precio_anterior < 10000000000000),
  precio_nuevo       numeric(18,6) CONSTRAINT correccion_de_compra_precio_nuevo_ck CHECK (precio_nuevo > 0 AND precio_nuevo < 10000000000000),
  cantidad_anterior  numeric(18,4) CONSTRAINT correccion_de_compra_cantidad_anterior_ck CHECK (cantidad_anterior > 0 AND cantidad_anterior < 100000000000000),
  cantidad_nueva     numeric(18,4) CONSTRAINT correccion_de_compra_cantidad_nueva_ck CHECK (cantidad_nueva > 0 AND cantidad_nueva < 100000000000000),
  motivo             text NOT NULL CONSTRAINT correccion_de_compra_motivo_ck CHECK (texto_de_catalogo_valido(motivo, 500)),
  clave_idempotencia text NOT NULL CONSTRAINT correccion_de_compra_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella             text NOT NULL CONSTRAINT correccion_de_compra_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  registrado_por     uuid NOT NULL REFERENCES persona (id),
  CONSTRAINT correccion_de_compra_pkey PRIMARY KEY (empresa_id, recepcion_id, linea, numero),
  CONSTRAINT correccion_de_compra_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT correccion_de_compra_linea_fkey FOREIGN KEY (empresa_id, recepcion_id, linea) REFERENCES linea_de_recepcion (empresa_id, recepcion_id, numero),
  CONSTRAINT correccion_de_compra_cambia_algo_ck CHECK (precio_nuevo IS NOT NULL OR cantidad_nueva IS NOT NULL)
);

-- ================================================================================================
-- Disparadores
-- ================================================================================================

-- Numeración, fecha de negocio y sello de la recepción (C2, C3).
CREATE FUNCTION compras_recepcion_preparar() RETURNS trigger LANGUAGE plpgsql
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
    RAISE EXCEPTION 'la sucursal de la recepción no existe' USING ERRCODE = '23503', CONSTRAINT = 'recepcion_sucursal_fkey';
  END IF;
  NEW.fecha_negocio := public.fecha_de_negocio(NEW.hecho_en, v_zona, v_corte);
  SELECT coalesce(max(r.numero), 0) + 1 INTO NEW.numero FROM public.recepcion r WHERE r.empresa_id = NEW.empresa_id;
  RETURN NEW;
END
$$;

-- La fecha de negocio del comprobante es la jornada civil de la empresa (sin hora de corte, S-7).
CREATE FUNCTION compras_comprobante_preparar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_zona text;
BEGIN
  NEW.registrado_en := now();
  SELECT e.zona_horaria INTO v_zona FROM public.empresa e WHERE e.id = NEW.empresa_id;
  NEW.fecha_negocio := (now() AT TIME ZONE v_zona)::date;
  RETURN NEW;
END
$$;

-- Solo cambian el estado y los datos de la anulación (C1): lo demás es inmutable. Los argumentos son las columnas que sí pueden cambiar.
CREATE FUNCTION compras_solo_cambia_estado() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_columnas text[] := TG_ARGV;
BEGIN
  IF (to_jsonb(NEW) - v_columnas) IS DISTINCT FROM (to_jsonb(OLD) - v_columnas) THEN
    RAISE EXCEPTION 'solo cambian el estado y la anulación: el resto es inmutable' USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_inmutable';
  END IF;
  IF NEW.estado <> OLD.estado AND NOT ((OLD.estado = 'CONFIRMADA' AND NEW.estado = 'ANULADA') OR (OLD.estado = 'REGISTRADO' AND NEW.estado = 'ANULADO')
       OR (OLD.estado = 'VIGENTE' AND NEW.estado = 'ANULADO')) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

-- Una línea (o un importe) solo entra en la MISMA transacción que su cabecera (C6).
CREATE FUNCTION compras_hija_en_la_transaccion_de_su_cabecera() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_ok boolean;
BEGIN
  EXECUTE format('SELECT c.registrado_en = now() FROM public.%I c WHERE c.id = $1 AND c.empresa_id = $2', TG_ARGV[0])
    INTO v_ok USING (to_jsonb(NEW) ->> TG_ARGV[1])::uuid, NEW.empresa_id;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'la línea solo entra en la transacción de su cabecera' USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_cabecera_confirmada';
  END IF;
  RETURN NEW;
END
$$;

-- El saldo de cada línea nace con la línea.
CREATE FUNCTION linea_de_recepcion_crear_saldo() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  INSERT INTO public.saldo_de_linea_de_recepcion (empresa_id, recepcion_id, numero, cantidad_recibida)
  VALUES (NEW.empresa_id, NEW.recepcion_id, NEW.numero, NEW.cantidad_en_stock);
  RETURN NEW;
END
$$;

CREATE FUNCTION linea_de_comprobante_crear_saldo() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  INSERT INTO public.saldo_de_linea_de_comprobante (empresa_id, comprobante_id, numero, cantidad_facturada)
  VALUES (NEW.empresa_id, NEW.comprobante_id, NEW.numero, NEW.cantidad_facturada);
  RETURN NEW;
END
$$;

-- Los saldos los escribe solo un disparador anidado (C5).
CREATE FUNCTION compras_saldo_solo_por_disparadores() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'el saldo de una línea lo escribe solo el disparador de las asignaciones' USING ERRCODE = '42501', CONSTRAINT = TG_TABLE_NAME || '_solo_por_disparadores';
  END IF;
  RETURN NEW;
END
$$;

-- Una asignación solo entra si el UPDATE condicionado de los dos saldos afecta una fila: lo asignado nunca supera lo recibido ni lo facturado (C5).
CREATE FUNCTION asignacion_aplicar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_filas integer;
BEGIN
  UPDATE public.saldo_de_linea_de_recepcion s SET cantidad_asignada = s.cantidad_asignada + NEW.cantidad
   WHERE s.empresa_id = NEW.empresa_id AND s.recepcion_id = NEW.recepcion_id AND s.numero = NEW.linea_de_recepcion
     AND s.cantidad_asignada + NEW.cantidad BETWEEN 0 AND s.cantidad_recibida;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'la cantidad asignada supera lo recibido' USING ERRCODE = '23514', CONSTRAINT = 'asignacion_excede_lo_recibido';
  END IF;
  UPDATE public.saldo_de_linea_de_comprobante s SET cantidad_asignada = s.cantidad_asignada + NEW.cantidad
   WHERE s.empresa_id = NEW.empresa_id AND s.comprobante_id = NEW.comprobante_id AND s.numero = NEW.linea_de_comprobante
     AND s.cantidad_asignada + NEW.cantidad BETWEEN 0 AND s.cantidad_facturada;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'la cantidad asignada supera lo facturado' USING ERRCODE = '23514', CONSTRAINT = 'asignacion_excede_lo_facturado';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER recepcion_preparar BEFORE INSERT ON recepcion FOR EACH ROW EXECUTE FUNCTION compras_recepcion_preparar();
CREATE TRIGGER recepcion_estado BEFORE UPDATE ON recepcion FOR EACH ROW
  EXECUTE FUNCTION compras_solo_cambia_estado('estado', 'anulada_por', 'anulada_en', 'motivo_de_anulacion', 'version', 'actualizado_en');
CREATE TRIGGER recepcion_version BEFORE UPDATE ON recepcion FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER comprobante_preparar BEFORE INSERT ON comprobante_de_proveedor FOR EACH ROW EXECUTE FUNCTION compras_comprobante_preparar();
CREATE TRIGGER comprobante_estado BEFORE UPDATE ON comprobante_de_proveedor FOR EACH ROW
  EXECUTE FUNCTION compras_solo_cambia_estado('estado', 'anulado_por', 'anulado_en', 'motivo_de_anulacion', 'version', 'actualizado_en');
CREATE TRIGGER comprobante_version BEFORE UPDATE ON comprobante_de_proveedor FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER pago_estado BEFORE UPDATE ON pago_de_comprobante FOR EACH ROW
  EXECUTE FUNCTION compras_solo_cambia_estado('estado', 'anulado_por', 'anulado_en', 'motivo_de_anulacion', 'version', 'actualizado_en');
CREATE TRIGGER pago_version BEFORE UPDATE ON pago_de_comprobante FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

CREATE TRIGGER linea_de_recepcion_cabecera BEFORE INSERT ON linea_de_recepcion FOR EACH ROW
  EXECUTE FUNCTION compras_hija_en_la_transaccion_de_su_cabecera('recepcion', 'recepcion_id');
CREATE TRIGGER linea_de_comprobante_cabecera BEFORE INSERT ON linea_de_comprobante FOR EACH ROW
  EXECUTE FUNCTION compras_hija_en_la_transaccion_de_su_cabecera('comprobante_de_proveedor', 'comprobante_id');
CREATE TRIGGER importe_por_alicuota_cabecera BEFORE INSERT ON importe_por_alicuota FOR EACH ROW
  EXECUTE FUNCTION compras_hija_en_la_transaccion_de_su_cabecera('comprobante_de_proveedor', 'comprobante_id');
CREATE TRIGGER tributo_cabecera BEFORE INSERT ON tributo_de_comprobante FOR EACH ROW
  EXECUTE FUNCTION compras_hija_en_la_transaccion_de_su_cabecera('comprobante_de_proveedor', 'comprobante_id');
CREATE TRIGGER linea_de_recepcion_saldo AFTER INSERT ON linea_de_recepcion FOR EACH ROW EXECUTE FUNCTION linea_de_recepcion_crear_saldo();
CREATE TRIGGER linea_de_comprobante_saldo AFTER INSERT ON linea_de_comprobante FOR EACH ROW EXECUTE FUNCTION linea_de_comprobante_crear_saldo();
CREATE TRIGGER saldo_de_linea_de_recepcion_guardia BEFORE INSERT OR UPDATE ON saldo_de_linea_de_recepcion FOR EACH ROW EXECUTE FUNCTION compras_saldo_solo_por_disparadores();
CREATE TRIGGER saldo_de_linea_de_comprobante_guardia BEFORE INSERT OR UPDATE ON saldo_de_linea_de_comprobante FOR EACH ROW EXECUTE FUNCTION compras_saldo_solo_por_disparadores();
CREATE TRIGGER asignacion_aplicar AFTER INSERT ON asignacion_de_conciliacion FOR EACH ROW EXECUTE FUNCTION asignacion_aplicar();

-- Versión y fecha de lo que se edita (ficha, listas, presentaciones, oferta, configuración, pedidos).
CREATE TRIGGER configuracion_de_compras_version BEFORE UPDATE ON configuracion_de_compras FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER ficha_version BEFORE UPDATE ON ficha_de_compra_del_proveedor FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER comprobante_de_la_ficha_version BEFORE UPDATE ON comprobante_de_la_ficha FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER punto_de_venta_de_la_ficha_version BEFORE UPDATE ON punto_de_venta_de_la_ficha FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER pedido_de_ficha_version BEFORE UPDATE ON pedido_de_ficha FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER presentacion_version BEFORE UPDATE ON presentacion_de_producto FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER oferta_version BEFORE UPDATE ON oferta_de_proveedor FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- Solo inserción (ni el dueño las modifica ni las borra): líneas, importes, tributos, conciliaciones, asignaciones y correcciones.
CREATE TRIGGER linea_de_recepcion_solo_insercion BEFORE UPDATE OR DELETE ON linea_de_recepcion FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER linea_de_comprobante_solo_insercion BEFORE UPDATE OR DELETE ON linea_de_comprobante FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER importe_por_alicuota_solo_insercion BEFORE UPDATE OR DELETE ON importe_por_alicuota FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER tributo_solo_insercion BEFORE UPDATE OR DELETE ON tributo_de_comprobante FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER conciliacion_solo_insercion BEFORE UPDATE OR DELETE ON conciliacion FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER asignacion_solo_insercion BEFORE UPDATE OR DELETE ON asignacion_de_conciliacion FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER correccion_solo_insercion BEFORE UPDATE OR DELETE ON correccion_de_compra FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER linea_de_recepcion_sin_truncate BEFORE TRUNCATE ON linea_de_recepcion FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER linea_de_comprobante_sin_truncate BEFORE TRUNCATE ON linea_de_comprobante FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER importe_por_alicuota_sin_truncate BEFORE TRUNCATE ON importe_por_alicuota FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER tributo_sin_truncate BEFORE TRUNCATE ON tributo_de_comprobante FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER conciliacion_sin_truncate BEFORE TRUNCATE ON conciliacion FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER asignacion_sin_truncate BEFORE TRUNCATE ON asignacion_de_conciliacion FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER correccion_sin_truncate BEFORE TRUNCATE ON correccion_de_compra FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- Nada se borra ni se vacía (ni el dueño): lo demás se anula, se desactiva o se reemplaza.
DO $$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['configuracion_de_compras', 'ficha_de_compra_del_proveedor', 'comprobante_de_la_ficha', 'punto_de_venta_de_la_ficha',
      'pedido_de_ficha', 'presentacion_de_producto', 'oferta_de_proveedor', 'recepcion', 'saldo_de_linea_de_recepcion', 'comprobante_de_proveedor',
      'saldo_de_linea_de_comprobante', 'pago_de_comprobante'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sin_borrado()', v_tabla || '_sin_borrado', v_tabla);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado()', v_tabla || '_sin_truncate', v_tabla);
  END LOOP;
END
$$;

-- ================================================================================================
-- Privilegios y RLS
-- ================================================================================================
REVOKE ALL ON configuracion_de_compras, ficha_de_compra_del_proveedor, comprobante_de_la_ficha, punto_de_venta_de_la_ficha, pedido_de_ficha,
  presentacion_de_producto, oferta_de_proveedor, recepcion, linea_de_recepcion, saldo_de_linea_de_recepcion, comprobante_de_proveedor,
  linea_de_comprobante, importe_por_alicuota, tributo_de_comprobante, saldo_de_linea_de_comprobante, conciliacion, asignacion_de_conciliacion,
  pago_de_comprobante, correccion_de_compra FROM PUBLIC;
GRANT SELECT ON configuracion_de_compras, ficha_de_compra_del_proveedor, comprobante_de_la_ficha, punto_de_venta_de_la_ficha, pedido_de_ficha,
  presentacion_de_producto, oferta_de_proveedor, recepcion, linea_de_recepcion, saldo_de_linea_de_recepcion, comprobante_de_proveedor,
  linea_de_comprobante, importe_por_alicuota, tributo_de_comprobante, saldo_de_linea_de_comprobante, conciliacion, asignacion_de_conciliacion,
  pago_de_comprobante, correccion_de_compra TO pedernal_app;

GRANT INSERT (empresa_id, nivel) ON configuracion_de_compras TO pedernal_app;
GRANT UPDATE (nivel) ON configuracion_de_compras TO pedernal_app;
GRANT INSERT (empresa_id, parte_id, letra_esperada) ON ficha_de_compra_del_proveedor TO pedernal_app;
GRANT UPDATE (letra_esperada) ON ficha_de_compra_del_proveedor TO pedernal_app;
GRANT INSERT (empresa_id, parte_id, tipo) ON comprobante_de_la_ficha TO pedernal_app;
GRANT UPDATE (activo) ON comprobante_de_la_ficha TO pedernal_app;
GRANT INSERT (empresa_id, parte_id, numero) ON punto_de_venta_de_la_ficha TO pedernal_app;
GRANT UPDATE (activo) ON punto_de_venta_de_la_ficha TO pedernal_app;
GRANT INSERT (id, empresa_id, parte_id, objeto, valor, pedido_por) ON pedido_de_ficha TO pedernal_app;
GRANT UPDATE (estado, resuelto_por, resuelto_en) ON pedido_de_ficha TO pedernal_app;
GRANT INSERT (id, empresa_id, producto_id, nombre, nombre_clave, cantidad, de_peso_variable) ON presentacion_de_producto TO pedernal_app;
GRANT UPDATE (nombre, nombre_clave, activa) ON presentacion_de_producto TO pedernal_app;
GRANT INSERT (empresa_id, proveedor_id, producto_id, presentacion_id, precio_por_tipo, unidad_de_precio_id, ultimo_precio,
  ultimo_costo_por_unidad_de_stock, ultima_compra_id, ultima_compra_en) ON oferta_de_proveedor TO pedernal_app;
GRANT UPDATE (precio_por_tipo, unidad_de_precio_id, ultimo_precio, ultimo_costo_por_unidad_de_stock, ultima_compra_id, ultima_compra_en)
  ON oferta_de_proveedor TO pedernal_app;
GRANT INSERT (id, empresa_id, sucursal_id, proveedor_id, nivel, es_atajo, remito_punto_de_venta, remito_numero, remito_fecha, hecho_en,
  clave_idempotencia, huella, registrado_por) ON recepcion TO pedernal_app;
GRANT UPDATE (estado, anulada_por, anulada_en, motivo_de_anulacion) ON recepcion TO pedernal_app;
GRANT INSERT (empresa_id, recepcion_id, numero, producto_id, presentacion_id, unidad_de_compra_id, cantidad_de_compra, de_peso_variable, peso_real,
  cantidad_en_stock, precio_por_tipo, unidad_de_precio_id, precio, importe, costo_por_unidad_de_stock, deposito_id, movimiento_id)
  ON linea_de_recepcion TO pedernal_app;
GRANT INSERT, UPDATE ON saldo_de_linea_de_recepcion, saldo_de_linea_de_comprobante TO pedernal_app;
GRANT INSERT (id, empresa_id, proveedor_id, clase, tipo, punto_de_venta, numero, fecha_del_comprobante, fecha_de_vencimiento_de_pago, neto_gravado,
  no_gravado, exento, iva, tributos_total, credito_fiscal_computable, total_calculado, total_segun_factura, proveedor_cuit, proveedor_razon_social,
  letra_no_esperada, nivel, es_atajo, clave_idempotencia, huella, registrado_por) ON comprobante_de_proveedor TO pedernal_app;
GRANT UPDATE (estado, anulado_por, anulado_en, motivo_de_anulacion) ON comprobante_de_proveedor TO pedernal_app;
GRANT INSERT (empresa_id, comprobante_id, numero, descripcion, unidad, cantidad_facturada, precio_neto, alicuota, neto_de_linea, iva_de_linea,
  recepcion_id, linea_de_recepcion) ON linea_de_comprobante TO pedernal_app;
GRANT INSERT (empresa_id, comprobante_id, alicuota, neto, iva) ON importe_por_alicuota TO pedernal_app;
GRANT INSERT (empresa_id, comprobante_id, numero, tipo, descripcion, base_imponible, alicuota, importe) ON tributo_de_comprobante TO pedernal_app;
GRANT INSERT (id, empresa_id, acto, anula_a, comprobante_id, es_atajo, nivel, clave_idempotencia, registrado_por) ON conciliacion TO pedernal_app;
GRANT INSERT (empresa_id, conciliacion_id, acto, numero, comprobante_id, linea_de_comprobante, recepcion_id, linea_de_recepcion, cantidad)
  ON asignacion_de_conciliacion TO pedernal_app;
GRANT INSERT (id, empresa_id, comprobante_id, fecha_de_pago, medio, importe, clave_idempotencia, huella, registrado_por) ON pago_de_comprobante TO pedernal_app;
GRANT UPDATE (estado, anulado_por, anulado_en, motivo_de_anulacion) ON pago_de_comprobante TO pedernal_app;
GRANT INSERT (empresa_id, recepcion_id, linea, numero, precio_anterior, precio_nuevo, cantidad_anterior, cantidad_nueva, motivo, clave_idempotencia, huella,
  registrado_por) ON correccion_de_compra TO pedernal_app;

DO $$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['configuracion_de_compras', 'ficha_de_compra_del_proveedor', 'comprobante_de_la_ficha', 'punto_de_venta_de_la_ficha',
      'pedido_de_ficha', 'presentacion_de_producto', 'oferta_de_proveedor', 'recepcion', 'linea_de_recepcion', 'saldo_de_linea_de_recepcion',
      'comprobante_de_proveedor', 'linea_de_comprobante', 'importe_por_alicuota', 'tributo_de_comprobante', 'saldo_de_linea_de_comprobante',
      'conciliacion', 'asignacion_de_conciliacion', 'pago_de_comprobante', 'correccion_de_compra'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()))', v_tabla || '_app_leer', v_tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO pedernal_app WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))',
      v_tabla || '_app_alta', v_tabla);
    -- Los que se actualizan (estados, listas, saldos): la misma regla.
    IF v_tabla IN ('configuracion_de_compras', 'ficha_de_compra_del_proveedor', 'comprobante_de_la_ficha', 'punto_de_venta_de_la_ficha', 'pedido_de_ficha',
        'presentacion_de_producto', 'oferta_de_proveedor', 'recepcion', 'saldo_de_linea_de_recepcion', 'comprobante_de_proveedor',
        'saldo_de_linea_de_comprobante', 'pago_de_comprobante') THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
        WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))', v_tabla || '_app_cambiar', v_tabla);
    END IF;
  END LOOP;
END
$$;
