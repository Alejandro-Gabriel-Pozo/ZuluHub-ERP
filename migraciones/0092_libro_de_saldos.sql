-- 0092_libro_de_saldos: LB-3, el libro de saldos por parte (clientes y proveedores): asientos, imputaciones, centro de costo y saldos derivados.
-- QUÉ HACE (solo tablas nuevas; nadie la escribe todavía, la usa LB-4):
--   1. `clase_de_asiento`: catálogo sembrado (solo A_PAGAR; las de A_COBRAR las siembra CC-1). Todo nace cerrado: una clase no sembrada no se usa.
--   2. `asiento_de_saldo` (el libro, solo inserción) y `distribucion_de_asiento` (su centro de costo, solo inserción): el saldo es UNO por empresa y
--      parte; cada importe lleva su distribución por sucursal que suma exacto (disparador diferido, al confirmar). Se anula con un espejo.
--   3. `imputacion_de_saldo` (solo inserción): qué asiento negativo salda a qué asiento positivo. Los topes los imponen CHECK sobre filas derivadas.
--   4. Cuatro tablas derivadas que escribe SOLO un disparador (`libro_saldo_guardia`, profundidad >= 2): `saldo_de_asiento`, `saldo_de_imputacion`,
--      `saldo_de_parte` y `saldo_de_parte_por_centro_de_costo`.
-- NO TOCA ninguna tabla existente (ni `parte`, ni compras, ventas o caja), no rellena nada. Sin cambios destructivos.
-- Reversión: `migraciones/reversiones/0092_revertir_libro_de_saldos.sql` (frena si hay asientos; avisar al dueño).
-- DEPENDE de 0001 (`solo_insercion`, `app_empresa_id`, `app_persona_id`, `empresa_operable`, `persona`, `empresa`), 0027 (`fecha_de_negocio`),
--   `sucursal (id, empresa_id)` (la usa 0091 como destino de FK) y 0034 (`parte`, `parte_id_empresa_uk`, estados ACTIVA/INACTIVA/ANONIMIZADA).
-- Probada por `test/integracion/libro-saldos-migracion.test.ts` y `libros-conformidad.test.ts` (el libro se registra en `registro.ts`).
-- Solo corre contra el Postgres local de las pruebas; nunca contra Neon (la aplica `migrar.yml`, con snapshot previo).
-- Los textos (`detalle`) y la forma de la clave son los de sus primitivas: una prueba de paridad falla si difieren.

