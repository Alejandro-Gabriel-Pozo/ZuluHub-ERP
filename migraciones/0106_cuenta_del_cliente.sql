-- 0106_cuenta_del_cliente: CC-1, la ficha de habilitación del cliente a deber (cuenta corriente) y las clases A_COBRAR del libro de saldos.
-- QUÉ HACE (aditiva: una tabla nueva y tres filas de catálogo; no cambia ninguna fila ni restricción existente, no rellena nada):
--   1. `cuenta_del_cliente`: UNA ficha por cliente y empresa con el plazo (días), el límite de crédito (ARS), el estado HABILITADA/SUSPENDIDA y quién la
--      habilitó. La ficha se SUSPENDE, no se borra (sin DELETE ni TRUNCATE). El límite acá solo se GUARDA: lo hace cumplir CC-2 al cargar una venta a cuenta.
--   2. Disparadores de defensa en profundidad: solo se habilita (o reactiva) a una parte ACTIVA, con rol CUSTOMER activo, con CUIT y con nombre;
--      lo que identifica a la ficha no cambia nunca (empresa, parte, clave, huella, quién y cuándo la habilitó).
--   3. Siembra de las tres clases A_COBRAR que usa v1 en `clase_de_asiento` (0092): CARGO_DE_VENTA_A_CUENTA (+, admite vencimiento), COBRANZA (−) y
--      AJUSTE_DE_SALDO (±, exige detalle). Las demás nacen cerradas: «una clase no sembrada no se usa» (CC-6 siembra crédito a favor y nota de crédito).
-- Convención de signo del libro: + = lo que el cliente debe.
-- Reversión: `migraciones/reversiones/0106_revertir_cuenta_del_cliente.sql` (FRENA si hay fichas; avisar al dueño). La siembra NO se revierte: `clase_de_asiento` es
--   de solo inserción (disparador) y una clase sin asientos no hace daño; la migración se puede volver a correr porque la siembra es `ON CONFLICT DO NOTHING`.
-- DEPENDE de 0001 (empresa, persona, app_empresa_id, app_persona_id, empresa_operable, fijar_version_y_fecha), 0007 (sin_borrado), 0025 (texto_de_catalogo_valido),
--   0034 (parte, parte_id_empresa_uk, parte_rol, rol_de_parte) y 0092 (clase_de_asiento).
-- Solo corre contra el Postgres local de las pruebas; nunca contra Neon (la aplica `migrar.yml`, con snapshot previo).

DO $$
BEGIN
  IF to_regclass('public.parte') IS NULL OR to_regclass('public.parte_rol') IS NULL OR to_regclass('public.clase_de_asiento') IS NULL
     OR to_regprocedure('public.sin_borrado()') IS NULL OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL
     OR to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL
     OR to_regprocedure('public.app_empresa_id()') IS NULL OR to_regprocedure('public.app_persona_id()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL THEN
    RAISE EXCEPTION 'la cuenta del cliente requiere 0001, 0007, 0025, 0034 y 0092 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.cuenta_del_cliente') IS NOT NULL THEN
    RAISE EXCEPTION '0106: la tabla cuenta_del_cliente ya existe; esta migración solo crea objetos nuevos' USING ERRCODE = '55000';
  END IF;
END
$$;

