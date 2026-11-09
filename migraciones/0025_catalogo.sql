-- 0025_catalogo: el catálogo mínimo para vender en el mostrador (E2 mínimo): la ficha única de producto con sus cinco clases, las
-- secciones de la carta, los grupos de opciones propios de cada producto con su única variante (el tamaño), la versión de cada opción
-- con lo que consume, el precio de venta (de la empresa y propio de cada sucursal) con su historial, y el registro de «copiar de otro
-- producto». Más la tabla global de unidades de medida, sembrada con la lista de `src/primitivas/unidades/unidades.ts`.
-- Especificación: Pedernal-docs/11-especificaciones/e2-catalogo-minimo-especificacion.md (§3.1 a §3.8) y decisiones 69, 71, 72, 82, 131,
-- 133, 138, 139, 147, 157, 159, 162, 166, 169 y 175 de catalogo-y-niveles-maqueta.md.
--
-- Reglas de esta migración (las mismas de 0001 a 0024):
--  * Es la PRIMERA migración del catálogo: no hay ninguna tabla de catálogo que migrar (0001 a 0024 no crean ninguna con producto, precio,
--    opción ni unidad), así que nace con la forma final: no hay `ALTER` ni copia de datos. Se comprueba al empezar y se frena con un
--    error claro si alguna de estas tablas ya existe (alguien la habría creado a mano).
--  * No agrega NINGUNA función SECURITY DEFINER. Toda función fija `search_path = pg_catalog, public, pg_temp`, califica sus tablas con
--    `public.` y nace sin EXECUTE para PUBLIC. Solo se otorgan a la aplicación las que se llaman fuera de un disparador:
--    `texto_de_catalogo_valido` (la usan los CHECK, que corren con los permisos de quien escribe) y `precio_vigente` (la consulta).
--  * Nadie recibe DELETE ni TRUNCATE (retención: decisión 11 abierta). Una fila de catálogo no se borra: se desactiva o, si es de solo
--    inserción, se reemplaza por otra más nueva. Los disparadores frenan el borrado y el vaciado aun al dueño de la base.
--  * RLS activa y FORZADA en toda tabla nueva; una política por comando, ninguna `FOR ALL`. INSERT y UPDATE por columna. Los demás roles
--    (plataforma, grupo, trabajos, público, captación, autenticación) no reciben nada: la carta pública es de su etapa.
--  * Toda única de una tabla con `empresa_id` lo incluye, y toda clave foránea entre tablas de empresa es COMPUESTA `(x_id, empresa_id)`:
--    una fila no puede apuntar a otra empresa.
--  * Dinero en `numeric` exacto (precio y recargo `numeric(18,6)`, cantidad y paso `numeric(18,4)`), nunca flotantes, con moneda
--    explícita (`ARS`) y IVA incluido; todo importe lleva una cota superior porque `numeric` acepta `NaN`, que es mayor que cualquier
--    número y pasaría un `>= 0` (la trampa de 0009, D11).
--  * Los textos se validan con una LISTA DE PERMITIDOS (`texto_de_catalogo_valido`, la misma de `src/primitivas/texto/texto-de-una-linea.ts`),
--    no con una lista de prohibidos. Una prueba compara la función con la primitiva carácter por carácter.
--  * Su reversión es un script aparte, revisado y DESTRUCTIVO si hay datos: `migraciones/reversiones/0025_revertir_catalogo.sql`. El
--    ejecutor no lo aplica y frena si alguna tabla tiene filas (salvo confirmación explícita).
--  * DEPENDE de 0001 (`fijar_version_y_fecha`, `solo_insercion`, `empresa_operable`), de 0005 (la sucursal con `UNIQUE (id, empresa_id)`)
--    y de 0007 (`sin_borrado`); se comprueba al empezar.
--
-- Decisiones de diseño (todas probadas por tests):
--
--  K1. `producto` es una sola ficha con cinco clases (materia prima, insumo, reventa, elaborado, producto vendible; decisión 131). La clase,
--      la unidad base, la dimensión y el tipo NO cambian después del alta: lo impone un disparador aun contra el dueño de la base. Lo que
--      cada clase pide y prohíbe lo hacen cumplir los CHECK, no la pantalla.
--  K2. `se_vende` es una columna GENERADA: vende quien es de clase que vende (producto vendible o reventa), tiene alícuota y no está «Falta
--      completar». No se escribe, así que no hay estado inválido. La alícuota de IVA no tiene valor por defecto (es decisión fiscal).
--  K3. La FORMA DE VENTA es del producto (decisión 166): `unidad_de_venta_id` (de su misma dimensión, FK compuesta) y `paso_minimo`
--      (decimal exacto, 1 en el piloto). No hay un CHECK que limite lo vendible a unidades enteras (decisión 162): pasar a fracciones o a
--      peso es un cambio de DATOS. El paso, llevado a la unidad base, tiene que caber exacto en 4 decimales (`producto_paso_no_exacto`).
--  K4. A lo sumo UNA variante activa por producto (índice único parcial; decisión 138). Un grupo es propio de un producto (decisión 133):
--      su opción lo es por construcción (clave foránea compuesta con el producto).
--  K5. `precio_de_venta` y `version_de_opcion` son de SOLO INSERCIÓN: cambiar un precio es insertar una fila nueva. El precio vigente a un
--      instante es la fila de mayor `vigente_desde` (`precio_vigente`, el único lector). `vigente_desde` es estrictamente creciente por
--      (producto, opción, sucursal) (`precio_fuera_de_orden`): un pedido que arrancó antes pero esperó el bloqueo no queda «detrás» de otro
--      ya confirmado. La fila guarda una COPIA de la unidad y el paso con que se cargó (historial y tickets viejos no cambian) y el
--      disparador exige que coincidan con los del producto en ese momento (`precio_forma_de_venta_distinta`).
--  K6. `precio` NULL significa, con `sucursal_id`, «esta sucursal vuelve al precio (o al recargo) de la empresa» sin borrar nada y, sin
--      `sucursal_id`, «precio abierto» explícito (decisión 169). El recargo de la EMPRESA de una opción vive en `version_de_opcion.recargo`;
--      en `precio_de_venta` solo hay recargo propio de una sucursal sobre una opción de un grupo ADICIONAL (decisión 159).
--  K7. El consumo de una opción (decisión 139) cuelga de su VERSIÓN y solo se inserta en la misma transacción que la versión (`xmin`): lo
--      que una versión consume, una vez confirmada, no cambia nunca. Es solo dato: ningún objeto de stock lo lee en esta etapa. El
--      chequeo compara el `xmin` de la versión con la transacción actual: una escritura hecha dentro de un SAVEPOINT revertido tiene
--      el de una subtransacción y se rechaza (falla cerrado). El ejecutor de transacciones de la aplicación no usa savepoints.
--  K8. Una elección oculta (grupo que no se muestra en la carta) no puede cambiar el precio (supuesto de la decisión 82, sin confirmar):
--      su recargo es 0 (`version_de_opcion_eleccion_oculta_con_precio`) y no admite recargo propio de sucursal.

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.sucursal') IS NULL OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL
     OR to_regprocedure('public.solo_insercion()') IS NULL OR to_regprocedure('public.empresa_operable(uuid)') IS NULL THEN
    RAISE EXCEPTION 'el catálogo requiere 0001 y 0005 aplicadas antes (faltan la sucursal y las funciones base)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.sin_borrado()') IS NULL THEN
    RAISE EXCEPTION 'el catálogo requiere 0007_marcas_y_planes aplicada antes (falta sin_borrado())'
      USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['unidad_de_medida', 'seccion_de_carta', 'producto', 'grupo_de_elecciones', 'opcion',
                                 'version_de_opcion', 'consumo_de_opcion', 'precio_de_venta', 'copia_de_opciones'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'el catálogo nace en 0025: la tabla % ya existe (alguien la creó a mano); hay que revisarla antes de migrar', v_tabla
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Validación de textos: lista de PERMITIDOS (la de `texto-de-una-linea.ts`). Una sola línea, sin blancos en los extremos, de 1 a
-- `p_maximo` caracteres, con letras latinas, dígitos, espacio y los signos de la lista; el primer carácter no es `+` ni `-`.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION texto_de_catalogo_valido(t text, p_maximo integer) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN t IS NULL OR p_maximo IS NULL OR char_length(t) NOT BETWEEN 1 AND p_maximo THEN false
    ELSE t = btrim(t)
      AND t ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°:;"#ºª’“”–—«»®™''][A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°+:;"#ºª’“”–—«»®™'' -]*$'
  END
$$;
GRANT EXECUTE ON FUNCTION texto_de_catalogo_valido(text, integer) TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- Unidades de medida: global, sembrada, solo inserción (como `provincia`). `factor_a_base` = cuántas unidades base de su dimensión entran
-- en esta (entero). Los factores no cambian nunca: cambiar uno revaluaría en silencio toda la historia. Una prueba compara esta tabla con
-- `UNIDADES` de `src/primitivas/unidades/unidades.ts`.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE unidad_de_medida (
  id            text PRIMARY KEY CONSTRAINT unidad_id_ck CHECK (id ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  dimension     text NOT NULL CONSTRAINT unidad_dimension_ck
                CHECK (dimension IN ('CONTEO', 'MASA', 'LONGITUD', 'SUPERFICIE', 'VOLUMEN', 'TIEMPO')),
  simbolo       text NOT NULL CONSTRAINT unidad_simbolo_ck CHECK (simbolo ~ '^[A-Za-z0-9]{1,8}$'),
  factor_a_base bigint NOT NULL CONSTRAINT unidad_factor_ck CHECK (factor_a_base > 0),
  es_base       boolean NOT NULL,
  CONSTRAINT unidad_base_ck CHECK (es_base = (factor_a_base = 1)),
  CONSTRAINT unidad_simbolo_uk UNIQUE (simbolo),
  CONSTRAINT unidad_id_dimension_uk UNIQUE (id, dimension)  -- destino de las FK que fijan la dimensión
);
CREATE UNIQUE INDEX unidad_una_base_uk ON unidad_de_medida (dimension) WHERE es_base;
INSERT INTO unidad_de_medida (id, dimension, simbolo, factor_a_base, es_base) VALUES
  ('UNIDAD', 'CONTEO', 'u', 1, true),
  ('GRAMO', 'MASA', 'g', 1, true), ('KILOGRAMO', 'MASA', 'kg', 1000, false), ('TONELADA', 'MASA', 't', 1000000, false),
  ('MILILITRO', 'VOLUMEN', 'ml', 1, true), ('LITRO', 'VOLUMEN', 'l', 1000, false),
  ('METRO_CUBICO', 'VOLUMEN', 'm3', 1000000, false),
  ('MILIMETRO', 'LONGITUD', 'mm', 1, true), ('CENTIMETRO', 'LONGITUD', 'cm', 10, false), ('METRO', 'LONGITUD', 'm', 1000, false),
  ('CENTIMETRO_CUADRADO', 'SUPERFICIE', 'cm2', 1, true), ('METRO_CUADRADO', 'SUPERFICIE', 'm2', 10000, false),
  ('MINUTO', 'TIEMPO', 'min', 1, true), ('HORA', 'TIEMPO', 'h', 60, false);

-- ---------------------------------------------------------------------------------------------
-- Sección de la carta: la lista de secciones de la empresa; el producto elige una. El orden y los textos «se arman en la pantalla de
-- identidad de la carta»: acá solo se guarda el nombre y el orden.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE seccion_de_carta (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la idempotencia del alta
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  nombre         text NOT NULL CONSTRAINT seccion_de_carta_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 80)),
  nombre_clave   text NOT NULL CONSTRAINT seccion_de_carta_nombre_clave_ck CHECK (char_length(nombre_clave) BETWEEN 1 AND 240),
  orden          integer NOT NULL CONSTRAINT seccion_de_carta_orden_ck CHECK (orden BETWEEN 0 AND 100000),
  activa         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT seccion_de_carta_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT seccion_de_carta_nombre_uk UNIQUE (empresa_id, nombre_clave)
);