-- =============================================================================================
-- 1. Catálogo de clases (global, sembrado, solo inserción)
-- =============================================================================================
-- BRIEF: la clave es (sentido, clase), no solo `clase`: `PR-CP` y `PR-CC` usan el mismo nombre `CREDITO_A_FAVOR` en sentidos distintos.
-- BRIEF: se quitan `exige_origen` (todo asiento lleva origen: es la identidad del efecto) y `es_imputable` (en `PR-CP` toda clase se imputa:
--   nota, pago, reintegro, anticipo, retención y ajuste tienen su pendiente); se agrega `admite_vencimiento` (`PR-CC`: el crédito a favor vence).
CREATE TABLE clase_de_asiento (
  sentido            text NOT NULL,
  clase              text NOT NULL,
  signo              text NOT NULL,                 -- '+' aumenta lo que se debe; '-' lo reduce; '±' lo decide el asiento (y exige detalle)
  exige_detalle      boolean NOT NULL,
  admite_vencimiento boolean NOT NULL,
  CONSTRAINT clase_de_asiento_pkey PRIMARY KEY (sentido, clase),
  CONSTRAINT clase_de_asiento_sentido_ck CHECK (sentido IN ('A_COBRAR', 'A_PAGAR')),
  CONSTRAINT clase_de_asiento_clase_ck CHECK (clase ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  CONSTRAINT clase_de_asiento_signo_ck CHECK (signo IN ('+', '-', '±')),
  CONSTRAINT clase_de_asiento_ajuste_ck CHECK (signo <> '±' OR exige_detalle)
);

-- Siembra de A_PAGAR (proveedores; `PR-CP` y decisión del dueño del 20/11). Se siembra ANTES de activar la RLS (la migración no es BYPASSRLS).
INSERT INTO clase_de_asiento (sentido, clase, signo, exige_detalle, admite_vencimiento) VALUES
  ('A_PAGAR', 'CARGO_DE_FACTURA_DE_COMPRA', '+', false, true),
  ('A_PAGAR', 'NOTA_DE_CREDITO_DE_COMPRA', '-', false, false),
  ('A_PAGAR', 'PAGO_A_PROVEEDOR', '-', false, false),
  ('A_PAGAR', 'REINTEGRO_DE_PROVEEDOR', '+', false, false),
  ('A_PAGAR', 'CREDITO_A_FAVOR', '-', false, false),
  ('A_PAGAR', 'RETENCION_PRACTICADA', '-', false, false),
  ('A_PAGAR', 'AJUSTE_DE_SALDO', '±', true, false);

-- =============================================================================================
-- 2. El libro: asiento_de_saldo
-- =============================================================================================
CREATE TABLE asiento_de_saldo (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  parte_id            uuid NOT NULL,
  sentido             text NOT NULL,
  clase               text NOT NULL,
  -- BRIEF: `naturaleza` existe para que la conformidad (LB-2, C5) vea un CHECK `'ANULACION' ⇔ anula_a IS NOT NULL` SIN que el espejo pierda la clase de
  --   su original (`espejoDe`, LB-1, conserva la clase; los informes por clase compensan una retención con su espejo).
  naturaleza          text NOT NULL DEFAULT 'ORIGINAL',
  importe             numeric(18,2) NOT NULL,        -- con signo: ver la convención del encabezado
  moneda              char(3) NOT NULL DEFAULT 'ARS',
  origen_tipo         text NOT NULL,                 -- `modulo.hecho`, opaco (sin FK a otros módulos)
  origen_id           uuid NOT NULL,
  origen_orden        integer NOT NULL DEFAULT 1,    -- varios asientos por origen (una fila por parte de origen: `PR-CC` §8; retenciones de un pago)
  referencia_tipo     text,                          -- opacas, las dos o ninguna
  referencia_id       uuid,
  vence_el            date,                          -- BRIEF: lo admite la clase (`admite_vencimiento`), no el signo: el crédito a favor de clientes vence
  detalle             text,                          -- el motivo: obligatorio en el espejo y en las clases que lo exigen; en las demás, no se admite
  anula_a             uuid,
  clave_idempotencia  text NOT NULL,
  huella              text NOT NULL,
  hecho_en            timestamptz NOT NULL,          -- el `ahora` de la aplicación, no now()
  registrado_en       timestamptz NOT NULL DEFAULT now(),
  fecha_negocio       date NOT NULL,                 -- la fija el disparador: la aplicación no la manda
  registrado_por      uuid NOT NULL,
  CONSTRAINT asiento_de_saldo_pkey PRIMARY KEY (empresa_id, id),
  -- Ancla de las claves foráneas de imputación y de espejo: no se imputa ni se anula entre partes ni entre sentidos (lo impone la FK, no el código).
  CONSTRAINT asiento_de_saldo_ancla_uk UNIQUE (id, empresa_id, parte_id, sentido),
  CONSTRAINT asiento_de_saldo_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  -- BRIEF: NO parcial (la conformidad C5 descarta los índices parciales; con NULL en `anula_a` varios originales conviven igual).
  CONSTRAINT asiento_de_saldo_anula_uk UNIQUE (empresa_id, anula_a),
  CONSTRAINT asiento_de_saldo_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT asiento_de_saldo_parte_fkey FOREIGN KEY (parte_id, empresa_id) REFERENCES parte (id, empresa_id),
  -- El sentido tiene que ser el de la clase (así «sentido admitido» lo impone la FK).
  CONSTRAINT asiento_de_saldo_clase_fkey FOREIGN KEY (sentido, clase) REFERENCES clase_de_asiento (sentido, clase),
  CONSTRAINT asiento_de_saldo_anula_fkey FOREIGN KEY (anula_a, empresa_id, parte_id, sentido)
    REFERENCES asiento_de_saldo (id, empresa_id, parte_id, sentido),
  CONSTRAINT asiento_de_saldo_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES persona (id),
  CONSTRAINT asiento_de_saldo_sentido_ck CHECK (sentido IN ('A_COBRAR', 'A_PAGAR')),
  CONSTRAINT asiento_de_saldo_naturaleza_ck CHECK (naturaleza IN ('ORIGINAL', 'ANULACION')),
  -- C5 de la conformidad (el literal `'ANULACION'` y `anula_a IS NOT NULL` en el mismo CHECK) y un asiento no se anula a sí mismo.
  CONSTRAINT asiento_de_saldo_espejo_ck CHECK ((naturaleza = 'ANULACION') = (anula_a IS NOT NULL) AND anula_a IS DISTINCT FROM id),
  -- BRIEF: `detalle ⇔ anula_a` del brief contradecía a AJUSTE_DE_SALDO (exige detalle y no es espejo): el espejo exige detalle acá; el resto lo decide la clase (disparador).
  CONSTRAINT asiento_de_saldo_espejo_detalle_ck CHECK (naturaleza <> 'ANULACION' OR detalle IS NOT NULL),
  -- C6 de la conformidad: un CHECK propio de `importe <> 0` (la conformidad lo busca con esa forma).
  CONSTRAINT asiento_de_saldo_importe_no_cero_ck CHECK (importe <> 0),
  CONSTRAINT asiento_de_saldo_importe_tope_ck CHECK (abs(importe) <= 999999999.99),
  CONSTRAINT asiento_de_saldo_moneda_ck CHECK (moneda = 'ARS'),
  CONSTRAINT asiento_de_saldo_origen_tipo_ck CHECK (origen_tipo ~ '^[a-z_]+\.[a-z_]+$' AND char_length(origen_tipo) <= 80),
  CONSTRAINT asiento_de_saldo_origen_orden_ck CHECK (origen_orden BETWEEN 1 AND 1000),
  CONSTRAINT asiento_de_saldo_referencia_ck CHECK (
    (referencia_tipo IS NULL) = (referencia_id IS NULL)
    AND (referencia_tipo IS NULL OR (referencia_tipo ~ '^[a-z_]+\.[a-z_]+$' AND char_length(referencia_tipo) <= 80))
  ),
  CONSTRAINT asiento_de_saldo_vence_el_ck CHECK (vence_el IS NULL OR (naturaleza = 'ORIGINAL' AND isfinite(vence_el))),
  CONSTRAINT asiento_de_saldo_hecho_en_ck CHECK (isfinite(hecho_en)),
  -- Mismo texto que el `motivo` de `movimiento_de_dinero` (0091); la primitiva del detalle la fija LB-4 y una prueba de paridad compara.
  CONSTRAINT asiento_de_saldo_detalle_ck CHECK (
    detalle IS NULL OR (
      detalle = btrim(detalle) AND detalle !~ ' {2}' AND char_length(detalle) BETWEEN 1 AND 500
      AND detalle ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'
    )
  ),
  -- Misma forma que caja y compras (`FORMA_DE_CLAVE`, LB-1): la copia la compara la conformidad.
  CONSTRAINT asiento_de_saldo_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  CONSTRAINT asiento_de_saldo_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$')
);
-- Identidad del efecto: un origen + orden, un solo asiento ORIGINAL (el espejo comparte origen con su original y por eso no entra).
CREATE UNIQUE INDEX asiento_de_saldo_origen_uk ON asiento_de_saldo (empresa_id, origen_tipo, origen_id, origen_orden) WHERE anula_a IS NULL;
-- Estado de cuenta y saldos por parte.
CREATE INDEX asiento_de_saldo_parte_ix ON asiento_de_saldo (empresa_id, parte_id, sentido, fecha_negocio, id);
-- Cargos abiertos «lo más antiguo primero» (LB-4 `cargosAbiertos`): por vencimiento (sin vencimiento al final), luego por antigüedad.
CREATE INDEX asiento_de_saldo_cargo_ix ON asiento_de_saldo (empresa_id, parte_id, sentido, vence_el NULLS LAST, registrado_en, id)
  WHERE importe > 0 AND naturaleza = 'ORIGINAL';

-- =============================================================================================
-- 3. Centro de costo: distribucion_de_asiento (solo inserción)
-- =============================================================================================
CREATE TABLE distribucion_de_asiento (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  asiento_id  uuid NOT NULL,
  sucursal_id uuid,                                  -- NULL = «sin centro de costo»: se registra y se etiqueta, no se bloquea
  importe     numeric(18,2) NOT NULL,                -- mismo signo que el asiento (lo verifica el disparador diferido)
  moneda      char(3) NOT NULL DEFAULT 'ARS',
  CONSTRAINT distribucion_de_asiento_pkey PRIMARY KEY (empresa_id, id),
  CONSTRAINT distribucion_de_asiento_asiento_uk UNIQUE NULLS NOT DISTINCT (empresa_id, asiento_id, sucursal_id),
  CONSTRAINT distribucion_de_asiento_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT distribucion_de_asiento_asiento_fkey FOREIGN KEY (asiento_id, empresa_id) REFERENCES asiento_de_saldo (id, empresa_id),
  -- Con `sucursal_id` NULL la FK no se evalúa (MATCH SIMPLE): es lo buscado.
  CONSTRAINT distribucion_de_asiento_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT distribucion_de_asiento_importe_no_cero_ck CHECK (importe <> 0),
  CONSTRAINT distribucion_de_asiento_importe_tope_ck CHECK (abs(importe) <= 999999999.99),
  CONSTRAINT distribucion_de_asiento_moneda_ck CHECK (moneda = 'ARS')
);

-- =============================================================================================
-- 4. Imputaciones: imputacion_de_saldo (solo inserción)
-- =============================================================================================
-- BRIEF: se quita la columna `acto` (la `clave_idempotencia` ya agrupa las filas de una misma operación, con `numero` como orden).
CREATE TABLE imputacion_de_saldo (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  numero              integer NOT NULL,
  saldante_id         uuid NOT NULL,                 -- el asiento de importe < 0 (pago, nota, crédito, retención)
  saldado_id          uuid NOT NULL,                 -- el asiento de importe > 0 (cargo, reintegro)
  parte_id            uuid NOT NULL,
  sentido             text NOT NULL,
  importe             numeric(18,2) NOT NULL,        -- > 0 al imputar; < 0 al deshacer
  moneda              char(3) NOT NULL DEFAULT 'ARS',
  clave_idempotencia  text NOT NULL,
  huella              text NOT NULL,
  registrado_en       timestamptz NOT NULL DEFAULT now(),
  registrado_por      uuid NOT NULL,
  CONSTRAINT imputacion_de_saldo_pkey PRIMARY KEY (empresa_id, id),
  CONSTRAINT imputacion_de_saldo_clave_uk UNIQUE (empresa_id, clave_idempotencia, numero),
  CONSTRAINT imputacion_de_saldo_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  -- Entre la misma parte y el mismo sentido: lo impone la FK (los dos asientos se anclan a la MISMA parte y sentido de la fila).
  CONSTRAINT imputacion_de_saldo_saldante_fkey FOREIGN KEY (saldante_id, empresa_id, parte_id, sentido)
    REFERENCES asiento_de_saldo (id, empresa_id, parte_id, sentido),
  CONSTRAINT imputacion_de_saldo_saldado_fkey FOREIGN KEY (saldado_id, empresa_id, parte_id, sentido)
    REFERENCES asiento_de_saldo (id, empresa_id, parte_id, sentido),
  CONSTRAINT imputacion_de_saldo_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES persona (id),
  CONSTRAINT imputacion_de_saldo_sentido_ck CHECK (sentido IN ('A_COBRAR', 'A_PAGAR')),
  CONSTRAINT imputacion_de_saldo_numero_ck CHECK (numero BETWEEN 1 AND 1000),
  CONSTRAINT imputacion_de_saldo_distintos_ck CHECK (saldante_id <> saldado_id),
  CONSTRAINT imputacion_de_saldo_importe_no_cero_ck CHECK (importe <> 0),
  CONSTRAINT imputacion_de_saldo_importe_tope_ck CHECK (abs(importe) <= 999999999.99),
  CONSTRAINT imputacion_de_saldo_moneda_ck CHECK (moneda = 'ARS'),
  CONSTRAINT imputacion_de_saldo_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  CONSTRAINT imputacion_de_saldo_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$')
);
CREATE INDEX imputacion_de_saldo_saldado_ix ON imputacion_de_saldo (empresa_id, saldado_id);
CREATE INDEX imputacion_de_saldo_saldante_ix ON imputacion_de_saldo (empresa_id, saldante_id);

-- =============================================================================================
-- 5. Derivados (los escribe SOLO un disparador anidado)
-- =============================================================================================
-- Cuánto de cada asiento está imputado. Todo asiento ORIGINAL tiene su fila (nace con él). Tres CHECK, tres errores distintos.
CREATE TABLE saldo_de_asiento (
  empresa_id       uuid NOT NULL,
  asiento_id       uuid NOT NULL,
  tope             numeric(18,2) NOT NULL,            -- |importe| del asiento (copiado: el CHECK de abajo no puede mirar otra tabla)
  importe_imputado numeric(18,2) NOT NULL DEFAULT 0,
  anulado          boolean NOT NULL DEFAULT false,    -- lo pone el disparador del espejo
  CONSTRAINT saldo_de_asiento_pkey PRIMARY KEY (empresa_id, asiento_id),
  CONSTRAINT saldo_de_asiento_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT saldo_de_asiento_asiento_fkey FOREIGN KEY (asiento_id, empresa_id) REFERENCES asiento_de_saldo (id, empresa_id),
  CONSTRAINT saldo_de_asiento_tope_positivo_ck CHECK (tope > 0),
  CONSTRAINT saldo_de_asiento_no_negativo_ck CHECK (importe_imputado >= 0),
  CONSTRAINT saldo_de_asiento_tope_ck CHECK (importe_imputado <= tope),
  -- Cierra «anular vs imputar» en la base: un asiento con algo imputado no se anula, y uno anulado no admite nada imputado.
  CONSTRAINT saldo_de_asiento_anulado_ck CHECK (NOT anulado OR importe_imputado = 0)
);
-- Los que todavía tienen pendiente (cargos y créditos abiertos).
CREATE INDEX saldo_de_asiento_abierto_ix ON saldo_de_asiento (empresa_id, asiento_id) WHERE NOT anulado AND importe_imputado < tope;

-- Neto imputado por par (saldante, saldado): el piso en cero impide deshacer más de lo imputado entre ESE par.
CREATE TABLE saldo_de_imputacion (
  empresa_id  uuid NOT NULL,
  saldante_id uuid NOT NULL,
  saldado_id  uuid NOT NULL,
  importe     numeric(18,2) NOT NULL,
  CONSTRAINT saldo_de_imputacion_pkey PRIMARY KEY (empresa_id, saldante_id, saldado_id),
  CONSTRAINT saldo_de_imputacion_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT saldo_de_imputacion_saldante_fkey FOREIGN KEY (saldante_id, empresa_id) REFERENCES asiento_de_saldo (id, empresa_id),
  CONSTRAINT saldo_de_imputacion_saldado_fkey FOREIGN KEY (saldado_id, empresa_id) REFERENCES asiento_de_saldo (id, empresa_id),
  CONSTRAINT saldo_de_imputacion_no_negativo_ck CHECK (importe >= 0)
);

-- Un saldo por empresa y parte (decisión del dueño 20/11: «la deuda es de la empresa»).
CREATE TABLE saldo_de_parte (
  empresa_id uuid NOT NULL,
  parte_id   uuid NOT NULL,
  sentido    text NOT NULL,
  moneda     char(3) NOT NULL,
  saldo      numeric(18,2) NOT NULL,
  CONSTRAINT saldo_de_parte_pkey PRIMARY KEY (empresa_id, parte_id, sentido, moneda),
  CONSTRAINT saldo_de_parte_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT saldo_de_parte_parte_fkey FOREIGN KEY (parte_id, empresa_id) REFERENCES parte (id, empresa_id),
  CONSTRAINT saldo_de_parte_sentido_ck CHECK (sentido IN ('A_COBRAR', 'A_PAGAR')),
  CONSTRAINT saldo_de_parte_moneda_ck CHECK (moneda = 'ARS')
);

-- El desglose por centro de costo (sucursal; NULL = «sin centro de costo»). Invariante (al confirmar): Σ por centro = `saldo_de_parte`.
CREATE TABLE saldo_de_parte_por_centro_de_costo (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  parte_id    uuid NOT NULL,
  sentido     text NOT NULL,
  moneda      char(3) NOT NULL,
  sucursal_id uuid,
  saldo       numeric(18,2) NOT NULL,
  CONSTRAINT saldo_de_parte_por_centro_pkey PRIMARY KEY (empresa_id, id),
  CONSTRAINT saldo_de_parte_por_centro_empresa_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT saldo_de_parte_por_centro_uk UNIQUE NULLS NOT DISTINCT (empresa_id, parte_id, sentido, moneda, sucursal_id),
  CONSTRAINT saldo_de_parte_por_centro_parte_fkey FOREIGN KEY (parte_id, empresa_id) REFERENCES parte (id, empresa_id),
  CONSTRAINT saldo_de_parte_por_centro_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT saldo_de_parte_por_centro_sentido_ck CHECK (sentido IN ('A_COBRAR', 'A_PAGAR')),
  CONSTRAINT saldo_de_parte_por_centro_moneda_ck CHECK (moneda = 'ARS')
);

-- =============================================================================================
-- 6. Funciones y disparadores
-- =============================================================================================
-- Guardia de los cuatro derivados: solo desde un disparador anidado. Directo de la aplicación la profundidad es 1 y se rechaza (patrón de `0030`, `0037`).
CREATE FUNCTION libro_saldo_guardia() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'la tabla % la escribe solo el libro de saldos', TG_TABLE_NAME
      USING ERRCODE = '42501', CONSTRAINT = TG_TABLE_NAME || '_solo_por_disparadores';
  END IF;
  RETURN NEW;
END
$$;

-- Alta de un asiento (BEFORE INSERT). Valida lo que ninguna restricción de columna puede ver (otras tablas) y fija la fecha de negocio.
CREATE FUNCTION asiento_de_saldo_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_clase record;
  v_original record;
BEGIN
  -- BRIEF: la fecha de negocio es la de la zona de la EMPRESA (`empresa.zona_horaria`, default Buenos Aires), no una constante; corte 00:00 (el libro es por empresa y no por sucursal: aceptado por el orquestador el 20/11, PR-LB-3 §12).
  SELECT public.fecha_de_negocio(NEW.hecho_en, e.zona_horaria, TIME '00:00') INTO NEW.fecha_negocio
    FROM public.empresa e WHERE e.id = NEW.empresa_id;

  -- La parte se lee con FOR SHARE: una anonimización concurrente (UPDATE de `parte.estado`) espera a este asiento o lo ve ya anonimizada.
  SELECT p.estado INTO v_estado
    FROM public.parte p WHERE p.id = NEW.parte_id AND p.empresa_id = NEW.empresa_id FOR SHARE;
  IF NOT FOUND THEN
    -- La política de UPDATE de `parte` excluye a las anonimizadas, y FOR SHARE la aplica: se distingue «no existe» de «anonimizada» sin bloqueo.
    SELECT p.estado INTO v_estado
      FROM public.parte p WHERE p.id = NEW.parte_id AND p.empresa_id = NEW.empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'la parte no existe en esta empresa'
        USING ERRCODE = '23503', CONSTRAINT = 'asiento_de_saldo_parte_fkey';
    END IF;
  END IF;
  IF v_estado = 'ANONIMIZADA' THEN
    RAISE EXCEPTION 'una parte anonimizada no admite asientos'
      USING ERRCODE = '23514', CONSTRAINT = 'asiento_de_saldo_parte_anonimizada';
  END IF;

  SELECT c.signo, c.exige_detalle, c.admite_vencimiento INTO v_clase
    FROM public.clase_de_asiento c WHERE c.sentido = NEW.sentido AND c.clase = NEW.clase;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la clase de asiento no existe para este sentido'
      USING ERRCODE = '23503', CONSTRAINT = 'asiento_de_saldo_clase_fkey';
  END IF;

  IF NEW.naturaleza = 'ORIGINAL' THEN
    -- BRIEF: el signo de la clase se exige SOLO al original (el espejo lleva el signo contrario).
    IF (v_clase.signo = '+' AND NEW.importe < 0) OR (v_clase.signo = '-' AND NEW.importe > 0) THEN
      RAISE EXCEPTION 'el signo del importe no es el de la clase'
        USING ERRCODE = '23514', CONSTRAINT = 'asiento_de_saldo_signo_de_la_clase';
    END IF;
    IF v_clase.exige_detalle AND NEW.detalle IS NULL THEN
      RAISE EXCEPTION 'la clase exige un detalle'
        USING ERRCODE = '23514', CONSTRAINT = 'asiento_de_saldo_detalle_obligatorio';
    END IF;
    IF NOT v_clase.exige_detalle AND NEW.detalle IS NOT NULL THEN
      RAISE EXCEPTION 'la clase no admite detalle'
        USING ERRCODE = '23514', CONSTRAINT = 'asiento_de_saldo_detalle_no_admitido';
    END IF;
    IF NEW.vence_el IS NOT NULL AND NOT v_clase.admite_vencimiento THEN
      RAISE EXCEPTION 'la clase no admite vencimiento'
        USING ERRCODE = '23514', CONSTRAINT = 'asiento_de_saldo_vencimiento_no_admitido';
    END IF;
    -- Una parte inactiva no se endeuda más, pero se le puede cobrar o pagar (reducir la deuda entra).
    IF v_estado = 'INACTIVA' AND NEW.importe > 0 THEN
      RAISE EXCEPTION 'una parte inactiva no admite asientos que aumenten su deuda'
        USING ERRCODE = '23514', CONSTRAINT = 'asiento_de_saldo_parte_inactiva';
    END IF;
  ELSE
    -- Espejo: mismo parte y sentido (los fija la FK `asiento_de_saldo_anula_fkey`), misma clase, importe invertido, mismo origen, y no sobre otro espejo.
    SELECT a.naturaleza, a.clase, a.importe, a.origen_tipo, a.origen_id, a.origen_orden INTO v_original
      FROM public.asiento_de_saldo a WHERE a.id = NEW.anula_a AND a.empresa_id = NEW.empresa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'el asiento a anular no existe en esta empresa'
        USING ERRCODE = '23503', CONSTRAINT = 'asiento_de_saldo_anula_fkey';
    END IF;
    IF v_original.naturaleza <> 'ORIGINAL'
       OR NEW.clase <> v_original.clase
       OR NEW.importe <> -v_original.importe
       OR NEW.origen_tipo <> v_original.origen_tipo
       OR NEW.origen_id <> v_original.origen_id
       OR NEW.origen_orden <> v_original.origen_orden THEN
      RAISE EXCEPTION 'el espejo tiene que ser el original con el importe invertido, y no se anula una anulación'
        USING ERRCODE = '23514', CONSTRAINT = 'asiento_de_saldo_espejo_invalido';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Efectos de un asiento (AFTER INSERT): el saldo de la parte y la fila de saldo del asiento (o su marca de anulado).
CREATE FUNCTION asiento_de_saldo_aplicar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_filas integer;
BEGIN
  -- El UPSERT toma el bloqueo de la fila: dos asientos de la misma parte se turnan y el saldo queda exacto (bajo SERIALIZABLE uno falla con 40001 y se reintenta).
  INSERT INTO public.saldo_de_parte AS s (empresa_id, parte_id, sentido, moneda, saldo)
  VALUES (NEW.empresa_id, NEW.parte_id, NEW.sentido, NEW.moneda, NEW.importe)
  ON CONFLICT ON CONSTRAINT saldo_de_parte_pkey DO UPDATE SET saldo = s.saldo + EXCLUDED.saldo;

  IF NEW.naturaleza = 'ORIGINAL' THEN
    INSERT INTO public.saldo_de_asiento (empresa_id, asiento_id, tope)
    VALUES (NEW.empresa_id, NEW.id, abs(NEW.importe));
  ELSE
    -- Si el original tiene algo imputado, `saldo_de_asiento_anulado_ck` rechaza la marca: primero se deshacen las imputaciones.
    UPDATE public.saldo_de_asiento s SET anulado = true
     WHERE s.empresa_id = NEW.empresa_id AND s.asiento_id = NEW.anula_a;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    IF v_filas <> 1 THEN
      RAISE EXCEPTION 'el asiento a anular no tiene saldo propio'
        USING ERRCODE = '23514', CONSTRAINT = 'asiento_de_saldo_espejo_invalido';
    END IF;
  END IF;
  RETURN NULL;
END
$$;

-- Imputación (AFTER INSERT): orientación, y los tres derivados. El orden de los bloqueos es fijo (par, saldante, saldado).
CREATE FUNCTION imputacion_de_saldo_aplicar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_saldante record;
  v_saldado record;
  v_filas integer;
BEGIN
  SELECT a.importe, a.naturaleza INTO v_saldante
    FROM public.asiento_de_saldo a WHERE a.id = NEW.saldante_id AND a.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el asiento saldante no existe en esta empresa'
      USING ERRCODE = '23503', CONSTRAINT = 'imputacion_de_saldo_saldante_fkey';
  END IF;
  SELECT a.importe, a.naturaleza INTO v_saldado
    FROM public.asiento_de_saldo a WHERE a.id = NEW.saldado_id AND a.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el asiento saldado no existe en esta empresa'
      USING ERRCODE = '23503', CONSTRAINT = 'imputacion_de_saldo_saldado_fkey';
  END IF;
  -- Orientada: el saldante resta (importe < 0) y el saldado suma (importe > 0); ninguno es un espejo.
  IF v_saldante.importe >= 0 OR v_saldado.importe <= 0 OR v_saldante.naturaleza <> 'ORIGINAL' OR v_saldado.naturaleza <> 'ORIGINAL' THEN
    RAISE EXCEPTION 'se imputa un asiento que resta contra uno que suma, y ninguno puede ser una anulación'
      USING ERRCODE = '23514', CONSTRAINT = 'imputacion_de_saldo_signos_invalidos';
  END IF;

  -- 1. El par: el piso en cero impide deshacer más de lo imputado. Al imputar (importe > 0) se hace UPSERT; al deshacer (importe < 0) solo UPDATE:
  --    un INSERT … ON CONFLICT evalúa los CHECK sobre la fila propuesta ANTES de resolver el conflicto, y un importe negativo la rechazaría siempre.
  IF NEW.importe > 0 THEN
    INSERT INTO public.saldo_de_imputacion AS s (empresa_id, saldante_id, saldado_id, importe)
    VALUES (NEW.empresa_id, NEW.saldante_id, NEW.saldado_id, NEW.importe)
    ON CONFLICT ON CONSTRAINT saldo_de_imputacion_pkey DO UPDATE SET importe = s.importe + EXCLUDED.importe;
  ELSE
    UPDATE public.saldo_de_imputacion s SET importe = s.importe + NEW.importe
     WHERE s.empresa_id = NEW.empresa_id AND s.saldante_id = NEW.saldante_id AND s.saldado_id = NEW.saldado_id;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    IF v_filas <> 1 THEN                            -- un par que nunca se imputó no se puede deshacer
      RAISE EXCEPTION 'no se deshace una imputación que no existe'
        USING ERRCODE = '23514', CONSTRAINT = 'saldo_de_imputacion_no_negativo_ck';
    END IF;
  END IF;

  -- 2. Los dos asientos. `NOT anulado` en el WHERE: si una anulación confirmó mientras esperábamos el bloqueo, no se afecta la fila y se rechaza
  --    con un error propio. Los topes (`<= tope`, `>= 0`) los imponen los CHECK de `saldo_de_asiento`.
  UPDATE public.saldo_de_asiento s SET importe_imputado = s.importe_imputado + NEW.importe
   WHERE s.empresa_id = NEW.empresa_id AND s.asiento_id = NEW.saldante_id AND NOT s.anulado;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'el asiento saldante está anulado'
      USING ERRCODE = '23514', CONSTRAINT = 'imputacion_de_saldo_asiento_anulado';
  END IF;
  UPDATE public.saldo_de_asiento s SET importe_imputado = s.importe_imputado + NEW.importe
   WHERE s.empresa_id = NEW.empresa_id AND s.asiento_id = NEW.saldado_id AND NOT s.anulado;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'el asiento saldado está anulado'
      USING ERRCODE = '23514', CONSTRAINT = 'imputacion_de_saldo_asiento_anulado';
  END IF;
  RETURN NULL;
END
$$;

-- Cada fila de distribución suma al desglose por centro de costo de la parte y el sentido de su asiento.
CREATE FUNCTION distribucion_de_asiento_aplicar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  INSERT INTO public.saldo_de_parte_por_centro_de_costo AS s (empresa_id, parte_id, sentido, moneda, sucursal_id, saldo)
  SELECT a.empresa_id, a.parte_id, a.sentido, a.moneda, NEW.sucursal_id, NEW.importe
    FROM public.asiento_de_saldo a WHERE a.id = NEW.asiento_id AND a.empresa_id = NEW.empresa_id
  ON CONFLICT ON CONSTRAINT saldo_de_parte_por_centro_uk DO UPDATE SET saldo = s.saldo + EXCLUDED.saldo;
  RETURN NULL;
END
$$;

-- Cuadre de la distribución, AL CONFIRMAR (diferido): al menos una fila, todas del signo del asiento, Σ = importe EXACTO; y la del espejo es la
-- de su original negada. Se dispara con el asiento y con cada fila de distribución (mismo patrón que `movimiento_de_dinero_verificar_cuadre`, 0091).
-- Con el signo y la suma exacta, nadie puede agregar filas después de confirmado el asiento (la suma se pasaría).
CREATE FUNCTION asiento_de_saldo_verificar_distribucion() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_asiento_id uuid;
  v_a record;
  v_filas bigint;
  v_suma numeric;
  v_de_otro_signo bigint;
  v_diferencias bigint;
BEGIN
  v_asiento_id := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'distribucion_de_asiento' THEN 'asiento_id' ELSE 'id' END)::uuid;
  SELECT a.importe, a.anula_a INTO v_a
    FROM public.asiento_de_saldo a WHERE a.id = v_asiento_id AND a.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RETURN NULL;                                    -- lo rechaza la clave foránea
  END IF;
  SELECT count(*), coalesce(sum(d.importe), 0), count(*) FILTER (WHERE sign(d.importe) <> sign(v_a.importe))
    INTO v_filas, v_suma, v_de_otro_signo
    FROM public.distribucion_de_asiento d WHERE d.empresa_id = NEW.empresa_id AND d.asiento_id = v_asiento_id;
  IF v_filas = 0 OR v_suma <> v_a.importe OR v_de_otro_signo > 0 THEN
    RAISE EXCEPTION 'la distribución por centro de costo no suma el importe del asiento'
      USING ERRCODE = '23514', CONSTRAINT = 'distribucion_de_asiento_no_cuadra';
  END IF;
  IF v_a.anula_a IS NOT NULL THEN
    SELECT count(*) INTO v_diferencias FROM (
      (SELECT d.sucursal_id, d.importe FROM public.distribucion_de_asiento d
        WHERE d.empresa_id = NEW.empresa_id AND d.asiento_id = v_asiento_id
       EXCEPT
       SELECT o.sucursal_id, -o.importe FROM public.distribucion_de_asiento o
        WHERE o.empresa_id = NEW.empresa_id AND o.asiento_id = v_a.anula_a)
      UNION ALL
      (SELECT o.sucursal_id, -o.importe FROM public.distribucion_de_asiento o
        WHERE o.empresa_id = NEW.empresa_id AND o.asiento_id = v_a.anula_a
       EXCEPT
       SELECT d.sucursal_id, d.importe FROM public.distribucion_de_asiento d
        WHERE d.empresa_id = NEW.empresa_id AND d.asiento_id = v_asiento_id)
    ) x;
    IF v_diferencias > 0 THEN
      RAISE EXCEPTION 'la distribución del espejo tiene que ser la de su original negada'
        USING ERRCODE = '23514', CONSTRAINT = 'distribucion_de_asiento_espejo_no_cuadra';
    END IF;
  END IF;
  RETURN NULL;