-- =============================================================================================
-- 1. La ficha
-- =============================================================================================
CREATE TABLE cuenta_del_cliente (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES empresa (id),
  parte_id             uuid NOT NULL,
  plazo_dias           integer NOT NULL CONSTRAINT cuenta_cliente_plazo_ck CHECK (plazo_dias BETWEEN 1 AND 365),
  limite               numeric(18,2) NOT NULL CONSTRAINT cuenta_cliente_limite_ck CHECK (limite >= 0 AND limite <= 999999999.99),
  moneda               char(3) NOT NULL DEFAULT 'ARS' CONSTRAINT cuenta_cliente_moneda_ck CHECK (moneda = 'ARS'),
  estado               text NOT NULL DEFAULT 'HABILITADA' CONSTRAINT cuenta_cliente_estado_ck CHECK (estado IN ('HABILITADA', 'SUSPENDIDA')),
  motivo_de_suspension text CONSTRAINT cuenta_cliente_motivo_ck CHECK (motivo_de_suspension IS NULL OR texto_de_catalogo_valido(motivo_de_suspension, 300)),
  clave_idempotencia   text NOT NULL CONSTRAINT cuenta_cliente_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella               text NOT NULL CONSTRAINT cuenta_cliente_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  habilitada_por       uuid NOT NULL REFERENCES persona (id),
  habilitada_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en       timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  CONSTRAINT cuenta_del_cliente_pkey PRIMARY KEY (id),
  CONSTRAINT cuenta_cliente_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT cuenta_cliente_parte_uk UNIQUE (empresa_id, parte_id),            -- UNA ficha por cliente y empresa
  CONSTRAINT cuenta_cliente_clave_uk UNIQUE (empresa_id, clave_idempotencia),  -- la clave de la habilitación: repetirla no duplica
  CONSTRAINT cuenta_cliente_parte_fkey FOREIGN KEY (parte_id, empresa_id) REFERENCES parte (id, empresa_id),
  -- Suspendida <=> tiene motivo. Todo CHECK compuesto va en coalesce(..., false) (convención de 0034): un NULL no puede hacerlo pasar.
  CONSTRAINT cuenta_cliente_suspension_ck CHECK (coalesce((estado = 'SUSPENDIDA') = (motivo_de_suspension IS NOT NULL), false))
);

-- Qué se exige para que una parte pueda DEBER. Una sola función para el alta y la reactivación; el FOR SHARE sobre la parte hace que
-- una anonimización o una baja simultánea espere a esta transacción (y al revés), en vez de dejar una ficha sobre una parte que ya no es cliente.
CREATE FUNCTION cuenta_del_cliente_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_documento text;
  v_nombre text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Lo que identifica a la ficha no cambia (el privilegio por columna ya lo impide a la aplicación; esto lo impone también al dueño de la base).
    IF NEW.id <> OLD.id OR NEW.empresa_id <> OLD.empresa_id OR NEW.parte_id <> OLD.parte_id OR NEW.moneda <> OLD.moneda
       OR NEW.clave_idempotencia <> OLD.clave_idempotencia OR NEW.huella <> OLD.huella
       OR NEW.habilitada_por <> OLD.habilitada_por OR NEW.habilitada_en <> OLD.habilitada_en THEN
      RAISE EXCEPTION 'la empresa, la parte, la clave y quién y cuándo habilitó la cuenta del cliente no cambian'
        USING ERRCODE = '23514', CONSTRAINT = 'cuenta_cliente_identidad_inmutable';
    END IF;
    -- Solo reactivar vuelve a pedir que la parte pueda deber; suspender, o cambiar plazo y límite de una ficha ya habilitada, no.
    IF NOT (OLD.estado = 'SUSPENDIDA' AND NEW.estado = 'HABILITADA') THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT p.estado, p.documento_tipo, p.nombre INTO v_estado, v_documento, v_nombre
    FROM public.parte p WHERE p.id = NEW.parte_id AND p.empresa_id = NEW.empresa_id
      FOR SHARE;
  -- Sin fila: la parte no existe en esta empresa, o está ANONIMIZADA (la política de UPDATE de `parte` no la deja bloquear: 0034). Es el mismo rechazo que daría la clave
  -- foránea compuesta, con su misma restricción (este disparador corre antes que la verificación de la clave).
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la parte no existe en esta empresa o está anonimizada'
      USING ERRCODE = '23503', CONSTRAINT = 'cuenta_cliente_parte_fkey';
  END IF;
  IF v_estado <> 'ACTIVA' THEN
    RAISE EXCEPTION 'solo una parte activa puede tener cuenta corriente'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_cliente_parte_no_activa';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.parte_rol r
                  WHERE r.empresa_id = NEW.empresa_id AND r.parte_id = NEW.parte_id AND r.rol = 'CUSTOMER' AND r.activo) THEN
    RAISE EXCEPTION 'solo un cliente puede tener cuenta corriente'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_cliente_sin_rol_cliente';
  END IF;
  -- CUIT válido: lo garantiza `parte_documento_ck` (0034); acá se exige que el documento SEA un CUIT y que haya nombre (razón social).
  IF v_documento IS DISTINCT FROM 'CUIT' OR v_nombre IS NULL THEN
    RAISE EXCEPTION 'el cliente necesita CUIT y razón social para tener cuenta corriente'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_cliente_sin_cuit';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER cuenta_cliente_validar BEFORE INSERT OR UPDATE ON cuenta_del_cliente
  FOR EACH ROW EXECUTE FUNCTION cuenta_del_cliente_validar();