-- ---------------------------------------------------------------------------------------------
-- Producto: la ficha única. Todo producto tiene SIEMPRE una unidad base (la unidad en que se mide y se cuenta).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE producto (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la idempotencia del alta
  empresa_id           uuid NOT NULL REFERENCES empresa (id),
  nombre               text NOT NULL CONSTRAINT producto_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 120)),
  nombre_clave         text NOT NULL CONSTRAINT producto_nombre_clave_ck CHECK (char_length(nombre_clave) BETWEEN 1 AND 360),
  nombre_de_cocina     text CONSTRAINT producto_nombre_de_cocina_ck CHECK (nombre_de_cocina IS NULL OR texto_de_catalogo_valido(nombre_de_cocina, 80)),
  descripcion_en_carta text CONSTRAINT producto_descripcion_ck CHECK (descripcion_en_carta IS NULL OR texto_de_catalogo_valido(descripcion_en_carta, 300)),
  codigo               text CONSTRAINT producto_codigo_ck CHECK (codigo ~ '^[A-Za-z0-9._-]{1,40}$'),
  codigo_de_barras     text CONSTRAINT producto_codigo_de_barras_ck CHECK (codigo_de_barras ~ '^[0-9]{8,14}$'),
  tipo                 text NOT NULL CONSTRAINT producto_tipo_ck CHECK (tipo = 'BIEN'),
  clase_de_uso         text NOT NULL CONSTRAINT producto_clase_de_uso_ck
                       CHECK (clase_de_uso IN ('MATERIA_PRIMA', 'INSUMO', 'REVENTA', 'ELABORADO', 'VENDIBLE')),
  unidad_base_id       text NOT NULL,
  dimension            text NOT NULL,                              -- copia de la dimensión de la unidad, fijada por las FK
  unidad_de_venta_id   text NOT NULL,
  paso_minimo          numeric(18,4) NOT NULL DEFAULT 1 CONSTRAINT producto_paso_ck CHECK (paso_minimo > 0),
  alicuota_iva         text CONSTRAINT producto_alicuota_ck
                       CHECK (alicuota_iva IN ('0', '2.5', '5', '10.5', '21', '27', 'EXENTO', 'NO_GRAVADO')),
  falta_completar      boolean NOT NULL DEFAULT false,
  se_vende             boolean GENERATED ALWAYS AS (
                         clase_de_uso IN ('VENDIBLE', 'REVENTA') AND alicuota_iva IS NOT NULL AND NOT falta_completar) STORED,
  seccion_de_carta_id  uuid,
  activo               boolean NOT NULL DEFAULT true,
  version_de_opciones  integer NOT NULL DEFAULT 0,
  creado_por           uuid REFERENCES persona (id),
  creado_en            timestamptz NOT NULL DEFAULT now(),
  actualizado_en       timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  CONSTRAINT producto_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT producto_unidad_fkey FOREIGN KEY (unidad_base_id, dimension) REFERENCES unidad_de_medida (id, dimension),
  -- La unidad en que se vende es de la MISMA dimensión que el producto (166): no hay venta de un jugo «por metro».
  CONSTRAINT producto_unidad_de_venta_fkey FOREIGN KEY (unidad_de_venta_id, dimension) REFERENCES unidad_de_medida (id, dimension),
  CONSTRAINT producto_seccion_fkey FOREIGN KEY (seccion_de_carta_id, empresa_id) REFERENCES seccion_de_carta (id, empresa_id),
  -- Lo que cada clase prohíbe (decisión 131): sin alícuota, sección, nombre de cocina ni descripción si no vende.
  CONSTRAINT producto_clase_sin_venta_ck CHECK (
    clase_de_uso IN ('VENDIBLE', 'REVENTA')
    OR (alicuota_iva IS NULL AND seccion_de_carta_id IS NULL AND nombre_de_cocina IS NULL AND descripcion_en_carta IS NULL)),
  -- Un producto que no vende conserva la forma de venta de la alta (unidad base, paso 1). No hay CHECK que limite lo vendible a
  -- unidades enteras: pasar a fracciones o a peso no exige migración (162).
  CONSTRAINT producto_forma_de_venta_sin_venta_ck CHECK (
    clase_de_uso IN ('VENDIBLE', 'REVENTA') OR (unidad_de_venta_id = unidad_base_id AND paso_minimo = 1)),
  -- Una cota: `numeric` acepta NaN, que pasaría `> 0`.
  CONSTRAINT producto_paso_cota_ck CHECK (paso_minimo < 100000000000000)
);
CREATE UNIQUE INDEX producto_nombre_uk ON producto (empresa_id, nombre_clave);
CREATE UNIQUE INDEX producto_codigo_uk ON producto (empresa_id, codigo) WHERE codigo IS NOT NULL;
CREATE UNIQUE INDEX producto_codigo_de_barras_uk ON producto (empresa_id, codigo_de_barras) WHERE codigo_de_barras IS NOT NULL;
CREATE INDEX producto_busqueda_ix ON producto (empresa_id, nombre_clave text_pattern_ops);
CREATE INDEX producto_clase_ix ON producto (empresa_id, clase_de_uso);
CREATE INDEX producto_falta_completar_ix ON producto (empresa_id) WHERE falta_completar;

