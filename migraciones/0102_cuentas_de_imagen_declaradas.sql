-- 0102_cuentas_de_imagen_declaradas: las cuentas del proveedor de imágenes (hoy solo Cloudinary) que cada empresa DECLARA como suyas, y la defensa en la base de que el logo de una
-- carta solo se guarde desde una cuenta declarada y activa de SU empresa (deuda `logo-de-carta--cuentas-declaradas`; spec de la carta §5.7.2; decisión del dueño 25/11/2026, filas 452 y 453).
--  * Tabla `cuenta_de_imagen_declarada`: hasta 2 cuentas ACTIVAS por empresa (tope serializado con un bloqueo por empresa), una cuenta activa una sola vez por empresa, y la MISMA cuenta
--    puede estar declarada por varias empresas (una agencia lleva a varios clientes: no hay unicidad entre empresas). Retirar NO borra: la fila pasa a RETIRADA con quién, cuándo y por qué,
--    y no vuelve a ACTIVA (volver a declarar la cuenta es una fila nueva: queda el rastro). Idempotencia por `(empresa_id, clave_idempotencia)` más la huella del contenido.
--  * `carta_publica_logo_declarado`: un logo nuevo o cambiado solo entra si su cuenta está declarada y activa en la empresa de la carta. Un logo que NO cambia no se vuelve a validar:
--    las cartas que ya tenían logo de una cuenta no declarada siguen editándose; ese logo deja de mostrarse (lo decide el servidor al traer) hasta que la empresa declare la cuenta.
--    Retirar una cuenta después tampoco bloquea nada: las cartas que la usaban dejan de mostrar el logo.
--  * Aislamiento: RLS activa y forzada; la aplicación ve y escribe solo su empresa; el rol público lee SOLO (empresa, proveedor, cuenta, estado) de las cuentas ACTIVAS de la empresa de la
--    carta cuyo código fijó la visita (`app.codigo_de_carta`), por la misma política de `carta_publica`.
-- Reglas de esta migración (las de 0084 y 0094):
--  * ADITIVA y compatible hacia atrás: solo objetos nuevos (tabla, tres funciones, cinco disparadores sobre la tabla nueva —tope_ins, 1_cambia, 2_version, sin_borrado y sin_truncate— y uno sobre `carta_publica`). No cambia ni rellena ninguna fila existente
--    y no declara cuentas por nadie: declarar la cuenta de un logo ya cargado legitimaría justo el riesgo que esta deuda cierra.
--  * Sin SECURITY DEFINER: todas las funciones fijan `search_path` y califican con `public.`. Nadie recibe DELETE ni TRUNCATE. INSERT y UPDATE por columna.
--  * El reloj de la base fija `declarada_en` (default) y `retirada_en` (disparador); la aplicación solo manda quién retira y el motivo.
-- Su reversión es `migraciones/reversiones/0102_revertir_cuentas_de_imagen_declaradas.sql` (FRENA si hay cuentas declaradas; AVISAR AL DUEÑO). El ejecutor no la aplica.
-- DEPENDE de 0001 (empresa, persona, app_empresa_id, app_persona_id, empresa_operable, fijar_version_y_fecha), 0007 (rol público, sin_borrado), 0025 (texto_de_catalogo_valido),
-- 0043 (carta_publica) y 0077 (las columnas del logo); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.carta_publica') IS NULL OR to_regprocedure('public.imagen_externa_valida(text, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION '0102 necesita 0043 y 0077 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.cuenta_de_imagen_declarada') IS NOT NULL THEN
    RAISE EXCEPTION '0102: la tabla cuenta_de_imagen_declarada ya existe; esta migración solo crea objetos nuevos' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL
     OR to_regprocedure('public.sin_borrado()') IS NULL OR to_regprocedure('public.app_empresa_id()') IS NULL
     OR to_regprocedure('public.app_persona_id()') IS NULL OR to_regprocedure('public.empresa_operable(uuid)') IS NULL THEN
    RAISE EXCEPTION '0102 necesita las funciones de 0001, 0007 y 0025' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_publico') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_app') THEN
    RAISE EXCEPTION '0102 necesita los roles pedernal_app y pedernal_publico' USING ERRCODE = '55000';
  END IF;