END
$$;

-- Asiento
CREATE TRIGGER asiento_de_saldo_alta BEFORE INSERT ON asiento_de_saldo
  FOR EACH ROW EXECUTE FUNCTION asiento_de_saldo_validar_alta();
CREATE TRIGGER asiento_de_saldo_efectos AFTER INSERT ON asiento_de_saldo
  FOR EACH ROW EXECUTE FUNCTION asiento_de_saldo_aplicar();
CREATE CONSTRAINT TRIGGER asiento_de_saldo_distribucion AFTER INSERT ON asiento_de_saldo
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION asiento_de_saldo_verificar_distribucion();
-- Distribución
CREATE TRIGGER distribucion_de_asiento_efectos AFTER INSERT ON distribucion_de_asiento
  FOR EACH ROW EXECUTE FUNCTION distribucion_de_asiento_aplicar();
CREATE CONSTRAINT TRIGGER distribucion_de_asiento_cuadre AFTER INSERT ON distribucion_de_asiento
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION asiento_de_saldo_verificar_distribucion();
-- Imputación
CREATE TRIGGER imputacion_de_saldo_efectos AFTER INSERT ON imputacion_de_saldo
  FOR EACH ROW EXECUTE FUNCTION imputacion_de_saldo_aplicar();
-- Guardia de los cuatro derivados (INSERT y UPDATE), y sin borrar ni truncar.
CREATE TRIGGER saldo_de_asiento_guardia BEFORE INSERT OR UPDATE ON saldo_de_asiento
  FOR EACH ROW EXECUTE FUNCTION libro_saldo_guardia();
