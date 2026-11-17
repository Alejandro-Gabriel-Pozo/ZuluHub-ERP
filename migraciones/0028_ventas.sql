-- 0028_ventas: la cuenta y el ticket interno de la venta rápida (E4; decisiones 132, 144, 146, 152, 155, 162, 166, 170, 172 y 177 del
-- dueño). Diez tablas nuevas: la cuenta (`cuenta_consumo`) con sus líneas (`linea_cuenta`) y la foto de las opciones elegidas
-- (`linea_cuenta_opcion`), el numerador del ticket por sucursal (`numerador_ticket`), el ticket (`ticket`) con sus ejemplares inmutables
-- (`ticket_ejemplar`, `ejemplar_grupo`, `ejemplar_linea`), cómo se saldó (`cobranza_de_ticket`, `aplicacion_de_cobro`) y el registro de
-- cada anulación o corrección (`ticket_correccion`). Diseño: Pedernal-docs/11-especificaciones/e4-venta-rapida-especificacion.md §3.2,
-- §3.3, §3.5, §3.8 y §3.15. Va DESPUÉS de 0025 (catálogo: usa `texto_de_catalogo_valido`) y de 0026 (cierre); es independiente de la
-- migración de caja (0027, que debe estar aplicada antes: el ticket lee `sesion_caja`): las columnas que apuntan a caja (`sesion_de_caja_id`, `caja_id`, `cobro_id`, `cuenta_de_cobro_id`) son
-- OPACAS, sin clave foránea (la especificación §3.3: ventas no tiene FK hacia módulos paralelos; los valida el puerto en la transacción).
--
-- Reglas de esta migración (las mismas de 0001 a 0026):
--  * Es ADITIVA: solo crea objetos nuevos. No toca ninguna tabla, fila ni función existente. Nada se rellena: no hay ventas de antes.
--  * Su reversión es un script aparte, revisado y DESTRUCTIVO si hay datos (ventas, tickets, números): `migraciones/reversiones/
--    0028_revertir_ventas.sql`. El ejecutor no la aplica y frena si alguna tabla tiene filas (salvo confirmación explícita).
--  * Ninguna función SECURITY DEFINER. Toda función fija `search_path = pg_catalog, public, pg_temp` y califica sus tablas con `public.`.
--  * Nadie recibe DELETE ni TRUNCATE (decisión 62: nada se borra, se anula con un registro nuevo); los disparadores los frenan aun al
--    dueño de la base. INSERT y UPDATE van por columna. RLS activa y FORZADA; una política por comando. Los demás roles no reciben nada.
--  * Toda única de una tabla con `empresa_id` lo incluye y toda clave foránea entre tablas de empresa es COMPUESTA `(x_id, empresa_id)`.
--  * Dinero en `numeric` exacto (precio `numeric(18,6)`, importes `numeric(18,2)`, cantidad y paso `numeric(18,4)`), moneda `ARS` explícita,
--    con cota superior en todo importe (`numeric` acepta `NaN`, que es mayor que cualquier número y pasaría un `>= 0`: trampa de 0009).
--  * Los textos que escribe una persona (etiqueta, motivo) se validan con una LISTA DE PERMITIDOS; los que se copian del catálogo
--    (descripción, nombres) usan la misma función del catálogo (`texto_de_catalogo_valido`, 0025).
--
-- Decisiones de diseño (probadas por `test/integracion/ventas-migracion.test.ts`):
--
--  V1. La cuenta no sabe quién la abre: tiene un `ancla (tipo, id)` opaca opcional y a lo sumo UNA cuenta abierta por ancla (índice único
--      parcial). Pasa `ABIERTA → CERRADA | ANULADA` y queda congelada. `total_provisorio` es SIEMPRE `redondear(Σ precio × cantidad de las
--      líneas vigentes)` (CHECK diferido `cuenta_total_cuadra`), con mitad hacia arriba y una sola vez (ADR-006, un solo grupo).
--  V2. La línea congela precio, cantidad, unidad y paso al agregarla (no se edita: se anula con motivo y se agrega otra). Solo entra y
--      solo se anula con la cuenta ABIERTA. `precio_unitario = precio_base + Σ recargos` de las opciones fotografiadas (CHECK diferido
--      `linea_precio_cuadra`). La cantidad es decimal exacto, múltiplo del paso congelado (decisión 162).
--  V2b. Precio ABIERTO: una línea sin precio de catálogo lleva el importe que escribió quien vende (origen `ABIERTO`, sin `precio_id`); la base
--      no le exige `base + recargos` (los recargos son informativos). Con otro origen el precio sale del catálogo y la cuenta cuadra como siempre.
--  V3. El número del ticket sale de `numerador_ticket` (un `UPDATE ... ultimo + 1` que bloquea la fila): `ultimo` solo sube de a uno, el
--      ticket tiene que tomar exactamente ese número y no puede quedar un número sin ticket (CHECK diferido `numerador_sin_huecos`): si
--      algo falla después, la transacción revierte el numerador y el número no se consume.
--  V4. El ticket es inmutable salvo `estado` y `ejemplar_vigente` (de a uno). El contenido vive en ejemplares de SOLO inserción; cada
--      corrección o anulación agrega uno. `ejemplar_cuadra` (diferido): Σ renglones = grupo, Σ grupos = total. El original refleja TODAS
--      las líneas vigentes de la cuenta (`ejemplar_original_no_refleja_la_cuenta`).
--  V5. `fecha_negocio` del ticket: con `sesion_de_caja_id` NULL la fija LA BASE con la fórmula por reloj (zona de la empresa y corte de la
--      sucursal, la misma de `primitivas/tiempo/fecha-de-negocio.ts`) y no se puede cambiar. Con `sesion_de_caja_id` informado (el ticket
--      que nace con su cobro) la fija con la fecha de ESA sesión (`sesion_caja`, 0027) si existe, es de la misma empresa y sucursal y no es
--      posterior a la fecha por reloj; si no, `ticket_fecha_de_sesion_invalida`.
--  V6. `CORTESIA`: ticket de total 0 cerrado sin cobro. Un ticket de total 0 solo puede ser CORTESIA o ANULADO (una cortesía anulada
--      conserva su total 0): es la lectura del CHECK de la especificación que deja anular una cortesía (§3.8).
--  V7. Cobrar: `cobranza_de_ticket` (clave de idempotencia y huella únicas por empresa; una por ticket) y `aplicacion_de_cobro` (qué cobro
--      de caja salda qué importe; solo inserción, importes > 0). `cobranza_cuadra` (diferido): Σ aplicaciones = total del ejemplar cobrado.
--  V8. Cada anulación o corrección deja un registro (`ticket_correccion`, solo inserción) con quién, cuándo, por qué y la jornada en que se
--      hizo (por reloj); la clave de idempotencia es única por empresa.

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.sucursal') IS NULL OR to_regclass('public.persona') IS NULL OR to_regclass('public.empresa') IS NULL
     OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL OR to_regprocedure('public.solo_insercion()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL OR to_regprocedure('public.app_persona_id()') IS NULL
     OR to_regprocedure('public.app_empresa_id()') IS NULL THEN
    RAISE EXCEPTION 'ventas requiere 0001 (sucursal, persona, funciones de contexto y de solo inserción) aplicada antes'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.sin_borrado()') IS NULL THEN
    RAISE EXCEPTION 'ventas requiere 0007_marcas_y_planes aplicada antes (falta sin_borrado())'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.sesion_caja') IS NULL OR to_regclass('public.caja') IS NULL THEN
    RAISE EXCEPTION 'ventas requiere 0027_caja aplicada antes (el ticket toma la fecha de negocio de la sesión de caja)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'ventas requiere 0025_catalogo aplicada antes (falta texto_de_catalogo_valido)'
      USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['cuenta_consumo', 'linea_cuenta', 'linea_cuenta_opcion', 'numerador_ticket', 'ticket', 'ticket_ejemplar',
                                 'ejemplar_grupo', 'ejemplar_linea', 'cobranza_de_ticket', 'aplicacion_de_cobro', 'ticket_correccion'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'ventas nace en 0028: la tabla % ya existe (alguien la creó a mano); hay que revisarla antes de migrar', v_tabla
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- La fecha de negocio por reloj (V5): ((instante en la zona de la empresa) − hora de corte)::date. La misma fórmula que
-- `primitivas/tiempo/fecha-de-negocio.ts`; la usan el ticket y el registro de correcciones.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION fecha_de_negocio_de(p_empresa uuid, p_sucursal uuid, p_instante timestamptz) RETURNS date
  LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT ((p_instante AT TIME ZONE e.zona_horaria) - s.hora_de_corte)::date
    FROM public.sucursal s JOIN public.empresa e ON e.id = s.empresa_id
   WHERE s.id = p_sucursal AND s.empresa_id = p_empresa
$$;
REVOKE ALL ON FUNCTION fecha_de_negocio_de(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fecha_de_negocio_de(uuid, uuid, timestamptz) TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- La cuenta
-- ---------------------------------------------------------------------------------------------
CREATE TABLE cuenta_consumo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),         -- lo manda la app: es la idempotencia del alta
  empresa_id       uuid NOT NULL REFERENCES empresa (id),
  sucursal_id      uuid NOT NULL,
  ancla_tipo       text CONSTRAINT cuenta_ancla_tipo_ck CHECK (ancla_tipo ~ '^[a-z_]+(\.[a-z_]+)?$' AND char_length(ancla_tipo) <= 40),
  ancla_id         uuid,
  etiqueta         text CONSTRAINT cuenta_etiqueta_ck CHECK (etiqueta IS NULL OR texto_de_catalogo_valido(etiqueta, 40)),
  estado           text NOT NULL DEFAULT 'ABIERTA' CONSTRAINT cuenta_estado_ck CHECK (estado IN ('ABIERTA', 'CERRADA', 'ANULADA')),
  moneda           text NOT NULL DEFAULT 'ARS' CONSTRAINT cuenta_moneda_ck CHECK (moneda = 'ARS'),
  total_provisorio numeric(18,2) NOT NULL DEFAULT 0 CONSTRAINT cuenta_total_ck CHECK (total_provisorio >= 0 AND total_provisorio < 1000000000),
  ultima_posicion  integer NOT NULL DEFAULT 0 CONSTRAINT cuenta_ultima_posicion_ck CHECK (ultima_posicion >= 0 AND ultima_posicion < 10000),
  momento_de_stock text NOT NULL DEFAULT 'AL_CERRAR' CONSTRAINT cuenta_momento_de_stock_ck CHECK (momento_de_stock = 'AL_CERRAR'),
  abierta_por      uuid NOT NULL REFERENCES persona (id),
  abierta_en       timestamptz NOT NULL,                               -- el `ahora` de la aplicación, no now()
  resuelta_por     uuid REFERENCES persona (id),
  resuelta_en      timestamptz,
  motivo           text CONSTRAINT cuenta_motivo_ck CHECK (
                     motivo IS NULL OR (motivo = btrim(motivo) AND char_length(motivo) BETWEEN 1 AND 500
                       AND motivo ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$')),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT cuenta_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT cuenta_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT cuenta_ancla_completa_ck CHECK ((ancla_tipo IS NULL) = (ancla_id IS NULL)),
  -- El estado manda sobre las marcas: ABIERTA ⇔ sin resolver; ANULADA ⇔ con motivo.
  CONSTRAINT cuenta_resuelta_ck CHECK (
    (estado = 'ABIERTA') = (resuelta_en IS NULL)
    AND (resuelta_en IS NULL) = (resuelta_por IS NULL)
    AND (estado = 'ANULADA') = (motivo IS NOT NULL)
    AND (resuelta_en IS NULL OR resuelta_en >= abierta_en)
  )
);
-- A lo sumo UNA cuenta abierta por ancla (V1).
CREATE UNIQUE INDEX cuenta_ancla_abierta_uk ON cuenta_consumo (empresa_id, ancla_tipo, ancla_id) WHERE estado = 'ABIERTA';
CREATE INDEX cuenta_abiertas_ix ON cuenta_consumo (empresa_id, sucursal_id) WHERE estado = 'ABIERTA';

-- ---------------------------------------------------------------------------------------------
-- La línea (precio, cantidad, unidad y paso congelados) y la foto de sus opciones
-- ---------------------------------------------------------------------------------------------
CREATE TABLE linea_cuenta (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- lo manda la app
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  cuenta_id           uuid NOT NULL,
  posicion            integer NOT NULL CONSTRAINT linea_posicion_ck CHECK (posicion >= 1 AND posicion < 10000),
  producto_id         uuid NOT NULL,                                   -- opaco: lo valida el catálogo en la misma transacción
  descripcion         text NOT NULL CONSTRAINT linea_descripcion_ck CHECK (texto_de_catalogo_valido(descripcion, 200)),
  variante_opcion_id  uuid,                                            -- el tamaño elegido (opaco), con su nombre
  variante_nombre     text CONSTRAINT linea_variante_nombre_ck CHECK (variante_nombre IS NULL OR texto_de_catalogo_valido(variante_nombre, 200)),
  precio_id           uuid,                                            -- el precio de catálogo que se congeló (opaco); NULL con precio abierto
  origen_del_precio   text NOT NULL CONSTRAINT linea_origen_del_precio_ck CHECK (origen_del_precio IN ('SUCURSAL', 'EMPRESA', 'ABIERTO')),
  moneda              text NOT NULL DEFAULT 'ARS' CONSTRAINT linea_moneda_ck CHECK (moneda = 'ARS'),
  precio_base         numeric(18,6) NOT NULL CONSTRAINT linea_precio_base_ck CHECK (precio_base >= 0 AND precio_base < 1000000000),
  precio_unitario     numeric(18,6) NOT NULL CONSTRAINT linea_precio_unitario_ck CHECK (precio_unitario >= 0 AND precio_unitario < 1000000000),
  cantidad            numeric(18,4) NOT NULL CONSTRAINT linea_cantidad_ck CHECK (cantidad > 0 AND cantidad <= 9999),
  unidad_de_venta     text NOT NULL CONSTRAINT linea_unidad_de_venta_ck CHECK (unidad_de_venta ~ '^[A-Z_]{1,20}$'),
  paso_de_cantidad    numeric(18,4) NOT NULL CONSTRAINT linea_paso_ck CHECK (paso_de_cantidad > 0 AND paso_de_cantidad <= 9999),
  alicuota            text NOT NULL CONSTRAINT linea_alicuota_ck CHECK (alicuota IN ('0', '2.5', '5', '10.5', '21', '27', 'EXENTO', 'NO_GRAVADO')),
  controla_stock      boolean NOT NULL DEFAULT false,
  estado              text NOT NULL DEFAULT 'VIGENTE' CONSTRAINT linea_estado_ck CHECK (estado IN ('VIGENTE', 'ANULADA')),
  anulada_por         uuid REFERENCES persona (id),
  anulada_en          timestamptz,
  motivo_de_anulacion text CONSTRAINT linea_motivo_ck CHECK (
                        motivo_de_anulacion IS NULL OR (motivo_de_anulacion = btrim(motivo_de_anulacion)
                          AND char_length(motivo_de_anulacion) BETWEEN 1 AND 500
                          AND motivo_de_anulacion ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$')),
  creada_por          uuid NOT NULL REFERENCES persona (id),
  creada_en           timestamptz NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT linea_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT linea_posicion_uk UNIQUE (empresa_id, cuenta_id, posicion),
  CONSTRAINT linea_cuenta_fkey FOREIGN KEY (cuenta_id, empresa_id) REFERENCES cuenta_consumo (id, empresa_id),
  CONSTRAINT linea_variante_completa_ck CHECK ((variante_opcion_id IS NULL) = (variante_nombre IS NULL)),
  CONSTRAINT linea_precio_unitario_minimo_ck CHECK (precio_unitario >= precio_base),
  -- Precio ABIERTO (decisión 179): lo escribe quien vende, no hay precio de catálogo y el importe escrito es el precio unitario (base = unitario;
  -- los recargos de las opciones son solo informativos). Con precio de catálogo, el precio sale del catálogo y se congela su id.
  CONSTRAINT linea_precio_abierto_ck CHECK ((origen_del_precio = 'ABIERTO') = (precio_id IS NULL) AND (origen_del_precio <> 'ABIERTO' OR precio_base = precio_unitario)),
  -- La cantidad es múltiplo EXACTO del paso congelado (decisión 162): `numeric` exacto; un `NaN` no da 0.
  CONSTRAINT linea_cantidad_multiplo_ck CHECK (cantidad % NULLIF(paso_de_cantidad, 0) = 0),
  CONSTRAINT linea_anulada_ck CHECK (
    (estado = 'ANULADA') = (anulada_en IS NOT NULL)
    AND (anulada_en IS NULL) = (anulada_por IS NULL)
    AND (estado = 'ANULADA') = (motivo_de_anulacion IS NOT NULL)
    AND (anulada_en IS NULL OR anulada_en >= creada_en)
  )
);
CREATE INDEX linea_producto_ix ON linea_cuenta (empresa_id, producto_id);

CREATE TABLE linea_cuenta_opcion (                                     -- solo inserción; la opción oculta también se fotografía
  empresa_id           uuid NOT NULL REFERENCES empresa (id),
  linea_id             uuid NOT NULL,
  orden                integer NOT NULL CONSTRAINT linea_opcion_orden_ck CHECK (orden >= 1 AND orden <= 100),
  opcion_id            uuid NOT NULL,                                  -- opacos: los validó el catálogo
  version_de_opcion_id uuid NOT NULL,
  grupo_id             uuid NOT NULL,
  nombre_de_grupo      text NOT NULL CONSTRAINT linea_opcion_grupo_ck CHECK (texto_de_catalogo_valido(nombre_de_grupo, 200)),
  nombre               text NOT NULL CONSTRAINT linea_opcion_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 200)),
  clase                text NOT NULL CONSTRAINT linea_opcion_clase_ck CHECK (clase IN ('INCLUIDA', 'ADICIONAL')),
  recargo              numeric(18,6) NOT NULL CONSTRAINT linea_opcion_recargo_ck CHECK (recargo >= 0 AND recargo < 1000000000),
  origen_del_recargo   text NOT NULL CONSTRAINT linea_opcion_origen_ck CHECK (origen_del_recargo IN ('SUCURSAL', 'EMPRESA')),
  creado_en            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linea_opcion_pkey PRIMARY KEY (empresa_id, linea_id, orden),
  CONSTRAINT linea_opcion_opcion_uk UNIQUE (empresa_id, linea_id, opcion_id),
  CONSTRAINT linea_opcion_linea_fkey FOREIGN KEY (linea_id, empresa_id) REFERENCES linea_cuenta (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- El numerador del ticket por sucursal (V3) y el ticket
-- ---------------------------------------------------------------------------------------------
CREATE TABLE numerador_ticket (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  sucursal_id    uuid NOT NULL,
  ultimo         integer NOT NULL DEFAULT 0 CONSTRAINT numerador_ultimo_ck CHECK (ultimo >= 0 AND ultimo < 2000000000),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT numerador_ticket_pkey PRIMARY KEY (empresa_id, sucursal_id),
  CONSTRAINT numerador_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id)
);

CREATE TABLE ticket (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  sucursal_id        uuid NOT NULL,
  cuenta_id          uuid NOT NULL,
  numero             integer NOT NULL CONSTRAINT ticket_numero_ck CHECK (numero >= 1),
  fecha_negocio      date NOT NULL CONSTRAINT ticket_fecha_ck CHECK (fecha_negocio BETWEEN date '2000-01-01' AND date '2200-12-31'),
  estado             text NOT NULL CONSTRAINT ticket_estado_ck CHECK (estado IN ('EMITIDO', 'COBRADO', 'CORTESIA', 'ANULADO')),
  moneda             text NOT NULL DEFAULT 'ARS' CONSTRAINT ticket_moneda_ck CHECK (moneda = 'ARS'),
  total              numeric(18,2) NOT NULL CONSTRAINT ticket_total_ck CHECK (total >= 0 AND total < 1000000000),
  sesion_de_caja_id  uuid,                                             -- opaco; solo si el ticket nació con su cobro (V5)
  ejemplar_vigente   integer NOT NULL DEFAULT 1 CONSTRAINT ticket_ejemplar_vigente_ck CHECK (ejemplar_vigente >= 1 AND ejemplar_vigente < 10000),
  emitido_por        uuid NOT NULL REFERENCES persona (id),
  emitido_en         timestamptz NOT NULL,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT ticket_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT ticket_cuenta_uk UNIQUE (empresa_id, cuenta_id),
  CONSTRAINT ticket_numero_uk UNIQUE (empresa_id, sucursal_id, numero),
  CONSTRAINT ticket_cuenta_fkey FOREIGN KEY (cuenta_id, empresa_id) REFERENCES cuenta_consumo (id, empresa_id),
  CONSTRAINT ticket_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  -- V6: total 0 ⇒ solo CORTESIA o ANULADO; CORTESIA ⇒ total 0.
  CONSTRAINT ticket_cortesia_ck CHECK ((estado <> 'CORTESIA' OR total = 0) AND (total <> 0 OR estado IN ('CORTESIA', 'ANULADO')))
);
CREATE INDEX ticket_jornada_ix ON ticket (empresa_id, sucursal_id, fecha_negocio, numero);
CREATE INDEX ticket_pendientes_ix ON ticket (empresa_id, sucursal_id, fecha_negocio, numero) WHERE estado = 'COBRADO';

-- ---------------------------------------------------------------------------------------------
-- Los ejemplares del ticket (solo inserción): el original nace al cerrar; cada corrección o anulación agrega uno
-- ---------------------------------------------------------------------------------------------
CREATE TABLE ticket_ejemplar (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),        -- lo manda la app (`ejemplarId`)
  empresa_id        uuid NOT NULL REFERENCES empresa (id),
  ticket_id         uuid NOT NULL,
  numero_de_ejemplar integer NOT NULL CONSTRAINT ejemplar_numero_ck CHECK (numero_de_ejemplar >= 1 AND numero_de_ejemplar < 10000),
  tipo              text NOT NULL CONSTRAINT ejemplar_tipo_ck CHECK (tipo IN ('ORIGINAL', 'CORRECCION', 'ANULACION')),
  total             numeric(18,2) NOT NULL CONSTRAINT ejemplar_total_ck CHECK (total >= 0 AND total < 1000000000),
  ejemplar_base_id  uuid,
  creado_por        uuid NOT NULL REFERENCES persona (id),
  creado_en         timestamptz NOT NULL,
  CONSTRAINT ejemplar_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT ejemplar_numero_uk UNIQUE (empresa_id, ticket_id, numero_de_ejemplar),
  CONSTRAINT ejemplar_ticket_fkey FOREIGN KEY (ticket_id, empresa_id) REFERENCES ticket (id, empresa_id),
  CONSTRAINT ejemplar_base_fkey FOREIGN KEY (ejemplar_base_id, empresa_id) REFERENCES ticket_ejemplar (id, empresa_id),
  -- El original es el número 1 y no tiene base; los demás cuelgan del anterior. Una anulación no lleva importe.
  CONSTRAINT ejemplar_original_ck CHECK ((numero_de_ejemplar = 1) = (tipo = 'ORIGINAL') AND (tipo = 'ORIGINAL') = (ejemplar_base_id IS NULL)),
  CONSTRAINT ejemplar_anulacion_ck CHECK (tipo <> 'ANULACION' OR total = 0)
);

CREATE TABLE ejemplar_grupo (
  empresa_id  uuid NOT NULL REFERENCES empresa (id),
  ejemplar_id uuid NOT NULL,
  orden       integer NOT NULL CONSTRAINT grupo_orden_ck CHECK (orden = 1),   -- E4 tiene un solo grupo por ticket
  total       numeric(18,2) NOT NULL CONSTRAINT grupo_total_ck CHECK (total >= 0 AND total < 1000000000),
  emisor_id   uuid,                                                           -- anulable: NULL en E4 (decisión 156)
  CONSTRAINT ejemplar_grupo_pkey PRIMARY KEY (empresa_id, ejemplar_id, orden),
  CONSTRAINT ejemplar_grupo_empresa_uk UNIQUE (ejemplar_id, orden, empresa_id),
  CONSTRAINT grupo_ejemplar_fkey FOREIGN KEY (ejemplar_id, empresa_id) REFERENCES ticket_ejemplar (id, empresa_id)
);

CREATE TABLE ejemplar_linea (
  empresa_id      uuid NOT NULL REFERENCES empresa (id),
  ejemplar_id     uuid NOT NULL,
  grupo_orden     integer NOT NULL,
  linea_cuenta_id uuid NOT NULL,
  cantidad        numeric(18,4) NOT NULL CONSTRAINT ejemplar_linea_cantidad_ck CHECK (cantidad > 0 AND cantidad <= 9999),
  importe         numeric(18,2) NOT NULL CONSTRAINT ejemplar_linea_importe_ck CHECK (importe >= 0 AND importe < 1000000000),
  CONSTRAINT ejemplar_linea_pkey PRIMARY KEY (empresa_id, ejemplar_id, linea_cuenta_id),
  CONSTRAINT ejemplar_linea_grupo_fkey FOREIGN KEY (ejemplar_id, grupo_orden, empresa_id) REFERENCES ejemplar_grupo (ejemplar_id, orden, empresa_id),
  CONSTRAINT ejemplar_linea_ejemplar_fkey FOREIGN KEY (ejemplar_id, empresa_id) REFERENCES ticket_ejemplar (id, empresa_id),
  CONSTRAINT ejemplar_linea_linea_fkey FOREIGN KEY (linea_cuenta_id, empresa_id) REFERENCES linea_cuenta (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- Cómo se saldó el ticket (V7). Los ids de caja son opacos (sin clave foránea: los valida el puerto en la transacción).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE cobranza_de_ticket (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa (id),
  ticket_id     uuid NOT NULL,
  ejemplar_id   uuid NOT NULL,                                         -- el ejemplar que se cobró
  caja_id       uuid NOT NULL,                                         -- opaco
  clave         text NOT NULL CONSTRAINT cobranza_clave_ck CHECK (clave ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella        text NOT NULL CONSTRAINT cobranza_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  destino       text NOT NULL DEFAULT 'SOLO_TICKET' CONSTRAINT cobranza_destino_ck CHECK (destino = 'SOLO_TICKET'),
  resultado     jsonb CONSTRAINT cobranza_resultado_ck CHECK (resultado IS NULL OR jsonb_typeof(resultado) = 'object'),
  creada_por    uuid NOT NULL REFERENCES persona (id),
  creada_en     timestamptz NOT NULL,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cobranza_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT cobranza_clave_uk UNIQUE (empresa_id, clave),
  CONSTRAINT cobranza_ticket_uk UNIQUE (empresa_id, ticket_id),        -- una cobranza vigente por ticket
  CONSTRAINT cobranza_ticket_fkey FOREIGN KEY (ticket_id, empresa_id) REFERENCES ticket (id, empresa_id),
  CONSTRAINT cobranza_ejemplar_fkey FOREIGN KEY (ejemplar_id, empresa_id) REFERENCES ticket_ejemplar (id, empresa_id)
);

CREATE TABLE aplicacion_de_cobro (                                     -- solo inserción
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  cobranza_id         uuid NOT NULL,
  orden               integer NOT NULL CONSTRAINT aplicacion_orden_ck CHECK (orden BETWEEN 1 AND 50),
  cobro_id            uuid NOT NULL,                                   -- opaco: el cobro de caja
  cuenta_de_cobro_id  uuid,                                            -- opaco; opcional (decisión 151)
  importe             numeric(18,2) NOT NULL CONSTRAINT aplicacion_importe_ck CHECK (importe > 0 AND importe < 1000000000),
  creado_en           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aplicacion_de_cobro_pkey PRIMARY KEY (empresa_id, cobranza_id, orden),
  CONSTRAINT aplicacion_cobro_uk UNIQUE (empresa_id, cobro_id),
  CONSTRAINT aplicacion_cobranza_fkey FOREIGN KEY (cobranza_id, empresa_id) REFERENCES cobranza_de_ticket (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- El registro de cada anulación o corrección (V8)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE ticket_correccion (                                       -- solo inserción
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  ticket_id          uuid NOT NULL,
  ejemplar_base_id   uuid NOT NULL,
  ejemplar_nuevo_id  uuid NOT NULL,
  tipo               text NOT NULL CONSTRAINT correccion_tipo_ck CHECK (tipo IN ('ANULACION', 'CORRECCION')),
  motivo             text NOT NULL CONSTRAINT correccion_motivo_ck CHECK (
                       motivo = btrim(motivo) AND char_length(motivo) BETWEEN 1 AND 500
                       AND motivo ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'),
  clave              text NOT NULL CONSTRAINT correccion_clave_ck CHECK (clave ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella             text NOT NULL CONSTRAINT correccion_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  resultado          jsonb NOT NULL CONSTRAINT correccion_resultado_ck CHECK (jsonb_typeof(resultado) = 'object'),
  hecha_por          uuid NOT NULL REFERENCES persona (id),
  hecha_en           timestamptz NOT NULL,
  fecha_negocio      date NOT NULL CONSTRAINT correccion_fecha_ck CHECK (fecha_negocio BETWEEN date '2000-01-01' AND date '2200-12-31'),
  creado_en          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT correccion_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT correccion_clave_uk UNIQUE (empresa_id, clave),
  CONSTRAINT correccion_ejemplar_uk UNIQUE (empresa_id, ticket_id, ejemplar_nuevo_id),
  CONSTRAINT correccion_ticket_fkey FOREIGN KEY (ticket_id, empresa_id) REFERENCES ticket (id, empresa_id),
  CONSTRAINT correccion_base_fkey FOREIGN KEY (ejemplar_base_id, empresa_id) REFERENCES ticket_ejemplar (id, empresa_id),
  CONSTRAINT correccion_nuevo_fkey FOREIGN KEY (ejemplar_nuevo_id, empresa_id) REFERENCES ticket_ejemplar (id, empresa_id)
);
CREATE INDEX correccion_jornada_ix ON ticket_correccion (empresa_id, fecha_negocio);

-- ---------------------------------------------------------------------------------------------
-- Disparadores: cuenta
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION cuenta_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.estado <> 'ABIERTA' OR NEW.total_provisorio <> 0 OR NEW.ultima_posicion <> 0 THEN
    RAISE EXCEPTION 'una cuenta nace abierta, vacía y sin posiciones'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_alta_invalida';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION cuenta_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id OR NEW.ancla_tipo IS DISTINCT FROM OLD.ancla_tipo
     OR NEW.ancla_id IS DISTINCT FROM OLD.ancla_id OR NEW.etiqueta IS DISTINCT FROM OLD.etiqueta
     OR NEW.moneda IS DISTINCT FROM OLD.moneda OR NEW.momento_de_stock IS DISTINCT FROM OLD.momento_de_stock
     OR NEW.abierta_por IS DISTINCT FROM OLD.abierta_por OR NEW.abierta_en IS DISTINCT FROM OLD.abierta_en
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'la identidad de una cuenta no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_inmutable';
  END IF;
  IF OLD.estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'una cuenta cerrada o anulada no se puede modificar'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_resuelta_congelada';
  END IF;
  -- Reservar una posición sube `ultima_posicion` de a una; ninguna otra cosa la mueve.
  IF NEW.ultima_posicion IS DISTINCT FROM OLD.ultima_posicion AND NEW.ultima_posicion <> OLD.ultima_posicion + 1 THEN
    RAISE EXCEPTION 'las posiciones de una cuenta suben de a una'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_posicion_invalida';
  END IF;
  IF NEW.estado <> 'ABIERTA' THEN
    -- Quien cierra o anula es la persona del contexto firmado: la aplicación no puede poner a otra.
    IF NEW.resuelta_por IS DISTINCT FROM public.app_persona_id() THEN
      RAISE EXCEPTION 'la cuenta la resuelve la persona del contexto'
        USING ERRCODE = '23514', CONSTRAINT = 'cuenta_persona_del_contexto';
    END IF;
    IF NEW.ultima_posicion IS DISTINCT FROM OLD.ultima_posicion OR NEW.total_provisorio IS DISTINCT FROM OLD.total_provisorio THEN
      RAISE EXCEPTION 'al cerrar o anular una cuenta no se cambian sus líneas ni su total'
        USING ERRCODE = '23514', CONSTRAINT = 'cuenta_transicion_invalida';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- V1: `total_provisorio` es SIEMPRE el redondeo (mitad hacia arriba, una vez) de la suma exacta de las líneas vigentes.
-- Se comprueba al confirmar, desde cualquiera de las dos tablas.
CREATE FUNCTION cuenta_total_cuadra() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_cuenta uuid;
  v_empresa uuid;
  v_total numeric;
  v_esperado numeric;
BEGIN
  IF TG_TABLE_NAME = 'cuenta_consumo' THEN
    v_cuenta := NEW.id;
  ELSE
    v_cuenta := NEW.cuenta_id;
  END IF;
  v_empresa := NEW.empresa_id;
  SELECT c.total_provisorio INTO v_total FROM public.cuenta_consumo c WHERE c.id = v_cuenta AND c.empresa_id = v_empresa;
  SELECT round(coalesce(sum(l.precio_unitario * l.cantidad), 0), 2) INTO v_esperado
    FROM public.linea_cuenta l WHERE l.cuenta_id = v_cuenta AND l.empresa_id = v_empresa AND l.estado = 'VIGENTE';
  IF v_total IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'el total de la cuenta (%) no es el de sus líneas vigentes (%)', v_total, v_esperado
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_total_cuadra';
  END IF;
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Disparadores: línea y foto de opciones
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION linea_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_cuenta public.cuenta_consumo%ROWTYPE;
BEGIN
  SELECT * INTO v_cuenta FROM public.cuenta_consumo c WHERE c.id = NEW.cuenta_id AND c.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_cuenta.estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'solo se agregan líneas a una cuenta abierta'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_cuenta_no_abierta';
  END IF;
  -- La posición la reservó `UPDATE cuenta_consumo SET ultima_posicion = ultima_posicion + 1` en esta misma transacción.
  IF NEW.posicion > v_cuenta.ultima_posicion THEN
    RAISE EXCEPTION 'la posición % no fue reservada en la cuenta', NEW.posicion
      USING ERRCODE = '23514', CONSTRAINT = 'linea_posicion_no_reservada';
  END IF;
  IF NEW.estado <> 'VIGENTE' THEN
    RAISE EXCEPTION 'una línea nace vigente'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_alta_invalida';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION linea_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  -- Todo lo que se congeló al agregar la línea queda como está: solo cambia `estado` (y su marca de anulación).
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id
     OR NEW.posicion IS DISTINCT FROM OLD.posicion OR NEW.producto_id IS DISTINCT FROM OLD.producto_id
     OR NEW.descripcion IS DISTINCT FROM OLD.descripcion OR NEW.variante_opcion_id IS DISTINCT FROM OLD.variante_opcion_id
     OR NEW.variante_nombre IS DISTINCT FROM OLD.variante_nombre OR NEW.precio_id IS DISTINCT FROM OLD.precio_id
     OR NEW.origen_del_precio IS DISTINCT FROM OLD.origen_del_precio OR NEW.moneda IS DISTINCT FROM OLD.moneda
     OR NEW.precio_base IS DISTINCT FROM OLD.precio_base OR NEW.precio_unitario IS DISTINCT FROM OLD.precio_unitario
     OR NEW.cantidad IS DISTINCT FROM OLD.cantidad OR NEW.unidad_de_venta IS DISTINCT FROM OLD.unidad_de_venta
     OR NEW.paso_de_cantidad IS DISTINCT FROM OLD.paso_de_cantidad OR NEW.alicuota IS DISTINCT FROM OLD.alicuota
     OR NEW.controla_stock IS DISTINCT FROM OLD.controla_stock OR NEW.creada_por IS DISTINCT FROM OLD.creada_por
     OR NEW.creada_en IS DISTINCT FROM OLD.creada_en OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'una línea no se edita: se anula con motivo y se agrega otra'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_inmutable';
  END IF;
  IF OLD.estado = 'ANULADA' THEN
    RAISE EXCEPTION 'una línea anulada no se puede modificar'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_anulada_congelada';
  END IF;
  IF NEW.estado = 'ANULADA' THEN
    IF NEW.anulada_por IS DISTINCT FROM public.app_persona_id() THEN
      RAISE EXCEPTION 'la línea la anula la persona del contexto'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_persona_del_contexto';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cuenta_consumo c WHERE c.id = NEW.cuenta_id AND c.empresa_id = NEW.empresa_id AND c.estado = 'ABIERTA') THEN
      RAISE EXCEPTION 'solo se anulan líneas de una cuenta abierta'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_cuenta_no_abierta';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- V2: `precio_unitario = precio_base + Σ recargos` de las opciones fotografiadas, comprobado al confirmar (las opciones entran después
-- de la línea, en la misma transacción).
CREATE FUNCTION linea_precio_cuadra() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_recargos numeric;
BEGIN
  SELECT coalesce(sum(o.recargo), 0) INTO v_recargos
    FROM public.linea_cuenta_opcion o WHERE o.linea_id = NEW.id AND o.empresa_id = NEW.empresa_id;
  IF NEW.origen_del_precio <> 'ABIERTO' AND NEW.precio_unitario IS DISTINCT FROM NEW.precio_base + v_recargos THEN
    RAISE EXCEPTION 'el precio de la línea no es el base más los recargos de sus opciones'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_precio_cuadra';
  END IF;
  RETURN NULL;
END
$$;

-- La foto de las opciones solo entra en la misma transacción que su línea (el mismo recurso de 0005 y 0026: `xmin`).
CREATE FUNCTION linea_opcion_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.linea_cuenta l
     WHERE l.id = NEW.linea_id AND l.empresa_id = NEW.empresa_id AND l.xmin = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'las opciones de una línea solo se guardan junto con la línea, en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_opcion_solo_con_la_linea';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Disparadores: numerador, ticket y ejemplares
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION numerador_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.ultimo <> 0 THEN
    RAISE EXCEPTION 'el numerador de una sucursal arranca en 0'
      USING ERRCODE = '23514', CONSTRAINT = 'numerador_alta_invalida';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION numerador_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'la identidad del numerador no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'numerador_inmutable';
  END IF;
  IF NEW.ultimo <> OLD.ultimo + 1 THEN
    RAISE EXCEPTION 'el numerador solo sube de a uno'
      USING ERRCODE = '23514', CONSTRAINT = 'numerador_solo_sube_de_a_uno';
  END IF;
  RETURN NEW;
END
$$;

-- V3: al confirmar, el número que dio el numerador tiene su ticket: no hay huecos.
CREATE FUNCTION numerador_sin_huecos() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.ultimo > 0 AND NOT EXISTS (
    SELECT 1 FROM public.ticket t
     WHERE t.empresa_id = NEW.empresa_id AND t.sucursal_id = NEW.sucursal_id AND t.numero = NEW.ultimo
  ) THEN
    RAISE EXCEPTION 'el número % de la sucursal no tiene ticket: no puede quedar un hueco', NEW.ultimo
      USING ERRCODE = '23514', CONSTRAINT = 'numerador_sin_huecos';
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION ticket_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_ultimo integer;
  v_cuenta public.cuenta_consumo%ROWTYPE;
  v_fecha_sesion date;
  v_sucursal_sesion uuid;
BEGIN
  -- El ticket toma exactamente el número que el numerador acaba de dar (V3).
  SELECT n.ultimo INTO v_ultimo FROM public.numerador_ticket n
   WHERE n.empresa_id = NEW.empresa_id AND n.sucursal_id = NEW.sucursal_id;
  IF v_ultimo IS NULL OR NEW.numero <> v_ultimo THEN
    RAISE EXCEPTION 'el ticket tiene que tomar el número que acaba de dar el numerador de su sucursal'
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_numero_invalido';
  END IF;
  -- Se emite de una cuenta CERRADA en esta misma transacción, de su misma sucursal, con su mismo total.
  SELECT * INTO v_cuenta FROM public.cuenta_consumo c WHERE c.id = NEW.cuenta_id AND c.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_cuenta.estado <> 'CERRADA' OR v_cuenta.sucursal_id <> NEW.sucursal_id OR v_cuenta.total_provisorio <> NEW.total THEN
    RAISE EXCEPTION 'el ticket sale de una cuenta cerrada, de su sucursal y con su total'
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_cuenta_invalida';
  END IF;
  IF NEW.estado NOT IN ('EMITIDO', 'CORTESIA') OR NEW.ejemplar_vigente <> 1 THEN
    RAISE EXCEPTION 'un ticket nace emitido o cortesía, con su ejemplar original'
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_alta_invalida';
  END IF;
  -- V5: la fecha de negocio. Con sesión de caja (el ticket que nace con su cobro) es la de ESA sesión, así ticket y cobro caen siempre en la
  -- misma jornada, también con la caja abierta pasada la hora de corte; la sesión tiene que existir, ser de la misma empresa y sucursal y su
  -- fecha no puede ser posterior a la del reloj (un hecho no está en el futuro). Sin sesión, la fórmula por reloj.
  IF NEW.sesion_de_caja_id IS NOT NULL THEN
    SELECT s.fecha_negocio, c.sucursal_id INTO v_fecha_sesion, v_sucursal_sesion
      FROM public.sesion_caja s JOIN public.caja c ON c.id = s.caja_id AND c.empresa_id = s.empresa_id
     WHERE s.id = NEW.sesion_de_caja_id AND s.empresa_id = NEW.empresa_id;
    IF NOT FOUND OR v_sucursal_sesion <> NEW.sucursal_id
       OR v_fecha_sesion > public.fecha_de_negocio_de(NEW.empresa_id, NEW.sucursal_id, NEW.emitido_en) THEN
      RAISE EXCEPTION 'la sesión de caja del ticket no existe, no es de su sucursal o es de una jornada futura'
        USING ERRCODE = '23514', CONSTRAINT = 'ticket_fecha_de_sesion_invalida';
    END IF;
    NEW.fecha_negocio := v_fecha_sesion;
    RETURN NEW;
  END IF;
  NEW.fecha_negocio := public.fecha_de_negocio_de(NEW.empresa_id, NEW.sucursal_id, NEW.emitido_en);
  IF NEW.fecha_negocio IS NULL THEN
    RAISE EXCEPTION 'no se pudo fechar el ticket: sucursal desconocida'
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_fecha_de_negocio_invalida';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION ticket_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id
     OR NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id OR NEW.numero IS DISTINCT FROM OLD.numero
     OR NEW.fecha_negocio IS DISTINCT FROM OLD.fecha_negocio OR NEW.moneda IS DISTINCT FROM OLD.moneda
     OR NEW.total IS DISTINCT FROM OLD.total OR NEW.sesion_de_caja_id IS DISTINCT FROM OLD.sesion_de_caja_id
     OR NEW.emitido_por IS DISTINCT FROM OLD.emitido_por OR NEW.emitido_en IS DISTINCT FROM OLD.emitido_en
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'un ticket cerrado no se edita: solo cambian su estado y su ejemplar vigente'
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_inmutable';
  END IF;
  -- Las transiciones son exactamente cuatro; ANULADO es final.
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
       (OLD.estado = 'EMITIDO' AND NEW.estado IN ('COBRADO', 'ANULADO'))
    OR (OLD.estado = 'COBRADO' AND NEW.estado = 'ANULADO')
    OR (OLD.estado = 'CORTESIA' AND NEW.estado = 'ANULADO')) THEN
    RAISE EXCEPTION 'transición de estado de ticket no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_transicion_invalida';
  END IF;
  IF OLD.estado = 'ANULADO' AND NEW.ejemplar_vigente IS DISTINCT FROM OLD.ejemplar_vigente THEN
    RAISE EXCEPTION 'un ticket anulado no se corrige'
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_transicion_invalida';
  END IF;
  -- El ejemplar vigente sube de a uno: con la anulación (siempre) y con una corrección (mismo estado); cobrar no lo mueve.
  IF NEW.ejemplar_vigente <> OLD.ejemplar_vigente AND NEW.ejemplar_vigente <> OLD.ejemplar_vigente + 1 THEN
    RAISE EXCEPTION 'el ejemplar vigente sube de a uno'
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_ejemplar_vigente_salto';
  END IF;
  IF NEW.estado = 'ANULADO' AND OLD.estado <> 'ANULADO' AND NEW.ejemplar_vigente <> OLD.ejemplar_vigente + 1 THEN
    RAISE EXCEPTION 'anular un ticket agrega un ejemplar'
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_ejemplar_vigente_salto';
  END IF;
  IF NEW.estado = 'COBRADO' AND OLD.estado = 'EMITIDO' THEN
    IF NEW.ejemplar_vigente <> OLD.ejemplar_vigente OR NOT EXISTS (
      SELECT 1 FROM public.cobranza_de_ticket c WHERE c.ticket_id = NEW.id AND c.empresa_id = NEW.empresa_id
    ) THEN
      RAISE EXCEPTION 'un ticket se cobra con su cobranza y sin cambiar de ejemplar'
        USING ERRCODE = '23514', CONSTRAINT = 'ticket_cobrado_sin_cobranza';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Al confirmar, el ejemplar vigente del ticket existe y es el último.
CREATE FUNCTION ticket_ejemplar_vigente_existe() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_ticket uuid;
  v_empresa uuid;
  v_vigente integer;
  v_ultimo integer;
BEGIN
  IF TG_TABLE_NAME = 'ticket' THEN
    v_ticket := NEW.id;
  ELSE
    v_ticket := NEW.ticket_id;
  END IF;
  v_empresa := NEW.empresa_id;
  SELECT t.ejemplar_vigente INTO v_vigente FROM public.ticket t WHERE t.id = v_ticket AND t.empresa_id = v_empresa;
  SELECT max(e.numero_de_ejemplar) INTO v_ultimo FROM public.ticket_ejemplar e WHERE e.ticket_id = v_ticket AND e.empresa_id = v_empresa;
  IF v_vigente IS DISTINCT FROM v_ultimo THEN
    RAISE EXCEPTION 'el ejemplar vigente (%) no es el último ejemplar del ticket (%)', v_vigente, v_ultimo
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_ejemplar_vigente_existe';
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION ejemplar_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_ticket public.ticket%ROWTYPE;
  v_base public.ticket_ejemplar%ROWTYPE;
BEGIN
  SELECT * INTO v_ticket FROM public.ticket t WHERE t.id = NEW.ticket_id AND t.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el ejemplar es de un ticket que no existe' USING ERRCODE = '23514', CONSTRAINT = 'ejemplar_ticket_invalido';
  END IF;
  -- El ticket ya subió de ejemplar (o nació) en esta misma transacción, y este es justamente el vigente.
  IF NEW.numero_de_ejemplar <> v_ticket.ejemplar_vigente OR NOT EXISTS (
    SELECT 1 FROM public.ticket t WHERE t.id = NEW.ticket_id AND t.empresa_id = NEW.empresa_id AND t.xmin = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'el ejemplar nuevo es el vigente del ticket, creado en esta transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'ejemplar_no_es_el_vigente';
  END IF;
  IF NEW.tipo <> 'ORIGINAL' THEN
    SELECT * INTO v_base FROM public.ticket_ejemplar b
     WHERE b.id = NEW.ejemplar_base_id AND b.empresa_id = NEW.empresa_id AND b.ticket_id = NEW.ticket_id;
    IF NOT FOUND OR v_base.numero_de_ejemplar + 1 <> NEW.numero_de_ejemplar THEN
      RAISE EXCEPTION 'la corrección cuelga del ejemplar inmediato anterior del mismo ticket'
        USING ERRCODE = '23514', CONSTRAINT = 'ejemplar_base_invalida';
    END IF;
    IF (NEW.tipo = 'ANULACION') <> (v_ticket.estado = 'ANULADO') THEN
      RAISE EXCEPTION 'el ejemplar de anulación va con el ticket anulado, y solo él'
        USING ERRCODE = '23514', CONSTRAINT = 'ejemplar_anulacion_invalida';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION ejemplar_hijo_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ticket_ejemplar e
     WHERE e.id = NEW.ejemplar_id AND e.empresa_id = NEW.empresa_id AND e.xmin = pg_current_xact_id()::xid AND e.tipo <> 'ANULACION'
  ) THEN
    RAISE EXCEPTION 'los grupos y renglones de un ejemplar entran con el ejemplar, en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'ejemplar_contenido_solo_con_el_ejemplar';
  END IF;
  RETURN NEW;
END
$$;

-- V4: Σ renglones = grupo, Σ grupos = total del ejemplar, y los renglones son de la cuenta del ticket; el ORIGINAL refleja TODAS las
-- líneas vigentes de la cuenta, con su cantidad. Se comprueba al confirmar, desde las tres tablas del ejemplar.
CREATE FUNCTION ejemplar_cuadra() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_ejemplar uuid;
  v_empresa uuid;
  e public.ticket_ejemplar%ROWTYPE;
  v_cuenta uuid;
BEGIN
  IF TG_TABLE_NAME = 'ticket_ejemplar' THEN
    v_ejemplar := NEW.id;
  ELSE
    v_ejemplar := NEW.ejemplar_id;
  END IF;
  v_empresa := NEW.empresa_id;
  SELECT * INTO e FROM public.ticket_ejemplar x WHERE x.id = v_ejemplar AND x.empresa_id = v_empresa;
  IF e.tipo = 'ANULACION' THEN
    IF EXISTS (SELECT 1 FROM public.ejemplar_grupo g WHERE g.ejemplar_id = e.id) THEN
      RAISE EXCEPTION 'un ejemplar de anulación no lleva grupos' USING ERRCODE = '23514', CONSTRAINT = 'ejemplar_cuadra';
    END IF;
    RETURN NULL;
  END IF;
  IF e.total IS DISTINCT FROM (SELECT coalesce(sum(g.total), 0) FROM public.ejemplar_grupo g WHERE g.ejemplar_id = e.id)
     OR EXISTS (
       SELECT 1 FROM public.ejemplar_grupo g
        WHERE g.ejemplar_id = e.id
          AND g.total IS DISTINCT FROM (SELECT coalesce(sum(l.importe), 0) FROM public.ejemplar_linea l
                                         WHERE l.ejemplar_id = e.id AND l.grupo_orden = g.orden)) THEN
    RAISE EXCEPTION 'el ejemplar no cuadra: la suma de sus renglones y grupos no es su total'
      USING ERRCODE = '23514', CONSTRAINT = 'ejemplar_cuadra';
  END IF;
  SELECT t.cuenta_id INTO v_cuenta FROM public.ticket t WHERE t.id = e.ticket_id AND t.empresa_id = e.empresa_id;
  IF EXISTS (
    SELECT 1 FROM public.ejemplar_linea l
     WHERE l.ejemplar_id = e.id
       AND NOT EXISTS (SELECT 1 FROM public.linea_cuenta c
                        WHERE c.id = l.linea_cuenta_id AND c.empresa_id = l.empresa_id AND c.cuenta_id = v_cuenta
                          AND l.cantidad <= c.cantidad AND l.cantidad % c.paso_de_cantidad = 0)) THEN
    RAISE EXCEPTION 'un renglón del ejemplar no es de una línea de la cuenta del ticket, o excede su cantidad o su paso'
      USING ERRCODE = '23514', CONSTRAINT = 'ejemplar_linea_ajena';
  END IF;
  IF e.tipo = 'ORIGINAL' AND (
    EXISTS (SELECT 1 FROM public.linea_cuenta c
             WHERE c.cuenta_id = v_cuenta AND c.empresa_id = e.empresa_id AND c.estado = 'VIGENTE'
               AND NOT EXISTS (SELECT 1 FROM public.ejemplar_linea l
                                WHERE l.ejemplar_id = e.id AND l.linea_cuenta_id = c.id AND l.cantidad = c.cantidad))
    OR EXISTS (SELECT 1 FROM public.ejemplar_linea l JOIN public.linea_cuenta c ON c.id = l.linea_cuenta_id AND c.empresa_id = l.empresa_id
                WHERE l.ejemplar_id = e.id AND c.estado <> 'VIGENTE')) THEN
    RAISE EXCEPTION 'el ejemplar original no refleja las líneas vigentes de la cuenta'
      USING ERRCODE = '23514', CONSTRAINT = 'ejemplar_original_no_refleja_la_cuenta';
  END IF;
  -- El original lleva el total del ticket (que es el de la cuenta, `ticket_cuenta_invalida`): el ticket no puede decir una cosa y su original otra.
  IF e.tipo = 'ORIGINAL' AND e.total IS DISTINCT FROM (SELECT t.total FROM public.ticket t WHERE t.id = e.ticket_id AND t.empresa_id = e.empresa_id) THEN
    RAISE EXCEPTION 'el total del ejemplar original no es el del ticket'
      USING ERRCODE = '23514', CONSTRAINT = 'ejemplar_cuadra';
  END IF;
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Disparadores: cobranza, aplicación y corrección
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION cobranza_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_ticket public.ticket%ROWTYPE;
BEGIN
  SELECT * INTO v_ticket FROM public.ticket t WHERE t.id = NEW.ticket_id AND t.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_ticket.estado <> 'EMITIDO' OR v_ticket.ejemplar_vigente IS DISTINCT FROM
     (SELECT e.numero_de_ejemplar FROM public.ticket_ejemplar e
       WHERE e.id = NEW.ejemplar_id AND e.empresa_id = NEW.empresa_id AND e.ticket_id = NEW.ticket_id) THEN
    RAISE EXCEPTION 'solo se cobra un ticket emitido, con su ejemplar vigente'
      USING ERRCODE = '23514', CONSTRAINT = 'cobranza_ticket_no_cobrable';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION cobranza_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  -- Solo `resultado` se escribe, una sola vez (de NULL a un objeto).
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
     OR NEW.ejemplar_id IS DISTINCT FROM OLD.ejemplar_id OR NEW.caja_id IS DISTINCT FROM OLD.caja_id
     OR NEW.clave IS DISTINCT FROM OLD.clave OR NEW.huella IS DISTINCT FROM OLD.huella OR NEW.destino IS DISTINCT FROM OLD.destino
     OR NEW.creada_por IS DISTINCT FROM OLD.creada_por OR NEW.creada_en IS DISTINCT FROM OLD.creada_en
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en OR OLD.resultado IS NOT NULL OR NEW.resultado IS NULL THEN
    RAISE EXCEPTION 'una cobranza solo guarda su resultado, una vez'
      USING ERRCODE = '23514', CONSTRAINT = 'cobranza_inmutable';
  END IF;
  RETURN NEW;
END
$$;

-- V7: lo aplicado suma, al centavo, el total del ejemplar que se cobró.
CREATE FUNCTION cobranza_cuadra() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_cobranza uuid;
  v_empresa uuid;
  v_total numeric;
  v_aplicado numeric;
BEGIN
  IF TG_TABLE_NAME = 'cobranza_de_ticket' THEN
    v_cobranza := NEW.id;
  ELSE
    v_cobranza := NEW.cobranza_id;
  END IF;
  v_empresa := NEW.empresa_id;
  SELECT e.total INTO v_total FROM public.cobranza_de_ticket c
    JOIN public.ticket_ejemplar e ON e.id = c.ejemplar_id AND e.empresa_id = c.empresa_id
   WHERE c.id = v_cobranza AND c.empresa_id = v_empresa;
  SELECT coalesce(sum(a.importe), 0) INTO v_aplicado FROM public.aplicacion_de_cobro a WHERE a.cobranza_id = v_cobranza AND a.empresa_id = v_empresa;
  IF v_total IS DISTINCT FROM v_aplicado THEN
    RAISE EXCEPTION 'lo cobrado (%) no es el total del ticket (%)', v_aplicado, v_total
      USING ERRCODE = '23514', CONSTRAINT = 'cobranza_cuadra';
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION aplicacion_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.cobranza_de_ticket c WHERE c.id = NEW.cobranza_id AND c.empresa_id = NEW.empresa_id AND c.xmin = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'las aplicaciones de un cobro entran con su cobranza, en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'aplicacion_solo_con_la_cobranza';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION correccion_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_base public.ticket_ejemplar%ROWTYPE;
  v_nuevo public.ticket_ejemplar%ROWTYPE;
BEGIN
  SELECT * INTO v_base FROM public.ticket_ejemplar e WHERE e.id = NEW.ejemplar_base_id AND e.empresa_id = NEW.empresa_id AND e.ticket_id = NEW.ticket_id;
  SELECT * INTO v_nuevo FROM public.ticket_ejemplar e WHERE e.id = NEW.ejemplar_nuevo_id AND e.empresa_id = NEW.empresa_id AND e.ticket_id = NEW.ticket_id;
  IF v_base.id IS NULL OR v_nuevo.id IS NULL OR v_nuevo.ejemplar_base_id IS DISTINCT FROM v_base.id
     OR v_nuevo.tipo <> NEW.tipo OR NOT EXISTS (
       SELECT 1 FROM public.ticket_ejemplar e WHERE e.id = NEW.ejemplar_nuevo_id AND e.empresa_id = NEW.empresa_id
          AND e.xmin = pg_current_xact_id()::xid) THEN
    RAISE EXCEPTION 'el registro de corrección une el ejemplar base con el nuevo, del mismo tipo, creado en esta transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'correccion_ejemplares_invalidos';
  END IF;
  -- La jornada en que se hace es por reloj (V8): la fija la base y no se acepta de la aplicación.
  NEW.fecha_negocio := public.fecha_de_negocio_de(NEW.empresa_id,
    (SELECT t.sucursal_id FROM public.ticket t WHERE t.id = NEW.ticket_id AND t.empresa_id = NEW.empresa_id), NEW.hecha_en);
  IF NEW.fecha_negocio IS NULL THEN
    RAISE EXCEPTION 'no se pudo fechar la corrección: sucursal desconocida'
      USING ERRCODE = '23514', CONSTRAINT = 'correccion_fecha_invalida';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Disparadores: se instalan
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER cuenta_alta BEFORE INSERT ON cuenta_consumo FOR EACH ROW EXECUTE FUNCTION cuenta_validar_alta();
-- El nombre ordena `cuenta_cambio` antes de `cuenta_version` (los BEFORE de un mismo evento corren en orden alfabético).
CREATE TRIGGER cuenta_cambio BEFORE UPDATE ON cuenta_consumo FOR EACH ROW EXECUTE FUNCTION cuenta_validar_cambio();
CREATE TRIGGER cuenta_version BEFORE UPDATE ON cuenta_consumo FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE CONSTRAINT TRIGGER cuenta_total_de_la_cuenta AFTER INSERT OR UPDATE ON cuenta_consumo
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cuenta_total_cuadra();
CREATE CONSTRAINT TRIGGER cuenta_total_de_la_linea AFTER INSERT OR UPDATE ON linea_cuenta
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cuenta_total_cuadra();

CREATE TRIGGER linea_alta BEFORE INSERT ON linea_cuenta FOR EACH ROW EXECUTE FUNCTION linea_validar_alta();
CREATE TRIGGER linea_cambio BEFORE UPDATE ON linea_cuenta FOR EACH ROW EXECUTE FUNCTION linea_validar_cambio();
CREATE TRIGGER linea_version BEFORE UPDATE ON linea_cuenta FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE CONSTRAINT TRIGGER linea_precio_de_la_linea AFTER INSERT ON linea_cuenta
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION linea_precio_cuadra();
CREATE TRIGGER linea_opcion_alta BEFORE INSERT ON linea_cuenta_opcion FOR EACH ROW EXECUTE FUNCTION linea_opcion_validar_alta();

CREATE TRIGGER numerador_alta BEFORE INSERT ON numerador_ticket FOR EACH ROW EXECUTE FUNCTION numerador_validar_alta();
CREATE TRIGGER numerador_cambio BEFORE UPDATE ON numerador_ticket FOR EACH ROW EXECUTE FUNCTION numerador_validar_cambio();
CREATE TRIGGER numerador_version BEFORE UPDATE ON numerador_ticket FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE CONSTRAINT TRIGGER numerador_sin_huecos_ck AFTER UPDATE ON numerador_ticket
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION numerador_sin_huecos();

CREATE TRIGGER ticket_alta BEFORE INSERT ON ticket FOR EACH ROW EXECUTE FUNCTION ticket_validar_alta();
CREATE TRIGGER ticket_cambio BEFORE UPDATE ON ticket FOR EACH ROW EXECUTE FUNCTION ticket_validar_cambio();
CREATE TRIGGER ticket_version BEFORE UPDATE ON ticket FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE CONSTRAINT TRIGGER ticket_vigente_del_ticket AFTER INSERT OR UPDATE ON ticket
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ticket_ejemplar_vigente_existe();
CREATE CONSTRAINT TRIGGER ticket_vigente_del_ejemplar AFTER INSERT ON ticket_ejemplar
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ticket_ejemplar_vigente_existe();

CREATE TRIGGER ejemplar_alta BEFORE INSERT ON ticket_ejemplar FOR EACH ROW EXECUTE FUNCTION ejemplar_validar_alta();
CREATE TRIGGER ejemplar_grupo_alta BEFORE INSERT ON ejemplar_grupo FOR EACH ROW EXECUTE FUNCTION ejemplar_hijo_validar_alta();
CREATE TRIGGER ejemplar_linea_alta BEFORE INSERT ON ejemplar_linea FOR EACH ROW EXECUTE FUNCTION ejemplar_hijo_validar_alta();
CREATE CONSTRAINT TRIGGER ejemplar_cuadra_del_ejemplar AFTER INSERT ON ticket_ejemplar
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ejemplar_cuadra();
CREATE CONSTRAINT TRIGGER ejemplar_cuadra_del_grupo AFTER INSERT ON ejemplar_grupo
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ejemplar_cuadra();
CREATE CONSTRAINT TRIGGER ejemplar_cuadra_del_renglon AFTER INSERT ON ejemplar_linea
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ejemplar_cuadra();

CREATE TRIGGER cobranza_alta BEFORE INSERT ON cobranza_de_ticket FOR EACH ROW EXECUTE FUNCTION cobranza_validar_alta();
CREATE TRIGGER cobranza_cambio BEFORE UPDATE ON cobranza_de_ticket FOR EACH ROW EXECUTE FUNCTION cobranza_validar_cambio();
CREATE CONSTRAINT TRIGGER cobranza_cuadra_de_la_cobranza AFTER INSERT ON cobranza_de_ticket
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cobranza_cuadra();
CREATE CONSTRAINT TRIGGER cobranza_cuadra_de_la_aplicacion AFTER INSERT ON aplicacion_de_cobro
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cobranza_cuadra();
CREATE TRIGGER aplicacion_alta BEFORE INSERT ON aplicacion_de_cobro FOR EACH ROW EXECUTE FUNCTION aplicacion_validar_alta();
CREATE TRIGGER correccion_alta BEFORE INSERT ON ticket_correccion FOR EACH ROW EXECUTE FUNCTION correccion_validar_alta();

-- Nada se borra ni se vacía (ni el dueño de la base): se anula con un registro nuevo. Las de solo inserción frenan también el UPDATE.
CREATE TRIGGER cuenta_sin_borrado BEFORE DELETE ON cuenta_consumo FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER cuenta_sin_truncate BEFORE TRUNCATE ON cuenta_consumo FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER linea_sin_borrado BEFORE DELETE ON linea_cuenta FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER linea_sin_truncate BEFORE TRUNCATE ON linea_cuenta FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER numerador_sin_borrado BEFORE DELETE ON numerador_ticket FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER numerador_sin_truncate BEFORE TRUNCATE ON numerador_ticket FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER ticket_sin_borrado BEFORE DELETE ON ticket FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER ticket_sin_truncate BEFORE TRUNCATE ON ticket FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER cobranza_sin_borrado BEFORE DELETE ON cobranza_de_ticket FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER cobranza_sin_truncate BEFORE TRUNCATE ON cobranza_de_ticket FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER linea_opcion_solo_insercion BEFORE UPDATE OR DELETE ON linea_cuenta_opcion FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER linea_opcion_sin_truncate BEFORE TRUNCATE ON linea_cuenta_opcion FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER ejemplar_solo_insercion BEFORE UPDATE OR DELETE ON ticket_ejemplar FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER ejemplar_sin_truncate BEFORE TRUNCATE ON ticket_ejemplar FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER ejemplar_grupo_solo_insercion BEFORE UPDATE OR DELETE ON ejemplar_grupo FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER ejemplar_grupo_sin_truncate BEFORE TRUNCATE ON ejemplar_grupo FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER ejemplar_linea_solo_insercion BEFORE UPDATE OR DELETE ON ejemplar_linea FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER ejemplar_linea_sin_truncate BEFORE TRUNCATE ON ejemplar_linea FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER aplicacion_solo_insercion BEFORE UPDATE OR DELETE ON aplicacion_de_cobro FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER aplicacion_sin_truncate BEFORE TRUNCATE ON aplicacion_de_cobro FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER correccion_solo_insercion BEFORE UPDATE OR DELETE ON ticket_correccion FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER correccion_sin_truncate BEFORE TRUNCATE ON ticket_correccion FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE. Solo la aplicación (la plataforma, el grupo y los trabajos, nada).
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON cuenta_consumo, linea_cuenta, linea_cuenta_opcion, numerador_ticket, ticket, ticket_ejemplar, ejemplar_grupo,
  ejemplar_linea, cobranza_de_ticket, aplicacion_de_cobro, ticket_correccion FROM PUBLIC;

GRANT SELECT ON cuenta_consumo, linea_cuenta, linea_cuenta_opcion, numerador_ticket, ticket, ticket_ejemplar, ejemplar_grupo,
  ejemplar_linea, cobranza_de_ticket, aplicacion_de_cobro, ticket_correccion TO pedernal_app;

GRANT INSERT (id, empresa_id, sucursal_id, ancla_tipo, ancla_id, etiqueta, abierta_por, abierta_en) ON cuenta_consumo TO pedernal_app;
GRANT UPDATE (estado, total_provisorio, ultima_posicion, resuelta_por, resuelta_en, motivo) ON cuenta_consumo TO pedernal_app;

GRANT INSERT (id, empresa_id, cuenta_id, posicion, producto_id, descripcion, variante_opcion_id, variante_nombre, precio_id,
              origen_del_precio, precio_base, precio_unitario, cantidad, unidad_de_venta, paso_de_cantidad, alicuota, controla_stock,
              creada_por, creada_en)
  ON linea_cuenta TO pedernal_app;
GRANT UPDATE (estado, anulada_por, anulada_en, motivo_de_anulacion) ON linea_cuenta TO pedernal_app;

GRANT INSERT (empresa_id, linea_id, orden, opcion_id, version_de_opcion_id, grupo_id, nombre_de_grupo, nombre, clase, recargo,
              origen_del_recargo)
  ON linea_cuenta_opcion TO pedernal_app;

GRANT INSERT (empresa_id, sucursal_id) ON numerador_ticket TO pedernal_app;
GRANT UPDATE (ultimo) ON numerador_ticket TO pedernal_app;

-- `fecha_negocio` no se concede: la fija el disparador (V5).
GRANT INSERT (id, empresa_id, sucursal_id, cuenta_id, numero, estado, total, sesion_de_caja_id, emitido_por, emitido_en)
  ON ticket TO pedernal_app;
GRANT UPDATE (estado, ejemplar_vigente) ON ticket TO pedernal_app;

GRANT INSERT (id, empresa_id, ticket_id, numero_de_ejemplar, tipo, total, ejemplar_base_id, creado_por, creado_en)
  ON ticket_ejemplar TO pedernal_app;
GRANT INSERT (empresa_id, ejemplar_id, orden, total, emisor_id) ON ejemplar_grupo TO pedernal_app;
GRANT INSERT (empresa_id, ejemplar_id, grupo_orden, linea_cuenta_id, cantidad, importe) ON ejemplar_linea TO pedernal_app;

GRANT INSERT (id, empresa_id, ticket_id, ejemplar_id, caja_id, clave, huella, destino, creada_por, creada_en)
  ON cobranza_de_ticket TO pedernal_app;
GRANT UPDATE (resultado) ON cobranza_de_ticket TO pedernal_app;
GRANT INSERT (empresa_id, cobranza_id, orden, cobro_id, cuenta_de_cobro_id, importe) ON aplicacion_de_cobro TO pedernal_app;

-- `fecha_negocio` no se concede: la fija el disparador (V8).
GRANT INSERT (id, empresa_id, ticket_id, ejemplar_base_id, ejemplar_nuevo_id, tipo, motivo, clave, huella, resultado, hecha_por,
              hecha_en)
  ON ticket_correccion TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada; sin política no hay acceso (el dueño de la base tampoco ve nada sin BYPASSRLS)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE cuenta_consumo ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuenta_consumo FORCE ROW LEVEL SECURITY;
ALTER TABLE linea_cuenta ENABLE ROW LEVEL SECURITY;
ALTER TABLE linea_cuenta FORCE ROW LEVEL SECURITY;
ALTER TABLE linea_cuenta_opcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE linea_cuenta_opcion FORCE ROW LEVEL SECURITY;
ALTER TABLE numerador_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE numerador_ticket FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_ejemplar ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_ejemplar FORCE ROW LEVEL SECURITY;
ALTER TABLE ejemplar_grupo ENABLE ROW LEVEL SECURITY;
ALTER TABLE ejemplar_grupo FORCE ROW LEVEL SECURITY;
ALTER TABLE ejemplar_linea ENABLE ROW LEVEL SECURITY;
ALTER TABLE ejemplar_linea FORCE ROW LEVEL SECURITY;
ALTER TABLE cobranza_de_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobranza_de_ticket FORCE ROW LEVEL SECURITY;
ALTER TABLE aplicacion_de_cobro ENABLE ROW LEVEL SECURITY;
ALTER TABLE aplicacion_de_cobro FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_correccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_correccion FORCE ROW LEVEL SECURITY;

-- Leer: la empresa del contexto. Alta: además opera y, donde hay persona, es la del contexto. Cambiar: la empresa del contexto opera.
CREATE POLICY cuenta_app_leer ON cuenta_consumo FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY cuenta_app_alta ON cuenta_consumo FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND abierta_por = (SELECT app_persona_id()));
CREATE POLICY cuenta_app_cambiar ON cuenta_consumo FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY linea_app_leer ON linea_cuenta FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY linea_app_alta ON linea_cuenta FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND creada_por = (SELECT app_persona_id()));
CREATE POLICY linea_app_cambiar ON linea_cuenta FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY linea_opcion_app_leer ON linea_cuenta_opcion FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY linea_opcion_app_alta ON linea_cuenta_opcion FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY numerador_app_leer ON numerador_ticket FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY numerador_app_alta ON numerador_ticket FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY numerador_app_cambiar ON numerador_ticket FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY ticket_app_leer ON ticket FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY ticket_app_alta ON ticket FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND emitido_por = (SELECT app_persona_id()));
CREATE POLICY ticket_app_cambiar ON ticket FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY ejemplar_app_leer ON ticket_ejemplar FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY ejemplar_app_alta ON ticket_ejemplar FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND creado_por = (SELECT app_persona_id()));
CREATE POLICY ejemplar_grupo_app_leer ON ejemplar_grupo FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY ejemplar_grupo_app_alta ON ejemplar_grupo FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY ejemplar_linea_app_leer ON ejemplar_linea FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY ejemplar_linea_app_alta ON ejemplar_linea FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY cobranza_app_leer ON cobranza_de_ticket FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY cobranza_app_alta ON cobranza_de_ticket FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND creada_por = (SELECT app_persona_id()));
CREATE POLICY cobranza_app_cambiar ON cobranza_de_ticket FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY aplicacion_app_leer ON aplicacion_de_cobro FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY aplicacion_app_alta ON aplicacion_de_cobro FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY correccion_app_leer ON ticket_correccion FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY correccion_app_alta ON ticket_correccion FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND hecha_por = (SELECT app_persona_id()));