-- ---------------------------------------------------------------------------------------------
-- Grupo de elecciones: propio de un producto (133). clase: VARIANTE (el tamaño; a lo sumo una activa) · INCLUIDA (sin recargo) ·
-- ADICIONAL (con recargo). La clase no cambia después de crear.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE grupo_de_elecciones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  producto_id         uuid NOT NULL,
  clase               text NOT NULL CONSTRAINT grupo_de_elecciones_clase_ck CHECK (clase IN ('VARIANTE', 'INCLUIDA', 'ADICIONAL')),
  es_tamano           boolean NOT NULL DEFAULT false,
  nombre              text NOT NULL CONSTRAINT grupo_de_elecciones_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 80)),
  nombre_clave        text NOT NULL CONSTRAINT grupo_de_elecciones_nombre_clave_ck CHECK (char_length(nombre_clave) BETWEEN 1 AND 240),
  es_obligatorio      boolean NOT NULL,
  admite_varias       boolean NOT NULL,
  -- Decisión 157 (a favor de la 82): un grupo nace oculto. El CHECK de la variante exige `true`: el comando lo manda así al crearla.
  se_muestra_en_carta boolean NOT NULL DEFAULT false,
  orden               integer NOT NULL CONSTRAINT grupo_de_elecciones_orden_ck CHECK (orden BETWEEN 0 AND 100000),
  activo              boolean NOT NULL DEFAULT true,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT grupo_de_elecciones_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT grupo_de_elecciones_id_producto_uk UNIQUE (id, producto_id, empresa_id),  -- destino de la opción: es del mismo producto
  CONSTRAINT grupo_de_elecciones_nombre_uk UNIQUE (empresa_id, producto_id, nombre_clave),
  CONSTRAINT grupo_de_elecciones_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT grupo_de_elecciones_tamano_ck CHECK (NOT es_tamano OR clase = 'VARIANTE'),
  -- La variante es obligatoria, de una sola elección y figura en la carta.
  CONSTRAINT grupo_de_elecciones_variante_ck CHECK (clase <> 'VARIANTE' OR (es_obligatorio AND NOT admite_varias AND se_muestra_en_carta))
);
-- Una sola variante activa por producto (138).
CREATE UNIQUE INDEX grupo_de_elecciones_variante_uk ON grupo_de_elecciones (empresa_id, producto_id)
  WHERE clase = 'VARIANTE' AND activo;