CREATE TRIGGER saldo_de_imputacion_guardia BEFORE INSERT OR UPDATE ON saldo_de_imputacion
  FOR EACH ROW EXECUTE FUNCTION libro_saldo_guardia();
CREATE TRIGGER saldo_de_parte_guardia BEFORE INSERT OR UPDATE ON saldo_de_parte
  FOR EACH ROW EXECUTE FUNCTION libro_saldo_guardia();
CREATE TRIGGER saldo_de_parte_por_centro_guardia BEFORE INSERT OR UPDATE ON saldo_de_parte_por_centro_de_costo
  FOR EACH ROW EXECUTE FUNCTION libro_saldo_guardia();

-- Solo inserción: los tres libros y el catálogo (UPDATE, DELETE y TRUNCATE); los derivados (DELETE y TRUNCATE).
CREATE TRIGGER clase_de_asiento_solo_insercion BEFORE UPDATE OR DELETE ON clase_de_asiento
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER clase_de_asiento_sin_truncate BEFORE TRUNCATE ON clase_de_asiento
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER asiento_de_saldo_solo_insercion BEFORE UPDATE OR DELETE ON asiento_de_saldo
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER asiento_de_saldo_sin_truncate BEFORE TRUNCATE ON asiento_de_saldo
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER distribucion_de_asiento_solo_insercion BEFORE UPDATE OR DELETE ON distribucion_de_asiento
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER distribucion_de_asiento_sin_truncate BEFORE TRUNCATE ON distribucion_de_asiento
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER imputacion_de_saldo_solo_insercion BEFORE UPDATE OR DELETE ON imputacion_de_saldo
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER imputacion_de_saldo_sin_truncate BEFORE TRUNCATE ON imputacion_de_saldo
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER saldo_de_asiento_sin_borrar BEFORE DELETE ON saldo_de_asiento
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER saldo_de_asiento_sin_truncate BEFORE TRUNCATE ON saldo_de_asiento
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER saldo_de_imputacion_sin_borrar BEFORE DELETE ON saldo_de_imputacion
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER saldo_de_imputacion_sin_truncate BEFORE TRUNCATE ON saldo_de_imputacion
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER saldo_de_parte_sin_borrar BEFORE DELETE ON saldo_de_parte
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER saldo_de_parte_sin_truncate BEFORE TRUNCATE ON saldo_de_parte
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER saldo_de_parte_por_centro_sin_borrar BEFORE DELETE ON saldo_de_parte_por_centro_de_costo
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER saldo_de_parte_por_centro_sin_truncate BEFORE TRUNCATE ON saldo_de_parte_por_centro_de_costo
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- =============================================================================================
-- 7. Privilegios y seguridad por fila (el patrón de caja y de stock)
-- =============================================================================================
REVOKE ALL ON clase_de_asiento, asiento_de_saldo, distribucion_de_asiento, imputacion_de_saldo, saldo_de_asiento, saldo_de_imputacion,
  saldo_de_parte, saldo_de_parte_por_centro_de_costo FROM PUBLIC;