END
$$;

CREATE TABLE cuenta_de_imagen_declarada (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  proveedor          text NOT NULL CONSTRAINT cuenta_de_imagen_proveedor_ck CHECK (proveedor IN ('CLOUDINARY')),
  cuenta             text NOT NULL CONSTRAINT cuenta_de_imagen_cuenta_ck CHECK (cuenta ~ '^[a-z0-9_-]{1,64}$'),
  estado             text NOT NULL DEFAULT 'ACTIVA' CONSTRAINT cuenta_de_imagen_estado_ck CHECK (estado IN ('ACTIVA', 'RETIRADA')),
  clave_idempotencia text NOT NULL CONSTRAINT cuenta_de_imagen_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella             text NOT NULL CONSTRAINT cuenta_de_imagen_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  declarada_por      uuid NOT NULL REFERENCES persona (id),
  declarada_en       timestamptz NOT NULL DEFAULT now(),
  retirada_por       uuid REFERENCES persona (id),
  retirada_en        timestamptz,
  motivo_de_retiro   text CONSTRAINT cuenta_de_imagen_motivo_ck CHECK (motivo_de_retiro IS NULL OR texto_de_catalogo_valido(motivo_de_retiro, 300)),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CONSTRAINT cuenta_de_imagen_declarada_pkey PRIMARY KEY (id),
  CONSTRAINT cuenta_de_imagen_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT cuenta_de_imagen_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  -- ACTIVA: ningún dato de retiro. RETIRADA: los tres, juntos.
  CONSTRAINT cuenta_de_imagen_retiro_ck CHECK (
    (estado = 'ACTIVA' AND retirada_por IS NULL AND retirada_en IS NULL AND motivo_de_retiro IS NULL)
    OR (estado = 'RETIRADA' AND retirada_por IS NOT NULL AND retirada_en IS NOT NULL AND motivo_de_retiro IS NOT NULL)
  )
);
-- Una cuenta ACTIVA una sola vez por empresa (la misma cuenta SÍ puede estar en otra empresa).
CREATE UNIQUE INDEX cuenta_de_imagen_activa_uk ON cuenta_de_imagen_declarada (empresa_id, proveedor, cuenta) WHERE estado = 'ACTIVA';
CREATE INDEX cuenta_de_imagen_empresa_ix ON cuenta_de_imagen_declarada (empresa_id) WHERE estado = 'ACTIVA';

-- Tope de 2 activas por empresa. Dos altas simultáneas se serializan con el bloqueo de la empresa (mismo patrón que 0045 y 0084); bajo SERIALIZABLE, la que no ve a la otra aborta por
-- serialización y se repite viendo la fila (la prueba de concurrencia lo ejerce). Solo cuenta al INSERTAR: no hay camino de RETIRADA a ACTIVA, así que un UPDATE nunca suma una activa.
CREATE FUNCTION cuenta_de_imagen_tope() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.estado = 'ACTIVA' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('cuenta_de_imagen:' || NEW.empresa_id::text, 0));
    IF (SELECT count(*) FROM public.cuenta_de_imagen_declarada c WHERE c.empresa_id = NEW.empresa_id AND c.estado = 'ACTIVA') >= 2 THEN
      RAISE EXCEPTION 'una empresa declara hasta 2 cuentas de imagen activas' USING ERRCODE = '23514', CONSTRAINT = 'cuenta_de_imagen_tope';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cuenta_de_imagen_tope_ins BEFORE INSERT ON cuenta_de_imagen_declarada FOR EACH ROW EXECUTE FUNCTION cuenta_de_imagen_tope();