CREATE TRIGGER cuenta_cliente_version BEFORE UPDATE ON cuenta_del_cliente
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
-- La ficha se suspende, no se borra: el borrado y el vaciado se frenan hasta para el dueño (mismo patrón que parte, 0034).
CREATE TRIGGER cuenta_cliente_sin_borrado BEFORE DELETE ON cuenta_del_cliente
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER cuenta_cliente_sin_truncate BEFORE TRUNCATE ON cuenta_del_cliente
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- =============================================================================================
-- 2. Privilegios y seguridad por fila
-- =============================================================================================
REVOKE ALL ON cuenta_del_cliente FROM PUBLIC;
GRANT SELECT ON cuenta_del_cliente TO pedernal_app;
-- INSERT y UPDATE por columna; nadie recibe DELETE, TRUNCATE, REFERENCES ni TRIGGER. La aplicación no manda `id`, `moneda`, `estado`, fechas ni versión
-- (los fija la base). La huella y la clave son las de la habilitación y no se tocan después.
GRANT INSERT (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por) ON cuenta_del_cliente TO pedernal_app;
GRANT UPDATE (plazo_dias, limite, estado, motivo_de_suspension) ON cuenta_del_cliente TO pedernal_app;

ALTER TABLE cuenta_del_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuenta_del_cliente FORCE ROW LEVEL SECURITY;
CREATE POLICY cuenta_cliente_app_leer ON cuenta_del_cliente FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY cuenta_cliente_app_alta ON cuenta_del_cliente FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND habilitada_por = (SELECT app_persona_id()));
CREATE POLICY cuenta_cliente_app_cambio ON cuenta_del_cliente FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

-- =============================================================================================
-- 3. Siembra de las clases A_COBRAR de v1
-- =============================================================================================
-- `clase_de_asiento` es global y de solo inserción. `ON CONFLICT DO NOTHING`: correr la migración dos veces (o después de una reversión) no duplica ni falla.
-- La tabla ya tiene RLS FORZADA (0092) y solo una política de lectura: el dueño de la base SIN BYPASSRLS (el de Neon; 0092 aclara que la migración no lo es) no podría
-- insertar. Se suelta la fuerza solo mientras se siembra y se restituye en la misma transacción (la migración corre entera en una; el ejecutor lo exige).
ALTER TABLE clase_de_asiento NO FORCE ROW LEVEL SECURITY;
INSERT INTO clase_de_asiento (sentido, clase, signo, exige_detalle, admite_vencimiento) VALUES
  ('A_COBRAR', 'CARGO_DE_VENTA_A_CUENTA', '+', false, true),
  ('A_COBRAR', 'COBRANZA', '-', false, false),
  ('A_COBRAR', 'AJUSTE_DE_SALDO', '±', true, false)
ON CONFLICT (sentido, clase) DO NOTHING;
ALTER TABLE clase_de_asiento FORCE ROW LEVEL SECURITY;