GRANT SELECT ON clase_de_asiento, asiento_de_saldo, distribucion_de_asiento, imputacion_de_saldo, saldo_de_asiento, saldo_de_imputacion,
  saldo_de_parte, saldo_de_parte_por_centro_de_costo TO pedernal_app;

-- Los libros: solo INSERT, por columna (la aplicación no manda `id`, `registrado_en` ni `fecha_negocio`).
GRANT INSERT (empresa_id, parte_id, sentido, clase, naturaleza, importe, moneda, origen_tipo, origen_id, origen_orden, referencia_tipo,
              referencia_id, vence_el, detalle, anula_a, clave_idempotencia, huella, hecho_en, registrado_por)
  ON asiento_de_saldo TO pedernal_app;
GRANT INSERT (empresa_id, asiento_id, sucursal_id, importe, moneda) ON distribucion_de_asiento TO pedernal_app;
GRANT INSERT (empresa_id, numero, saldante_id, saldado_id, parte_id, sentido, importe, moneda, clave_idempotencia, huella, registrado_por)
  ON imputacion_de_saldo TO pedernal_app;

-- Los derivados: los disparadores corren con los privilegios de la aplicación (sin SECURITY DEFINER), así que ella recibe INSERT y UPDATE de
-- las columnas que escriben; solo la guardia de profundidad impide que los escriba por fuera (el mismo esquema que `saldo_de_stock`).
GRANT INSERT (empresa_id, asiento_id, tope), UPDATE (importe_imputado, anulado) ON saldo_de_asiento TO pedernal_app;
GRANT INSERT (empresa_id, saldante_id, saldado_id, importe), UPDATE (importe) ON saldo_de_imputacion TO pedernal_app;
GRANT INSERT (empresa_id, parte_id, sentido, moneda, saldo), UPDATE (saldo) ON saldo_de_parte TO pedernal_app;
GRANT INSERT (empresa_id, parte_id, sentido, moneda, sucursal_id, saldo), UPDATE (saldo) ON saldo_de_parte_por_centro_de_costo TO pedernal_app;