-- Cambio: solo ACTIVA → RETIRADA (quién y el motivo los manda la aplicación; el momento lo fija la base); lo demás es inmutable y una RETIRADA no vuelve a ACTIVA.
CREATE FUNCTION cuenta_de_imagen_cambia() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_libres text[] := ARRAY['estado', 'retirada_por', 'retirada_en', 'motivo_de_retiro', 'version', 'actualizado_en'];
BEGIN
  IF (to_jsonb(NEW) - v_libres) IS DISTINCT FROM (to_jsonb(OLD) - v_libres) THEN
    RAISE EXCEPTION 'de una cuenta de imagen declarada solo cambia su retiro' USING ERRCODE = '23514', CONSTRAINT = 'cuenta_de_imagen_inmutable';
  END IF;
  IF NOT (OLD.estado = 'ACTIVA' AND NEW.estado = 'RETIRADA') THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado USING ERRCODE = '23514', CONSTRAINT = 'cuenta_de_imagen_transicion_invalida';
  END IF;
  NEW.retirada_en := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER cuenta_de_imagen_1_cambia BEFORE UPDATE ON cuenta_de_imagen_declarada FOR EACH ROW EXECUTE FUNCTION cuenta_de_imagen_cambia();
CREATE TRIGGER cuenta_de_imagen_2_version BEFORE UPDATE ON cuenta_de_imagen_declarada FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER cuenta_de_imagen_sin_borrado BEFORE DELETE ON cuenta_de_imagen_declarada FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER cuenta_de_imagen_sin_truncate BEFORE TRUNCATE ON cuenta_de_imagen_declarada FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- Defensa en profundidad: un logo nuevo o cambiado solo se guarda si su cuenta está declarada y activa en SU empresa. El logo que no cambia no se revalida (ver arriba).
CREATE FUNCTION carta_publica_logo_declarado() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.logo_cuenta IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.logo_proveedor, NEW.logo_cuenta, NEW.logo_id_publico, NEW.logo_version, NEW.logo_extension)
         IS NOT DISTINCT FROM (OLD.logo_proveedor, OLD.logo_cuenta, OLD.logo_id_publico, OLD.logo_version, OLD.logo_extension) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.cuenta_de_imagen_declarada c
        WHERE c.empresa_id = NEW.empresa_id AND c.proveedor = NEW.logo_proveedor AND c.cuenta = NEW.logo_cuenta AND c.estado = 'ACTIVA') THEN
    RAISE EXCEPTION 'la cuenta del logo no está declarada por la empresa' USING ERRCODE = '23514', CONSTRAINT = 'carta_publica_logo_cuenta_declarada';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER carta_publica_logo_declarado BEFORE INSERT OR UPDATE OF logo_proveedor, logo_cuenta, logo_id_publico, logo_version, logo_extension ON carta_publica
  FOR EACH ROW EXECUTE FUNCTION carta_publica_logo_declarado();

-- Aislamiento: RLS activa y forzada.
REVOKE ALL ON cuenta_de_imagen_declarada FROM PUBLIC;
ALTER TABLE cuenta_de_imagen_declarada ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuenta_de_imagen_declarada FORCE ROW LEVEL SECURITY;

CREATE POLICY cuenta_de_imagen_app_leer ON cuenta_de_imagen_declarada FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY cuenta_de_imagen_app_alta ON cuenta_de_imagen_declarada FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND declarada_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY cuenta_de_imagen_app_cambiar ON cuenta_de_imagen_declarada FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND retirada_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
-- Público: solo las ACTIVAS de la empresa de la carta pedida (y solo si la carta está en línea: la subconsulta pasa por la política de `carta_publica`). Sin código fijado no devuelve nada.
CREATE POLICY cuenta_de_imagen_publico_de_carta ON cuenta_de_imagen_declarada FOR SELECT TO pedernal_publico
  USING (estado = 'ACTIVA' AND EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.empresa_id = cuenta_de_imagen_declarada.empresa_id
  ));

GRANT SELECT ON cuenta_de_imagen_declarada TO pedernal_app;
GRANT INSERT (id, empresa_id, proveedor, cuenta, clave_idempotencia, huella, declarada_por) ON cuenta_de_imagen_declarada TO pedernal_app;
GRANT UPDATE (estado, retirada_por, motivo_de_retiro) ON cuenta_de_imagen_declarada TO pedernal_app;
GRANT SELECT (empresa_id, proveedor, cuenta, estado) ON cuenta_de_imagen_declarada TO pedernal_publico;