CREATE TABLE opcion (                                   -- identidad de la opción; lo que se vende está en su versión
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  producto_id    uuid NOT NULL,
  grupo_id       uuid NOT NULL,
  nombre_clave   text NOT NULL CONSTRAINT opcion_nombre_clave_ck CHECK (char_length(nombre_clave) BETWEEN 1 AND 240),
  orden          integer NOT NULL CONSTRAINT opcion_orden_ck CHECK (orden BETWEEN 0 AND 100000),
  activa         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT opcion_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT opcion_id_producto_uk UNIQUE (id, producto_id, empresa_id),  -- destino del precio: la opción es del producto
  CONSTRAINT opcion_nombre_uk UNIQUE (empresa_id, grupo_id, nombre_clave),
  -- La opción es del mismo producto que su grupo, por construcción.
  CONSTRAINT opcion_grupo_fkey FOREIGN KEY (grupo_id, producto_id, empresa_id) REFERENCES grupo_de_elecciones (id, producto_id, empresa_id)
);

CREATE TABLE version_de_opcion (                        -- solo inserción; vale la de mayor numero
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresa (id),
  opcion_id        uuid NOT NULL,
  numero           integer NOT NULL CONSTRAINT version_de_opcion_numero_ck CHECK (numero > 0),
  nombre           text NOT NULL CONSTRAINT version_de_opcion_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 80)),
  recargo          numeric(18,6) NOT NULL DEFAULT 0 CONSTRAINT version_de_opcion_recargo_ck CHECK (recargo >= 0 AND recargo < 1000000000000),
  moneda           char(3) NOT NULL DEFAULT 'ARS' CONSTRAINT version_de_opcion_moneda_ck CHECK (moneda = 'ARS'),
  iva_incluido     boolean NOT NULL DEFAULT true CONSTRAINT version_de_opcion_iva_incluido_ck CHECK (iva_incluido),
  -- Cuánto escala con el tamaño lo que consume (139): 1 para el chico, 1,5 para el grande. Solo en opciones de la variante de tamaño.
  factor_de_tamano numeric(7,4) NOT NULL DEFAULT 1 CONSTRAINT version_de_opcion_factor_ck CHECK (factor_de_tamano > 0 AND factor_de_tamano <= 100),
  cargada_por      uuid REFERENCES persona (id),
  creado_en        timestamptz NOT NULL,                  -- `ahora` del contexto
  CONSTRAINT version_de_opcion_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT version_de_opcion_opcion_fkey FOREIGN KEY (opcion_id, empresa_id) REFERENCES opcion (id, empresa_id),
  CONSTRAINT version_de_opcion_numero_uk UNIQUE (empresa_id, opcion_id, numero)
);