ALTER TABLE clase_de_asiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE clase_de_asiento FORCE ROW LEVEL SECURITY;
ALTER TABLE asiento_de_saldo ENABLE ROW LEVEL SECURITY;
ALTER TABLE asiento_de_saldo FORCE ROW LEVEL SECURITY;
ALTER TABLE distribucion_de_asiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE distribucion_de_asiento FORCE ROW LEVEL SECURITY;
ALTER TABLE imputacion_de_saldo ENABLE ROW LEVEL SECURITY;
ALTER TABLE imputacion_de_saldo FORCE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_asiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_asiento FORCE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_imputacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_imputacion FORCE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_parte ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_parte FORCE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_parte_por_centro_de_costo ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldo_de_parte_por_centro_de_costo FORCE ROW LEVEL SECURITY;

-- Global y sembrado (como `unidad_de_medida`, 0025): la aplicación lee todo.
CREATE POLICY clase_de_asiento_app_leer ON clase_de_asiento FOR SELECT TO pedernal_app USING (true);

-- Los libros: leer y alta (empresa operable y, en asiento e imputación, actor = la persona del contexto).
CREATE POLICY asiento_de_saldo_app_leer ON asiento_de_saldo FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY asiento_de_saldo_app_alta ON asiento_de_saldo FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND registrado_por = (SELECT app_persona_id()));
CREATE POLICY distribucion_de_asiento_app_leer ON distribucion_de_asiento FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY distribucion_de_asiento_app_alta ON distribucion_de_asiento FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY imputacion_de_saldo_app_leer ON imputacion_de_saldo FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY imputacion_de_saldo_app_alta ON imputacion_de_saldo FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND registrado_por = (SELECT app_persona_id()));

-- Los derivados: leer, alta y cambio (una política por comando, como `saldo_de_stock`).
CREATE POLICY saldo_de_asiento_app_leer ON saldo_de_asiento FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY saldo_de_asiento_app_alta ON saldo_de_asiento FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY saldo_de_asiento_app_cambiar ON saldo_de_asiento FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY saldo_de_imputacion_app_leer ON saldo_de_imputacion FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY saldo_de_imputacion_app_alta ON saldo_de_imputacion FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY saldo_de_imputacion_app_cambiar ON saldo_de_imputacion FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY saldo_de_parte_app_leer ON saldo_de_parte FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY saldo_de_parte_app_alta ON saldo_de_parte FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY saldo_de_parte_app_cambiar ON saldo_de_parte FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY saldo_de_parte_por_centro_app_leer ON saldo_de_parte_por_centro_de_costo FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY saldo_de_parte_por_centro_app_alta ON saldo_de_parte_por_centro_de_costo FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY saldo_de_parte_por_centro_app_cambiar ON saldo_de_parte_por_centro_de_costo FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
