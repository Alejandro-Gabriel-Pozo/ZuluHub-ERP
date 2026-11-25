-- 0103_pago_compuesto: un pago de proveedor se compone de uno o más medios (P1, sin saldo a favor; decisión del dueño 25/11/2026, filas 438 y 445). Solo el efectivo sale de la caja; la suma de los medios es el total.
--  * Tabla `medio_de_un_pago` (solo inserción): una fila por medio, con su importe. Un solo medio de cada tipo por pago (SUPUESTO, costo de revertir bajo: quitar la UNIQUE).
--  * `pago_de_comprobante.medio` admite `COMPUESTO` (se ensancha: lo viejo sigue válido).
--  * Disparador diferido sobre las líneas: la suma de los medios es EXACTAMENTE el total y la cabecera dice `COMPUESTO` si hay más de uno o el medio único si hay uno.
--  * Relleno: una línea por cada pago existente, ANTES de activar la RLS y los disparadores. Si hay un pago viejo de importe 0 la migración FRENA (55000) en vez de dejarlo sin línea.
-- PASO 1 DE 2: el código viejo de `declararPago` inserta la cabecera SIN líneas, así que acá NO se exige todavía que todo pago tenga línea ni que el importe sea positivo: eso lo exige la migración «pago_compuesto_exigir_medios» (número a asignar),
-- que va DESPUÉS del código de P1 (el que escribe las líneas). ADITIVA y compatible hacia atrás. Reversión: `migraciones/reversiones/0103_revertir_pago_compuesto.sql` (frena si hay pagos COMPUESTO). El ejecutor no la aplica.
-- DEPENDE de 0001, 0007 y 0037 (`pago_de_comprobante`); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.pago_de_comprobante') IS NULL THEN
    RAISE EXCEPTION '0103 necesita 0037 aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.medio_de_un_pago') IS NOT NULL THEN
    RAISE EXCEPTION '0103: la tabla medio_de_un_pago ya existe; esta migración solo crea objetos nuevos' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.solo_insercion()') IS NULL OR to_regprocedure('public.app_empresa_id()') IS NULL OR to_regprocedure('public.empresa_operable(uuid)') IS NULL THEN
    RAISE EXCEPTION '0103 necesita las funciones de 0001 y 0007' USING ERRCODE = '55000';
  END IF;
  -- `pago_de_comprobante` tiene FORCE RLS: sin un rol que la evada, el relleno y el chequeo de abajo verían CERO filas y pasarían en falso (fail-closed).
  IF row_security_active('public.pago_de_comprobante') THEN
    RAISE EXCEPTION '0103 necesita un rol que evada RLS para rellenar' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pago_de_comprobante WHERE importe = 0) THEN
    RAISE EXCEPTION '0103: hay pagos de importe 0 sin medio posible; resolverlos a mano antes' USING ERRCODE = '55000';
  END IF;
END
$$;

CREATE TABLE medio_de_un_pago (
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  pago_id    uuid NOT NULL,
  numero     integer NOT NULL CONSTRAINT medio_de_un_pago_numero_ck CHECK (numero BETWEEN 1 AND 6),
  medio      text NOT NULL CONSTRAINT medio_de_un_pago_medio_ck CHECK (medio IN ('EFECTIVO', 'TARJETA_DEBITO', 'TARJETA_CREDITO', 'TRANSFERENCIA', 'QR', 'OTRO')),
  importe    numeric(18,2) NOT NULL CONSTRAINT medio_de_un_pago_importe_ck CHECK (importe > 0 AND importe < 10000000000000000),
  CONSTRAINT medio_de_un_pago_pkey PRIMARY KEY (empresa_id, pago_id, numero),
  CONSTRAINT medio_de_un_pago_uno_por_medio_uk UNIQUE (empresa_id, pago_id, medio),
  CONSTRAINT medio_de_un_pago_pago_fkey FOREIGN KEY (pago_id, empresa_id) REFERENCES pago_de_comprobante (id, empresa_id)
);

-- Relleno (la migración no es BYPASSRLS: va antes de la RLS y de los disparadores).
INSERT INTO medio_de_un_pago (empresa_id, pago_id, numero, medio, importe)
  SELECT empresa_id, id, 1, medio, importe FROM pago_de_comprobante;

ALTER TABLE pago_de_comprobante DROP CONSTRAINT pago_medio_ck;
ALTER TABLE pago_de_comprobante ADD CONSTRAINT pago_medio_ck
  CHECK (medio IN ('EFECTIVO', 'TARJETA_DEBITO', 'TARJETA_CREDITO', 'TRANSFERENCIA', 'QR', 'OTRO', 'COMPUESTO'));

CREATE FUNCTION pago_compuesto_verificar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_pago uuid;
  v_importe numeric;
  v_medio text;
  v_suma numeric;
  v_n integer;
  v_unico text;
BEGIN
  -- Dos asignaciones separadas: un CASE en una sola expresión también evalúa `NEW.id` en la tabla de líneas, que no tiene esa columna.
  IF TG_TABLE_NAME = 'pago_de_comprobante' THEN
    v_pago := NEW.id;   -- desde el paso 2, el disparador también corre en la cabecera
  ELSE
    v_pago := NEW.pago_id;
  END IF;
  SELECT p.importe, p.medio INTO v_importe, v_medio FROM public.pago_de_comprobante p WHERE p.id = v_pago AND p.empresa_id = NEW.empresa_id;
  SELECT coalesce(sum(m.importe), 0), count(*), min(m.medio) INTO v_suma, v_n, v_unico
    FROM public.medio_de_un_pago m WHERE m.pago_id = v_pago AND m.empresa_id = NEW.empresa_id;
  IF v_n = 0 OR v_suma <> v_importe THEN
    RAISE EXCEPTION 'la suma de los medios no es el total del pago' USING ERRCODE = '23514', CONSTRAINT = 'medio_de_un_pago_suma_ck';
  END IF;
  IF (v_n > 1 AND v_medio <> 'COMPUESTO') OR (v_n = 1 AND v_medio <> v_unico) THEN
    RAISE EXCEPTION 'el medio de la cabecera no es el de sus líneas' USING ERRCODE = '23514', CONSTRAINT = 'pago_medio_coherente_ck';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER medio_de_un_pago_verificar AFTER INSERT ON medio_de_un_pago DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pago_compuesto_verificar();
CREATE TRIGGER medio_de_un_pago_solo_insercion BEFORE UPDATE OR DELETE ON medio_de_un_pago FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER medio_de_un_pago_sin_truncate BEFORE TRUNCATE ON medio_de_un_pago FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

REVOKE ALL ON medio_de_un_pago FROM PUBLIC;
GRANT SELECT ON medio_de_un_pago TO pedernal_app;
GRANT INSERT (empresa_id, pago_id, numero, medio, importe) ON medio_de_un_pago TO pedernal_app;

ALTER TABLE medio_de_un_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE medio_de_un_pago FORCE ROW LEVEL SECURITY;
CREATE POLICY medio_de_un_pago_app_leer ON medio_de_un_pago FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY medio_de_un_pago_app_alta ON medio_de_un_pago FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
