-- 0029_facturacion: facturar un documento armado por otro módulo (E1; decisiones 148, 149, 150, 174, 175 y 177 del dueño). Parte FISCAL:
-- un origen nuevo de comprobante (`REEMISION_DE_TICKET`) y la unidad opcional del renglón (`comprobante_linea.unidad`); parte de VENTAS: el
-- puntero `documento_de_ticket` (qué comprobante facturó cada ticket). Diseño: Pedernal-docs/11-especificaciones/e1-facturador-especificacion.md
-- §3.1, §3.2, §3.3 y §3.5. Va DESPUÉS de 0028 (ventas): el puntero apunta a `ticket`.
--
-- Reglas de esta migración (las mismas de 0001 a 0026):
--  * Es ADITIVA y compatible hacia atrás: la lista de orígenes admitidos es un SUPERCONJUNTO de la anterior, la columna nueva admite
--    NULL y las filas que ya existen quedan en NULL (válido), y la tabla nueva nace vacía. No se rellena nada, no se borra nada.
--  * Su reversión es un script aparte, revisado, que falla cerrado SIN borrar si ya hay datos que la usan (una fila de `documento_de_ticket`,
--    una factura con origen `REEMISION_DE_TICKET` o un renglón con unidad): `migraciones/reversiones/0029_revertir_facturacion.sql`. El ejecutor no la aplica.
--  * `comprobante_linea` es de solo inserción (disparadores de 0009): la columna nueva se escribe al insertar el renglón y no se
--    modifica después. El privilegio es por columna, como el resto de la tabla.
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro).
--
-- Decisiones de diseño (probadas por `test/integracion/facturacion-migracion-0029.test.ts`):
--
--  F1. `REEMISION_DE_TICKET` es un tipo de origen opaco para fiscal, como los demás (D-F-2): una factura autorizada y acreditada por una
--      nota total sigue «vigente» para la identidad `(empresa, origen, emisor, clase)` (`comprobante_identidad_uk`), así que reemitir con
--      el mismo origen devolvería la acreditada. La reemisión usa otro origen y esa clave de identidad no cambia.
--  F2. La unidad es el SÍMBOLO impreso («kg»), no el código: fiscal no depende de la tabla del catálogo ni duplica su lista. La forma
--      permitida es la misma lista de permitidos que `unidad_de_medida.simbolo` (0025, `unidad_simbolo_ck`); una prueba las compara.
--      WSFE no recibe renglones: la unidad solo se imprime.

DO $$
BEGIN
  IF to_regclass('public.comprobante') IS NULL OR to_regclass('public.comprobante_linea') IS NULL THEN
    RAISE EXCEPTION 'la facturación de un documento de origen requiere 0009 (comprobante y comprobante_linea) aplicada antes'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.ticket') IS NULL OR to_regclass('public.ticket_ejemplar') IS NULL THEN
    RAISE EXCEPTION 'E1 (facturar desde un ticket) va después de E4: falta 0028_ventas (ticket y ticket_ejemplar)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.documento_de_ticket') IS NOT NULL THEN
    RAISE EXCEPTION 'el puntero del ticket nace en 0029: la tabla documento_de_ticket ya existe (alguien la creó a mano); hay que revisarla antes de migrar'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'comprobante_linea' AND column_name = 'unidad'
  ) THEN
    RAISE EXCEPTION 'la unidad del renglón nace en 0029: la columna comprobante_linea.unidad ya existe (alguien la creó a mano); hay que revisarla antes de migrar'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- F1. Origen nuevo: la misma lista de 0009 más `REEMISION_DE_TICKET` (superconjunto: toda fila existente la cumple)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE comprobante DROP CONSTRAINT comprobante_origen_tipo_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_origen_tipo_ck CHECK (origen_tipo IN
  ('MANUAL', 'EJEMPLAR_DE_TICKET', 'REEMISION_DE_TICKET', 'PROPINA_DE_TICKET', 'CORRECCION_DE_TICKET', 'SUSCRIPCION'));

-- ---------------------------------------------------------------------------------------------
-- F2. Unidad opcional del renglón
-- ---------------------------------------------------------------------------------------------
ALTER TABLE comprobante_linea ADD COLUMN unidad text
  CONSTRAINT comprobante_linea_unidad_ck CHECK (unidad IS NULL OR unidad ~ '^[A-Za-z0-9]{1,8}$');