CREATE TABLE consumo_de_opcion (                        -- solo inserción; solo dato (139): ningún objeto de stock lo lee
  empresa_id           uuid NOT NULL REFERENCES empresa (id),
  version_de_opcion_id uuid NOT NULL,
  numero               smallint NOT NULL CONSTRAINT consumo_de_opcion_numero_ck CHECK (numero > 0),
  insumo_id            uuid NOT NULL,
  -- En la unidad base del insumo (no hay columna de unidad).
  cantidad             numeric(18,4) NOT NULL CONSTRAINT consumo_de_opcion_cantidad_ck CHECK (cantidad > 0 AND cantidad < 100000000000000),
  escala_con_tamano    boolean NOT NULL DEFAULT false,
  CONSTRAINT consumo_de_opcion_pkey PRIMARY KEY (empresa_id, version_de_opcion_id, numero),
  CONSTRAINT consumo_de_opcion_insumo_uk UNIQUE (empresa_id, version_de_opcion_id, insumo_id),
  CONSTRAINT consumo_de_opcion_version_fkey FOREIGN KEY (version_de_opcion_id, empresa_id) REFERENCES version_de_opcion (id, empresa_id),
  CONSTRAINT consumo_de_opcion_insumo_fkey FOREIGN KEY (insumo_id, empresa_id) REFERENCES producto (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- Precio de venta: solo inserción. Dueño de la fila: el producto (`opcion_id` nulo) o una opción suya; alcance: la empresa
-- (`sucursal_id` nulo) o una sucursal. Ver K5 y K6.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE precio_de_venta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la clave de idempotencia del cambio
  empresa_id    uuid NOT NULL REFERENCES empresa (id),
  producto_id   uuid NOT NULL,
  opcion_id     uuid,
  sucursal_id   uuid,
  precio        numeric(18,6) CONSTRAINT precio_de_venta_precio_ck CHECK (precio >= 0 AND precio < 1000000000000),
  unidad_id     text NOT NULL REFERENCES unidad_de_medida (id),
  paso_minimo   numeric(18,4) NOT NULL CONSTRAINT precio_de_venta_paso_ck CHECK (paso_minimo > 0 AND paso_minimo < 100000000000000),
  moneda        char(3) NOT NULL DEFAULT 'ARS' CONSTRAINT precio_de_venta_moneda_ck CHECK (moneda = 'ARS'),
  iva_incluido  boolean NOT NULL DEFAULT true CONSTRAINT precio_de_venta_iva_incluido_ck CHECK (iva_incluido),
  vigente_desde timestamptz NOT NULL,                  -- `ahora` del contexto (o 1 µs después de la última fila: K5)
  cargado_por   uuid REFERENCES persona (id),
  creado_en     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT precio_de_venta_id_empresa_uk UNIQUE (id, empresa_id),    -- destino de la línea del ticket (precioId)
  CONSTRAINT precio_de_venta_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT precio_de_venta_opcion_fkey FOREIGN KEY (opcion_id, producto_id, empresa_id) REFERENCES opcion (id, producto_id, empresa_id),
  CONSTRAINT precio_de_venta_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT precio_de_venta_vigencia_uk UNIQUE NULLS NOT DISTINCT (empresa_id, producto_id, opcion_id, sucursal_id, vigente_desde)
);
CREATE INDEX precio_de_venta_vigente_ix ON precio_de_venta (empresa_id, producto_id, opcion_id, sucursal_id, vigente_desde DESC);

CREATE TABLE copia_de_opciones (                        -- solo inserción: la clave de idempotencia de «Copiar de otro producto»
  id                  uuid NOT NULL,                    -- lo manda la app
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  producto_origen_id  uuid NOT NULL,
  producto_destino_id uuid NOT NULL,
  creado_por          uuid REFERENCES persona (id),
  creado_en           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copia_de_opciones_pkey PRIMARY KEY (empresa_id, id),
  CONSTRAINT copia_de_opciones_distintos_ck CHECK (producto_origen_id <> producto_destino_id),
  CONSTRAINT copia_de_opciones_origen_fkey FOREIGN KEY (producto_origen_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT copia_de_opciones_destino_fkey FOREIGN KEY (producto_destino_id, empresa_id) REFERENCES producto (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- Disparadores: invariantes que la base impone aunque el código se olvide
-- ---------------------------------------------------------------------------------------------

-- Producto: lo que no cambia (clase, unidad base, dimensión, tipo, empresa) y el paso exacto. Los nombres se eligen para que
-- `_validar` corra antes que `_version` (orden alfabético).
CREATE FUNCTION producto_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_factor_venta bigint;
  v_factor_base bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.clase_de_uso IS DISTINCT FROM OLD.clase_de_uso THEN
      RAISE EXCEPTION 'la clase de un producto no cambia después del alta'
        USING ERRCODE = '23514', CONSTRAINT = 'producto_clase_de_uso_inmutable';
    END IF;
    IF NEW.unidad_base_id IS DISTINCT FROM OLD.unidad_base_id OR NEW.dimension IS DISTINCT FROM OLD.dimension THEN
      RAISE EXCEPTION 'la unidad base de un producto no cambia después del alta'
        USING ERRCODE = '23514', CONSTRAINT = 'producto_unidad_inmutable';
    END IF;
    IF NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'el tipo, la empresa y el id de un producto no cambian'
        USING ERRCODE = '23514', CONSTRAINT = 'producto_identidad_inmutable';
    END IF;
  END IF;
  -- El paso, llevado a la unidad base, tiene que caber exacto en 4 decimales: así toda cantidad válida convierte exacta (162, 166).
  SELECT factor_a_base INTO v_factor_venta FROM public.unidad_de_medida WHERE id = NEW.unidad_de_venta_id;
  SELECT factor_a_base INTO v_factor_base FROM public.unidad_de_medida WHERE id = NEW.unidad_base_id;
  IF v_factor_venta IS NOT NULL AND v_factor_base IS NOT NULL THEN
    -- `paso_minimo * 10000` es entero (4 decimales): el paso en base es `paso * v_factor_venta / v_factor_base`.
    IF ((NEW.paso_minimo * 10000) * v_factor_venta) % v_factor_base <> 0
       OR NEW.paso_minimo * v_factor_venta / v_factor_base >= 100000000000000 THEN
      RAISE EXCEPTION 'el paso mínimo no se puede llevar exacto a la unidad base con 4 decimales'
        USING ERRCODE = '23514', CONSTRAINT = 'producto_paso_no_exacto';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Grupo: solo de un producto que vende, y la clase y el producto no cambian.
CREATE FUNCTION grupo_de_elecciones_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.clase IS DISTINCT FROM OLD.clase OR NEW.producto_id IS DISTINCT FROM OLD.producto_id
       OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
      RAISE EXCEPTION 'la clase y el producto de un grupo no cambian después de crearlo'
        USING ERRCODE = '23514', CONSTRAINT = 'grupo_de_elecciones_inmutable';
    END IF;
    RETURN NEW;
  END IF;
  SELECT p.clase_de_uso INTO v_clase FROM public.producto p WHERE p.id = NEW.producto_id AND p.empresa_id = NEW.empresa_id;
  IF v_clase IS NOT NULL AND v_clase NOT IN ('VENDIBLE', 'REVENTA') THEN
    RAISE EXCEPTION 'solo un producto que se vende tiene grupos de opciones'
      USING ERRCODE = '23514', CONSTRAINT = 'grupo_de_producto_no_vendible';
  END IF;
  RETURN NEW;
END
$$;

-- Opción: el grupo y el producto no cambian (el UPDATE por columna ya no los otorga; esto es contra el dueño de la base).
CREATE FUNCTION opcion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.grupo_id IS DISTINCT FROM OLD.grupo_id OR NEW.producto_id IS DISTINCT FROM OLD.producto_id
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'el grupo y el producto de una opción no cambian'
      USING ERRCODE = '23514', CONSTRAINT = 'opcion_inmutable';
  END IF;
  RETURN NEW;
END
$$;

-- Versión de opción: el recargo solo en un adicional que se muestra en la carta (K8), el factor solo en la variante de tamaño, y el
-- número es el siguiente (así «vale la de mayor número» está bien definido y dos versiones simultáneas chocan en la única).
CREATE FUNCTION version_de_opcion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_es_tamano boolean;
  v_se_muestra boolean;
  v_anterior integer;
BEGIN
  SELECT g.clase, g.es_tamano, g.se_muestra_en_carta INTO v_clase, v_es_tamano, v_se_muestra
    FROM public.opcion o
    JOIN public.grupo_de_elecciones g ON g.id = o.grupo_id AND g.empresa_id = o.empresa_id
   WHERE o.id = NEW.opcion_id AND o.empresa_id = NEW.empresa_id;
  IF v_clase IS NULL THEN
    RETURN NEW;  -- la clave foránea rechaza la opción que no existe o es de otra empresa
  END IF;
  IF NEW.recargo <> 0 AND v_clase IN ('INCLUIDA', 'VARIANTE') THEN
    RAISE EXCEPTION 'una opción incluida o de la variante no lleva recargo (el precio del tamaño sale de precio_de_venta)'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_opcion_incluida_con_recargo';
  END IF;
  IF NEW.recargo <> 0 AND NOT v_se_muestra THEN
    RAISE EXCEPTION 'una elección que no se muestra en la carta no puede cambiar el precio'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_opcion_eleccion_oculta_con_precio';
  END IF;
  IF NEW.factor_de_tamano <> 1 AND NOT (v_clase = 'VARIANTE' AND v_es_tamano) THEN
    RAISE EXCEPTION 'el factor de tamaño solo existe en las opciones de la variante de tamaño'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_opcion_factor_sin_tamano';
  END IF;
  SELECT coalesce(max(v.numero), 0) INTO v_anterior
    FROM public.version_de_opcion v WHERE v.empresa_id = NEW.empresa_id AND v.opcion_id = NEW.opcion_id;
  IF NEW.numero <> v_anterior + 1 THEN
    RAISE EXCEPTION 'el número de versión de una opción es el siguiente al último'
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_opcion_numero_salteado';
  END IF;
  RETURN NEW;
END
$$;

-- Consumo: de una opción que no es de la variante, de un insumo admitido que no es el producto dueño, y solo en la misma transacción que
-- creó la versión (K7: lo que una versión confirmada consume no cambia nunca).
CREATE FUNCTION consumo_de_opcion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_dueno uuid;
  v_de_esta_transaccion boolean;
  v_clase_insumo text;
BEGIN
  SELECT g.clase, o.producto_id, v.xmin::text = (pg_current_xact_id()::xid)::text
    INTO v_clase, v_dueno, v_de_esta_transaccion
    FROM public.version_de_opcion v
    JOIN public.opcion o ON o.id = v.opcion_id AND o.empresa_id = v.empresa_id
    JOIN public.grupo_de_elecciones g ON g.id = o.grupo_id AND g.empresa_id = o.empresa_id
   WHERE v.id = NEW.version_de_opcion_id AND v.empresa_id = NEW.empresa_id;
  IF v_clase IS NULL THEN
    RETURN NEW;  -- la clave foránea rechaza la versión que no existe o es de otra empresa
  END IF;
  IF v_clase = 'VARIANTE' THEN
    RAISE EXCEPTION 'las opciones de la variante no consumen (la receta del producto va en su ficha de receta)'
      USING ERRCODE = '23514', CONSTRAINT = 'consumo_de_opcion_de_variante';
  END IF;
  IF NOT v_de_esta_transaccion THEN
    RAISE EXCEPTION 'el consumo solo se carga en la misma transacción que crea la versión de la opción'
      USING ERRCODE = '23514', CONSTRAINT = 'consumo_de_opcion_version_confirmada';
  END IF;
  IF NEW.insumo_id = v_dueno THEN
    RAISE EXCEPTION 'una opción no puede consumir a su propio producto'
      USING ERRCODE = '23514', CONSTRAINT = 'consumo_de_opcion_insumo_es_el_mismo_producto';
  END IF;
  SELECT p.clase_de_uso INTO v_clase_insumo FROM public.producto p WHERE p.id = NEW.insumo_id AND p.empresa_id = NEW.empresa_id;
  IF v_clase_insumo IS NOT NULL AND v_clase_insumo NOT IN ('MATERIA_PRIMA', 'INSUMO', 'REVENTA') THEN
    RAISE EXCEPTION 'una opción solo consume materia prima, insumos o reventa'
      USING ERRCODE = '23514', CONSTRAINT = 'consumo_de_opcion_insumo_no_admitido';
  END IF;
  RETURN NEW;
END
$$;

-- Precio de venta (K5 y K6). El producto se lee con FOR SHARE: quien lo cambia a la vez (forma de venta) o le suma una variante espera, o
-- esta inserción ve el producto ya cambiado (la serializable repite). Los comandos del catálogo toman antes `FOR UPDATE` del producto.
CREATE FUNCTION precio_de_venta_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_unidad text;
  v_paso numeric;
  v_clase_grupo text;
  v_grupo_activo boolean;
  v_se_muestra boolean;
  v_ultima timestamptz;
BEGIN
  SELECT p.clase_de_uso, p.unidad_de_venta_id, p.paso_minimo INTO v_clase, v_unidad, v_paso
    FROM public.producto p WHERE p.id = NEW.producto_id AND p.empresa_id = NEW.empresa_id
     FOR SHARE;
  IF v_clase IS NULL THEN
    RETURN NEW;  -- la clave foránea rechaza el producto que no existe o es de otra empresa
  END IF;
  IF v_clase NOT IN ('VENDIBLE', 'REVENTA') THEN
    RAISE EXCEPTION 'solo un producto que se vende tiene precio'
      USING ERRCODE = '23514', CONSTRAINT = 'precio_de_venta_producto_no_vendible';
  END IF;
  IF NEW.unidad_id IS DISTINCT FROM v_unidad OR NEW.paso_minimo IS DISTINCT FROM v_paso THEN
    RAISE EXCEPTION 'la unidad y el paso del precio son los de la forma de venta del producto'
      USING ERRCODE = '23514', CONSTRAINT = 'precio_forma_de_venta_distinta';
  END IF;
  IF NEW.opcion_id IS NULL THEN
    -- R-18: con variante activa el precio lo da el tamaño; los precios propios del producto quedan como historial inerte.
    IF EXISTS (SELECT 1 FROM public.grupo_de_elecciones g
                WHERE g.empresa_id = NEW.empresa_id AND g.producto_id = NEW.producto_id AND g.clase = 'VARIANTE' AND g.activo) THEN
      RAISE EXCEPTION 'el producto tiene una variante activa: el precio lo da cada tamaño'
        USING ERRCODE = '23514', CONSTRAINT = 'precio_propio_con_variante';
    END IF;
  ELSE
    SELECT g.clase, g.activo, g.se_muestra_en_carta INTO v_clase_grupo, v_grupo_activo, v_se_muestra
      FROM public.opcion o
      JOIN public.grupo_de_elecciones g ON g.id = o.grupo_id AND g.empresa_id = o.empresa_id
     WHERE o.id = NEW.opcion_id AND o.empresa_id = NEW.empresa_id;
    IF v_clase_grupo IS NOT NULL THEN
      IF NOT v_grupo_activo THEN
        RAISE EXCEPTION 'el grupo de la opción no está activo'
          USING ERRCODE = '23514', CONSTRAINT = 'precio_de_venta_grupo_inactivo';
      END IF;
      IF v_clase_grupo = 'INCLUIDA' THEN
        RAISE EXCEPTION 'una opción incluida no lleva precio ni recargo'
          USING ERRCODE = '23514', CONSTRAINT = 'precio_incluida_con_recargo';
      END IF;
      IF v_clase_grupo = 'ADICIONAL' THEN
        -- No hay recargo de la empresa en esta tabla (vive en la versión de la opción): solo el propio de una sucursal.
        IF NEW.sucursal_id IS NULL THEN
          RAISE EXCEPTION 'el recargo de la empresa de una opción adicional se cambia en las opciones, no acá'
            USING ERRCODE = '23514', CONSTRAINT = 'precio_recargo_de_empresa_en_precio';
        END IF;
        IF NEW.precio IS NOT NULL AND NOT v_se_muestra THEN
          RAISE EXCEPTION 'una elección que no se muestra en la carta no puede cambiar el precio'
            USING ERRCODE = '23514', CONSTRAINT = 'precio_eleccion_oculta_con_precio';
        END IF;
      END IF;
    END IF;
  END IF;
  -- Estrictamente creciente por (producto, opción, sucursal): el último en confirmarse es el vigente (C7).
  SELECT max(p.vigente_desde) INTO v_ultima
    FROM public.precio_de_venta p
   WHERE p.empresa_id = NEW.empresa_id AND p.producto_id = NEW.producto_id
     AND p.opcion_id IS NOT DISTINCT FROM NEW.opcion_id AND p.sucursal_id IS NOT DISTINCT FROM NEW.sucursal_id;
  IF v_ultima IS NOT NULL AND NEW.vigente_desde <= v_ultima THEN
    RAISE EXCEPTION 'el precio nuevo tiene que regir después del último cargado'
      USING ERRCODE = '23514', CONSTRAINT = 'precio_fuera_de_orden';
  END IF;
  RETURN NEW;
END
$$;

-- El único lector de precios (K5): la última fila de la sucursal, si existe y su precio no es NULL; si no, la última de la empresa
-- (`sucursal_id IS NULL`), que NO existe para el recargo de una opción adicional (ahí quien cotiza cae al `recargo` de la última versión).
-- Devuelve NULL (no una fila de nulos) si no hay ninguna. Corre con los permisos de quien la llama: la RLS acota la empresa.
CREATE FUNCTION precio_vigente(p_empresa uuid, p_producto uuid, p_opcion uuid, p_sucursal uuid, p_en timestamptz)
  RETURNS precio_de_venta LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v public.precio_de_venta;
BEGIN
  IF p_sucursal IS NOT NULL THEN
    SELECT s.* INTO v FROM public.precio_de_venta s
     WHERE s.empresa_id = p_empresa AND s.producto_id = p_producto AND s.opcion_id IS NOT DISTINCT FROM p_opcion
       AND s.sucursal_id = p_sucursal AND s.vigente_desde <= p_en
     ORDER BY s.vigente_desde DESC, s.id DESC LIMIT 1;
    IF FOUND AND v.precio IS NOT NULL THEN
      RETURN v;
    END IF;
  END IF;
  SELECT e.* INTO v FROM public.precio_de_venta e
   WHERE e.empresa_id = p_empresa AND e.producto_id = p_producto AND e.opcion_id IS NOT DISTINCT FROM p_opcion
     AND e.sucursal_id IS NULL AND e.vigente_desde <= p_en
   ORDER BY e.vigente_desde DESC, e.id DESC LIMIT 1;
  IF FOUND THEN
    RETURN v;
  END IF;
  RETURN NULL;
END
$$;
GRANT EXECUTE ON FUNCTION precio_vigente(uuid, uuid, uuid, uuid, timestamptz) TO pedernal_app;

CREATE TRIGGER producto_alta BEFORE INSERT ON producto
  FOR EACH ROW EXECUTE FUNCTION producto_validar();
CREATE TRIGGER producto_cambio BEFORE UPDATE ON producto
  FOR EACH ROW EXECUTE FUNCTION producto_validar();
CREATE TRIGGER producto_version BEFORE UPDATE ON producto
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER seccion_de_carta_version BEFORE UPDATE ON seccion_de_carta
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER grupo_de_elecciones_alta BEFORE INSERT ON grupo_de_elecciones
  FOR EACH ROW EXECUTE FUNCTION grupo_de_elecciones_validar();
CREATE TRIGGER grupo_de_elecciones_cambio BEFORE UPDATE ON grupo_de_elecciones
  FOR EACH ROW EXECUTE FUNCTION grupo_de_elecciones_validar();
CREATE TRIGGER grupo_de_elecciones_version BEFORE UPDATE ON grupo_de_elecciones
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER opcion_cambio BEFORE UPDATE ON opcion
  FOR EACH ROW EXECUTE FUNCTION opcion_validar();
CREATE TRIGGER opcion_version BEFORE UPDATE ON opcion
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER version_de_opcion_alta BEFORE INSERT ON version_de_opcion
  FOR EACH ROW EXECUTE FUNCTION version_de_opcion_validar();
CREATE TRIGGER consumo_de_opcion_alta BEFORE INSERT ON consumo_de_opcion
  FOR EACH ROW EXECUTE FUNCTION consumo_de_opcion_validar();
CREATE TRIGGER precio_de_venta_alta BEFORE INSERT ON precio_de_venta
  FOR EACH ROW EXECUTE FUNCTION precio_de_venta_validar();

-- Nada de estas tablas se borra ni se vacía (ni el dueño de la base): se desactiva o se reemplaza por una fila más nueva.
CREATE TRIGGER producto_sin_borrado BEFORE DELETE ON producto
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER producto_sin_truncate BEFORE TRUNCATE ON producto
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER seccion_de_carta_sin_borrado BEFORE DELETE ON seccion_de_carta
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER seccion_de_carta_sin_truncate BEFORE TRUNCATE ON seccion_de_carta
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER grupo_de_elecciones_sin_borrado BEFORE DELETE ON grupo_de_elecciones
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER grupo_de_elecciones_sin_truncate BEFORE TRUNCATE ON grupo_de_elecciones
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER opcion_sin_borrado BEFORE DELETE ON opcion
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER opcion_sin_truncate BEFORE TRUNCATE ON opcion
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- De solo inserción: `solo_insercion()` rechaza el UPDATE, el DELETE y el vaciado, aun al dueño de la base.
CREATE TRIGGER unidad_de_medida_solo_insercion BEFORE UPDATE OR DELETE ON unidad_de_medida
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER unidad_de_medida_sin_truncate BEFORE TRUNCATE ON unidad_de_medida
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER version_de_opcion_solo_insercion BEFORE UPDATE OR DELETE ON version_de_opcion
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER version_de_opcion_sin_truncate BEFORE TRUNCATE ON version_de_opcion
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER consumo_de_opcion_solo_insercion BEFORE UPDATE OR DELETE ON consumo_de_opcion
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER consumo_de_opcion_sin_truncate BEFORE TRUNCATE ON consumo_de_opcion
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER precio_de_venta_solo_insercion BEFORE UPDATE OR DELETE ON precio_de_venta
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER precio_de_venta_sin_truncate BEFORE TRUNCATE ON precio_de_venta
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER copia_de_opciones_solo_insercion BEFORE UPDATE OR DELETE ON copia_de_opciones
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER copia_de_opciones_sin_truncate BEFORE TRUNCATE ON copia_de_opciones
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE ni TRUNCATE. Solo la aplicación (`pedernal_app`) recibe algo.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON unidad_de_medida, seccion_de_carta, producto, grupo_de_elecciones, opcion, version_de_opcion, consumo_de_opcion,
  precio_de_venta, copia_de_opciones FROM PUBLIC;

GRANT SELECT ON unidad_de_medida, seccion_de_carta, producto, grupo_de_elecciones, opcion, version_de_opcion, consumo_de_opcion,
  precio_de_venta, copia_de_opciones TO pedernal_app;

GRANT INSERT (id, empresa_id, nombre, nombre_clave, orden) ON seccion_de_carta TO pedernal_app;
GRANT UPDATE (nombre, nombre_clave, orden, activa) ON seccion_de_carta TO pedernal_app;

GRANT INSERT (id, empresa_id, nombre, nombre_clave, nombre_de_cocina, descripcion_en_carta, codigo, codigo_de_barras, tipo,
              clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id, paso_minimo, alicuota_iva, falta_completar,
              seccion_de_carta_id, creado_por)
  ON producto TO pedernal_app;
GRANT UPDATE (nombre, nombre_clave, nombre_de_cocina, descripcion_en_carta, codigo, codigo_de_barras, unidad_de_venta_id,
              paso_minimo, alicuota_iva, falta_completar, seccion_de_carta_id, activo, version_de_opciones)
  ON producto TO pedernal_app;

GRANT INSERT (id, empresa_id, producto_id, clase, es_tamano, nombre, nombre_clave, es_obligatorio, admite_varias,
              se_muestra_en_carta, orden)
  ON grupo_de_elecciones TO pedernal_app;
GRANT UPDATE (es_tamano, nombre, nombre_clave, es_obligatorio, admite_varias, se_muestra_en_carta, orden, activo)
  ON grupo_de_elecciones TO pedernal_app;

GRANT INSERT (id, empresa_id, producto_id, grupo_id, nombre_clave, orden) ON opcion TO pedernal_app;
GRANT UPDATE (orden, activa) ON opcion TO pedernal_app;

GRANT INSERT (id, empresa_id, opcion_id, numero, nombre, recargo, moneda, iva_incluido, factor_de_tamano, cargada_por, creado_en)
  ON version_de_opcion TO pedernal_app;
GRANT INSERT (empresa_id, version_de_opcion_id, numero, insumo_id, cantidad, escala_con_tamano)
  ON consumo_de_opcion TO pedernal_app;
GRANT INSERT (id, empresa_id, producto_id, opcion_id, sucursal_id, precio, unidad_id, paso_minimo, moneda, iva_incluido,
              vigente_desde, cargado_por)
  ON precio_de_venta TO pedernal_app;
GRANT INSERT (id, empresa_id, producto_origen_id, producto_destino_id, creado_por) ON copia_de_opciones TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada en toda tabla nueva; sin política no hay acceso
-- ---------------------------------------------------------------------------------------------
ALTER TABLE unidad_de_medida ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidad_de_medida FORCE ROW LEVEL SECURITY;
ALTER TABLE seccion_de_carta ENABLE ROW LEVEL SECURITY;
ALTER TABLE seccion_de_carta FORCE ROW LEVEL SECURITY;
ALTER TABLE producto ENABLE ROW LEVEL SECURITY;
ALTER TABLE producto FORCE ROW LEVEL SECURITY;
ALTER TABLE grupo_de_elecciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupo_de_elecciones FORCE ROW LEVEL SECURITY;
ALTER TABLE opcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE opcion FORCE ROW LEVEL SECURITY;
ALTER TABLE version_de_opcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE version_de_opcion FORCE ROW LEVEL SECURITY;
ALTER TABLE consumo_de_opcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumo_de_opcion FORCE ROW LEVEL SECURITY;
ALTER TABLE precio_de_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE precio_de_venta FORCE ROW LEVEL SECURITY;
ALTER TABLE copia_de_opciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE copia_de_opciones FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- Políticas. La aplicación siempre con `empresa_id = (SELECT app_empresa_id())` y, en altas y cambios, `empresa_operable(empresa_id)`;
-- los autores con `IS NOT DISTINCT FROM` la persona del contexto. Sin `FOR ALL`: cada comando tiene su política.
-- ---------------------------------------------------------------------------------------------
CREATE POLICY unidad_de_medida_app_leer ON unidad_de_medida FOR SELECT TO pedernal_app USING (true);

CREATE POLICY seccion_de_carta_app_leer ON seccion_de_carta FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY seccion_de_carta_app_alta ON seccion_de_carta FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY seccion_de_carta_app_cambiar ON seccion_de_carta FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY producto_app_leer ON producto FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY producto_app_alta ON producto FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY producto_app_cambiar ON producto FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY grupo_de_elecciones_app_leer ON grupo_de_elecciones FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY grupo_de_elecciones_app_alta ON grupo_de_elecciones FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY grupo_de_elecciones_app_cambiar ON grupo_de_elecciones FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY opcion_app_leer ON opcion FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY opcion_app_alta ON opcion FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY opcion_app_cambiar ON opcion FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY version_de_opcion_app_leer ON version_de_opcion FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY version_de_opcion_app_alta ON version_de_opcion FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND cargada_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );

CREATE POLICY consumo_de_opcion_app_leer ON consumo_de_opcion FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY consumo_de_opcion_app_alta ON consumo_de_opcion FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY precio_de_venta_app_leer ON precio_de_venta FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY precio_de_venta_app_alta ON precio_de_venta FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND cargado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );

CREATE POLICY copia_de_opciones_app_leer ON copia_de_opciones FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY copia_de_opciones_app_alta ON copia_de_opciones FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