GRANT INSERT (unidad) ON comprobante_linea TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- F3. El puntero de ventas: qué comprobante facturó cada ticket (E1 §3.3). Es SOLO un puntero: la fuente de verdad de «facturado» es fiscal
--     (¿ese comprobante sigue valiendo?, `vigenciaDeComprobantes`) y el puntero se puede reconstruir desde fiscal por el origen del comprobante.
--     Solo inserción, salvo `vigente` true → false (la única transición, cuando quien factura reemite tras una factura que dejó de valer).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE documento_de_ticket (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  ticket_id      uuid NOT NULL,
  ejemplar_id    uuid NOT NULL,                                       -- el ejemplar vigente que se facturó
  intento        smallint NOT NULL CONSTRAINT documento_intento_ck CHECK (intento >= 1 AND intento < 1000),
  clave          uuid NOT NULL,                                       -- la clave de idempotencia de la pantalla
  comprobante_id uuid NOT NULL,                                       -- lo elige ventas y es el id del comprobante en fiscal
  vigente        boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL,
  creado_por     uuid NOT NULL REFERENCES persona (id),
  no_vigente_en  timestamptz,
  CONSTRAINT documento_vigencia_ck CHECK (vigente = (no_vigente_en IS NULL)),
  CONSTRAINT documento_ticket_fkey FOREIGN KEY (ticket_id, empresa_id) REFERENCES ticket (id, empresa_id),
  CONSTRAINT documento_ejemplar_fkey FOREIGN KEY (ejemplar_id, empresa_id) REFERENCES ticket_ejemplar (id, empresa_id),
  CONSTRAINT documento_comprobante_fkey FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante (id, empresa_id),
  CONSTRAINT documento_clave_uk UNIQUE (empresa_id, clave),
  CONSTRAINT documento_intento_uk UNIQUE (empresa_id, ticket_id, intento),
  CONSTRAINT documento_comprobante_uk UNIQUE (empresa_id, comprobante_id)
);
-- Un solo documento vigente por ticket: lo que hace que dos personas no facturen el mismo ticket a la vez.
CREATE UNIQUE INDEX documento_vigente_uk ON documento_de_ticket (empresa_id, ticket_id) WHERE vigente;

-- Alta: solo se factura un ticket COBRADO y su ejemplar vigente (el que se factura es el que el ticket tiene hoy).
CREATE FUNCTION documento_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_vigente integer;
  v_numero integer;
BEGIN
  SELECT t.estado, t.ejemplar_vigente INTO v_estado, v_vigente
    FROM public.ticket t WHERE t.id = NEW.ticket_id AND t.empresa_id = NEW.empresa_id FOR SHARE;
  IF v_estado IS DISTINCT FROM 'COBRADO' THEN
    RAISE EXCEPTION 'documento_ticket_no_facturable: el ticket % no está cobrado', NEW.ticket_id
      USING ERRCODE = '23514', CONSTRAINT = 'documento_ticket_no_facturable';
  END IF;
  SELECT e.numero_de_ejemplar INTO v_numero
    FROM public.ticket_ejemplar e WHERE e.id = NEW.ejemplar_id AND e.empresa_id = NEW.empresa_id AND e.ticket_id = NEW.ticket_id;
  IF v_numero IS DISTINCT FROM v_vigente THEN
    RAISE EXCEPTION 'documento_ejemplar_no_vigente: el ejemplar % no es el vigente del ticket %', NEW.ejemplar_id, NEW.ticket_id
      USING ERRCODE = '23514', CONSTRAINT = 'documento_ejemplar_no_vigente';
  END IF;
  IF NEW.vigente IS NOT TRUE THEN
    RAISE EXCEPTION 'documento_cambio_invalido: un documento nace vigente'
      USING ERRCODE = '23514', CONSTRAINT = 'documento_cambio_invalido';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER documento_alta BEFORE INSERT ON documento_de_ticket FOR EACH ROW EXECUTE FUNCTION documento_validar_alta();

-- Cambio: solo `vigente` true → false (con la hora en que dejó de serlo); nada más cambia nunca, ni para el dueño de la base.
CREATE FUNCTION documento_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF OLD.vigente IS NOT TRUE OR NEW.vigente IS NOT FALSE OR NEW.no_vigente_en IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id OR NEW.ejemplar_id IS DISTINCT FROM OLD.ejemplar_id
     OR NEW.intento IS DISTINCT FROM OLD.intento OR NEW.clave IS DISTINCT FROM OLD.clave
     OR NEW.comprobante_id IS DISTINCT FROM OLD.comprobante_id OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
     OR NEW.creado_por IS DISTINCT FROM OLD.creado_por THEN
    RAISE EXCEPTION 'documento_cambio_invalido: de un documento solo cambia vigente de true a false'
      USING ERRCODE = '23514', CONSTRAINT = 'documento_cambio_invalido';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER documento_cambio BEFORE UPDATE ON documento_de_ticket FOR EACH ROW EXECUTE FUNCTION documento_validar_cambio();
-- Nada se borra ni se vacía (ni el dueño de la base).
CREATE TRIGGER documento_sin_borrado BEFORE DELETE ON documento_de_ticket FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER documento_sin_truncate BEFORE TRUNCATE ON documento_de_ticket FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- Privilegios por columna, y nadie recibe DELETE. Solo la aplicación.
REVOKE ALL ON documento_de_ticket FROM PUBLIC;
GRANT SELECT ON documento_de_ticket TO pedernal_app;
GRANT INSERT (id, empresa_id, ticket_id, ejemplar_id, intento, clave, comprobante_id, creado_en, creado_por)
  ON documento_de_ticket TO pedernal_app;
GRANT UPDATE (vigente, no_vigente_en) ON documento_de_ticket TO pedernal_app;

ALTER TABLE documento_de_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_de_ticket FORCE ROW LEVEL SECURITY;
CREATE POLICY documento_app_leer ON documento_de_ticket FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY documento_app_alta ON documento_de_ticket FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND creado_por = (SELECT app_persona_id()));
CREATE POLICY documento_app_cambio ON documento_de_ticket FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
