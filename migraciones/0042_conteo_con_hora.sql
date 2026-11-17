-- 0042_conteo_con_hora: el conteo físico de E5 con la HORA a la que se contó y el motivo de lo que queda de diferencia.
-- Especificación: Pedernal-docs/11-especificaciones/e5-conteo-con-hora-y-filtros-especificacion.md (§3 modelo, §4, §5). Decisión del dueño de 11 y 12/11/2026.
--
-- Qué resuelve: hasta 0041 el ajuste comparaba lo contado contra lo que el sistema creía al CARGAR el conteo (`existencia_al_registrar`), así que lo
-- vendido entre contar y cargar inventaba unidades. Ahora cada carga trae `contado_en` (cuándo se contó), el sistema compara contra lo que creía a esa
-- hora (suma de los renglones con `hecho_en` <= hora, lo calcula el caso de uso al aplicar) y solo lo que SIGUE sin explicarse pide motivo de una lista
-- cerrada (`motivo_de_diferencia`). Una «venta no registrada» es solo un motivo: no crea ticket, venta ni cobro.
--
-- Reglas de esta migración (las mismas de 0001 a 0041):
--  * ADITIVA y COMPATIBLE hacia atrás: una columna NULL y tres tablas nuevas. No reescribe ni borra una sola fila (`conteo_registro` es de solo
--    inserción y el código viejo ignora la columna y las tablas). `existencia_al_registrar` SE CONSERVA aunque el ajuste ya no la use: quitarla sería
--    destructivo y se avisa antes (CF-D12). Se frena con un error claro si algo ya existe o falta una dependencia.
--  * Sin funciones SECURITY DEFINER; toda función fija `search_path = pg_catalog, public, pg_temp`. Ninguna se otorga a la aplicación.
--  * Nadie recibe DELETE ni TRUNCATE; INSERT por columna; sin UPDATE. RLS activa y FORZADA, una política por comando; claves foráneas compuestas con
--    `empresa_id`. Los textos se validan con la LISTA DE PERMITIDOS del catálogo (`texto_de_catalogo_valido`, 0025).
--  * Su reversión es un script aparte: `migraciones/reversiones/0042_revertir_conteo_con_hora.sql` (FRENA si hay datos: borrarlos es destructivo).
--  * DEPENDE de 0001 (`solo_insercion`, `empresa_operable`, `app_persona_id`), 0025 (`texto_de_catalogo_valido`) y 0030 (conteos y libro de stock).
--
-- Decisiones (las prueba `test/integracion/stock-conteo-con-hora-migracion.test.ts`):
--  H1. `contado_en` NULL significa «sin hora declarada» y se lee como `registrado_en` (coalesce): las filas viejas no se tocan (CF-D11). `contado_en <=
--      registrado_en`: no se cuenta en el futuro. La ventana de la hora (jornada vigente o anterior, no antes del último conteo aplicado) la valida el caso
--      de uso: necesita la jornada de la sucursal y el último conteo.
--  H2. `conteo_diferencia`: una fila por (conteo, artículo cargado), escrita al aplicar, también con diferencia 0 (idempotencia: PK por conteo y artículo).
--      Cuenta: bruta = contada − existencia a la hora; final = bruta − marcado; motivo NULO si y solo si la final es 0; el sentido del motivo sigue el
--      signo de la final.
--  H3. `conteo_marca`: los renglones que quien aplica declaró «ya ocurridos cuando contó». Solo del mismo depósito y artículo, posteriores a la hora
--      del conteo y del signo de la diferencia bruta; su suma es EXACTAMENTE `marcado` (disparador diferido) y nunca supera la diferencia bruta.
--  H4. La lista de motivos es una tabla global sembrada propia (CF-D9), no filas de `motivo_de_movimiento`: ese motivo es uno por movimiento y acá hay uno
--      por artículo; sumar `VENTA_NO_REGISTRADA` allá lo dejaría elegible en una salida manual.

DO $$
BEGIN
  IF to_regclass('public.conteo_registro') IS NULL OR to_regclass('public.renglon_de_movimiento') IS NULL THEN
    RAISE EXCEPTION '0042 necesita el stock de 0030 (conteo_registro y renglon_de_movimiento)' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION '0042 necesita texto_de_catalogo_valido de 0025' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.motivo_de_diferencia') IS NOT NULL OR to_regclass('public.conteo_diferencia') IS NOT NULL
     OR to_regclass('public.conteo_marca') IS NOT NULL THEN
    RAISE EXCEPTION '0042 ya está aplicada (existen sus tablas)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'conteo_registro' AND column_name = 'contado_en') THEN
    RAISE EXCEPTION '0042 ya está aplicada (existe conteo_registro.contado_en)' USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- La hora del conteo, por carga (por artículo): nullable, sin relleno.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE conteo_registro ADD COLUMN contado_en timestamptz;
ALTER TABLE conteo_registro ADD CONSTRAINT conteo_registro_contado_en_ck CHECK (contado_en IS NULL OR contado_en <= registrado_en);

-- ---------------------------------------------------------------------------------------------
-- Motivos de una diferencia de conteo: global, sembrada, solo lectura. Una prueba compara esta tabla con `MOTIVOS_DE_DIFERENCIA` de
-- `src/modulos/stock/dominio/motivos-de-diferencia.ts`.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE motivo_de_diferencia (
  codigo       text NOT NULL CONSTRAINT motivo_de_diferencia_codigo_ck CHECK (codigo ~ '^[A-Z][A-Z_]{1,39}$'),
  sentido      text NOT NULL CONSTRAINT motivo_de_diferencia_sentido_ck CHECK (sentido IN ('FALTANTE', 'SOBRANTE')),
  pide_detalle boolean NOT NULL DEFAULT false,
  orden        smallint NOT NULL CONSTRAINT motivo_de_diferencia_orden_ck CHECK (orden > 0),
  CONSTRAINT motivo_de_diferencia_pkey PRIMARY KEY (codigo),
  CONSTRAINT motivo_de_diferencia_orden_uk UNIQUE (sentido, orden)
);
INSERT INTO motivo_de_diferencia (codigo, sentido, pide_detalle, orden) VALUES
  ('VENTA_NO_REGISTRADA', 'FALTANTE', false, 1),
  ('CONSUMO_INTERNO', 'FALTANTE', false, 2),
  ('MERMA', 'FALTANTE', false, 3),
  ('ROTURA', 'FALTANTE', false, 4),
  ('VENCIMIENTO', 'FALTANTE', false, 5),
  ('OTRA_SALIDA', 'FALTANTE', true, 6),
  ('DEVOLUCION_DE_CLIENTE', 'SOBRANTE', false, 1),
  ('OTRA_ENTRADA', 'SOBRANTE', true, 2);

-- ---------------------------------------------------------------------------------------------
-- La explicación de cada artículo cargado de un conteo aplicado: solo inserción, una vez por (conteo, artículo).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE conteo_diferencia (
  empresa_id           uuid NOT NULL REFERENCES empresa (id),
  conteo_id            uuid NOT NULL,
  articulo_id          uuid NOT NULL,
  registro_id          uuid NOT NULL,                    -- la carga vigente que se usó (la de mayor `orden`)
  contada              numeric(18,4) NOT NULL CONSTRAINT conteo_diferencia_contada_ck CHECK (contada >= 0 AND contada < 100000000000000),
  contado_en           timestamptz NOT NULL,
  existencia_a_la_hora numeric(18,4) NOT NULL CONSTRAINT conteo_diferencia_existencia_ck
                       CHECK (existencia_a_la_hora > -100000000000000 AND existencia_a_la_hora < 100000000000000),
  diferencia_bruta     numeric(18,4) NOT NULL CONSTRAINT conteo_diferencia_bruta_rango_ck
                       CHECK (diferencia_bruta > -100000000000000 AND diferencia_bruta < 100000000000000),
  marcado              numeric(18,4) NOT NULL DEFAULT 0 CONSTRAINT conteo_diferencia_marcado_rango_ck
                       CHECK (marcado > -100000000000000 AND marcado < 100000000000000),
  diferencia_final     numeric(18,4) NOT NULL CONSTRAINT conteo_diferencia_final_rango_ck
                       CHECK (diferencia_final > -100000000000000 AND diferencia_final < 100000000000000),
  motivo               text,
  detalle              text CONSTRAINT conteo_diferencia_detalle_ck CHECK (detalle IS NULL OR texto_de_catalogo_valido(detalle, 300)),
  explicada_por        uuid NOT NULL REFERENCES persona (id),
  explicada_en         timestamptz NOT NULL,
  CONSTRAINT conteo_diferencia_pkey PRIMARY KEY (empresa_id, conteo_id, articulo_id),
  CONSTRAINT conteo_diferencia_conteo_fkey FOREIGN KEY (conteo_id, empresa_id) REFERENCES conteo_fisico (id, empresa_id),
  CONSTRAINT conteo_diferencia_articulo_fkey FOREIGN KEY (articulo_id, empresa_id) REFERENCES articulo_de_stock (id, empresa_id),
  CONSTRAINT conteo_diferencia_registro_fkey FOREIGN KEY (empresa_id, registro_id) REFERENCES conteo_registro (empresa_id, id),
  CONSTRAINT conteo_diferencia_motivo_fkey FOREIGN KEY (motivo) REFERENCES motivo_de_diferencia (codigo),
  CONSTRAINT conteo_diferencia_bruta_ck CHECK (diferencia_bruta = contada - existencia_a_la_hora),
  CONSTRAINT conteo_diferencia_cuenta_ck CHECK (diferencia_final = diferencia_bruta - marcado),
  CONSTRAINT conteo_diferencia_marcado_ck CHECK (
    marcado = 0 OR (sign(marcado) = sign(diferencia_bruta) AND abs(marcado) <= abs(diferencia_bruta))
  ),
  CONSTRAINT conteo_diferencia_motivo_ck CHECK ((diferencia_final = 0) = (motivo IS NULL)),
  CONSTRAINT conteo_diferencia_detalle_con_motivo_ck CHECK (detalle IS NULL OR motivo IS NOT NULL)
);

-- ---------------------------------------------------------------------------------------------
-- Los movimientos que quien aplica marcó como «ya ocurridos cuando contó»: solo inserción.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE conteo_marca (
  empresa_id    uuid NOT NULL REFERENCES empresa (id),
  conteo_id     uuid NOT NULL,
  articulo_id   uuid NOT NULL,
  movimiento_id uuid NOT NULL,
  numero        integer NOT NULL,
  cantidad      numeric(18,4) NOT NULL CONSTRAINT conteo_marca_cantidad_ck
                CHECK (cantidad <> 0 AND cantidad > -100000000000000 AND cantidad < 100000000000000),  -- copia con signo del renglón
  marcada_por   uuid NOT NULL REFERENCES persona (id),
  marcada_en    timestamptz NOT NULL,
  CONSTRAINT conteo_marca_pkey PRIMARY KEY (empresa_id, conteo_id, movimiento_id, numero),
  CONSTRAINT conteo_marca_diferencia_fkey FOREIGN KEY (empresa_id, conteo_id, articulo_id)
    REFERENCES conteo_diferencia (empresa_id, conteo_id, articulo_id),
  CONSTRAINT conteo_marca_renglon_fkey FOREIGN KEY (empresa_id, movimiento_id, numero)
    REFERENCES renglon_de_movimiento (empresa_id, movimiento_id, numero)
);

-- ---------------------------------------------------------------------------------------------
-- Disparadores: lo que la base impone aunque el código se olvide.
-- ---------------------------------------------------------------------------------------------

-- Una explicación: el conteo ya está APLICADO (se escribe después de resolverlo), la carga es de ese conteo y artículo y es la vigente (la de mayor
-- `orden`), lo contado y la hora son los de esa carga, y el motivo es del sentido de la diferencia final (y pide detalle si el motivo lo pide).
CREATE FUNCTION conteo_diferencia_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_registro record;
  v_sentido text;
  v_pide boolean;
BEGIN
  SELECT c.estado INTO v_estado
    FROM public.conteo_fisico c WHERE c.id = NEW.conteo_id AND c.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el conteo no existe' USING ERRCODE = '23503', CONSTRAINT = 'conteo_diferencia_conteo_fkey';
  END IF;
  IF v_estado <> 'APLICADO' THEN
    RAISE EXCEPTION 'la explicación de un conteo se escribe al aplicarlo' USING ERRCODE = '23514', CONSTRAINT = 'conteo_diferencia_conteo_no_aplicado';
  END IF;
  SELECT r.conteo_id, r.articulo_id, r.cantidad_contada, r.orden, coalesce(r.contado_en, r.registrado_en) AS hora INTO v_registro
    FROM public.conteo_registro r WHERE r.id = NEW.registro_id AND r.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la carga no existe' USING ERRCODE = '23503', CONSTRAINT = 'conteo_diferencia_registro_fkey';
  END IF;
  IF v_registro.conteo_id <> NEW.conteo_id OR v_registro.articulo_id <> NEW.articulo_id THEN
    RAISE EXCEPTION 'la carga es de otro conteo o de otro artículo' USING ERRCODE = '23514', CONSTRAINT = 'conteo_diferencia_registro_ajeno';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conteo_registro r
              WHERE r.empresa_id = NEW.empresa_id AND r.conteo_id = NEW.conteo_id AND r.articulo_id = NEW.articulo_id AND r.orden > v_registro.orden) THEN
    RAISE EXCEPTION 'la carga no es la vigente del artículo' USING ERRCODE = '23514', CONSTRAINT = 'conteo_diferencia_registro_no_vigente';
  END IF;
  IF NEW.contada <> v_registro.cantidad_contada OR NEW.contado_en <> v_registro.hora THEN
    RAISE EXCEPTION 'lo contado y la hora son los de la carga vigente' USING ERRCODE = '23514', CONSTRAINT = 'conteo_diferencia_distinta_de_la_carga';
  END IF;
  IF NEW.motivo IS NOT NULL THEN
    SELECT m.sentido, m.pide_detalle INTO v_sentido, v_pide FROM public.motivo_de_diferencia m WHERE m.codigo = NEW.motivo;
    IF v_sentido IS DISTINCT FROM (CASE WHEN NEW.diferencia_final < 0 THEN 'FALTANTE' ELSE 'SOBRANTE' END) THEN
      RAISE EXCEPTION 'el motivo no es del sentido de la diferencia' USING ERRCODE = '23514', CONSTRAINT = 'conteo_diferencia_motivo_sentido';
    END IF;
    IF v_pide AND NEW.detalle IS NULL THEN
      RAISE EXCEPTION 'el motivo pide detalle' USING ERRCODE = '23514', CONSTRAINT = 'conteo_diferencia_detalle_requerido';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Una marca: el renglón es del depósito del conteo y del artículo de la explicación, ocurrió DESPUÉS de la hora del conteo y tiene el signo de la
-- diferencia bruta (un faltante se explica con lo que restó; un sobrante, con lo que sumó); la cantidad es la del renglón.
CREATE FUNCTION conteo_marca_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_diferencia record;
  v_deposito uuid;
  v_renglon record;
BEGIN
  SELECT d.contado_en, d.diferencia_bruta INTO v_diferencia
    FROM public.conteo_diferencia d
   WHERE d.empresa_id = NEW.empresa_id AND d.conteo_id = NEW.conteo_id AND d.articulo_id = NEW.articulo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la explicación del artículo no existe' USING ERRCODE = '23503', CONSTRAINT = 'conteo_marca_diferencia_fkey';
  END IF;
  SELECT c.deposito_id INTO v_deposito FROM public.conteo_fisico c WHERE c.id = NEW.conteo_id AND c.empresa_id = NEW.empresa_id;
  SELECT r.deposito_id, r.articulo_id, r.cantidad, r.hecho_en INTO v_renglon
    FROM public.renglon_de_movimiento r
   WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = NEW.movimiento_id AND r.numero = NEW.numero;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el renglón no existe' USING ERRCODE = '23503', CONSTRAINT = 'conteo_marca_renglon_fkey';
  END IF;
  IF v_renglon.deposito_id <> v_deposito OR v_renglon.articulo_id <> NEW.articulo_id
     OR v_renglon.hecho_en <= v_diferencia.contado_en OR sign(v_renglon.cantidad) <> sign(v_diferencia.diferencia_bruta)
     OR v_renglon.cantidad <> NEW.cantidad THEN
    RAISE EXCEPTION 'el movimiento no explica la diferencia' USING ERRCODE = '23514', CONSTRAINT = 'conteo_marca_no_explica';
  END IF;
  RETURN NEW;
END
$$;

-- Al confirmar: lo marcado de cada artículo es EXACTAMENTE la suma de sus marcas (una diferencia con `marcado` ≠ 0 sin sus marcas, o al revés, no queda).
CREATE FUNCTION conteo_diferencia_coherente() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_marcado numeric;
  v_suma numeric;
BEGIN
  SELECT d.marcado INTO v_marcado
    FROM public.conteo_diferencia d
   WHERE d.empresa_id = NEW.empresa_id AND d.conteo_id = NEW.conteo_id AND d.articulo_id = NEW.articulo_id;
  SELECT coalesce(sum(m.cantidad), 0) INTO v_suma
    FROM public.conteo_marca m
   WHERE m.empresa_id = NEW.empresa_id AND m.conteo_id = NEW.conteo_id AND m.articulo_id = NEW.articulo_id;
  IF v_marcado IS DISTINCT FROM v_suma THEN
    RAISE EXCEPTION 'lo marcado no coincide con la suma de las marcas' USING ERRCODE = '23514', CONSTRAINT = 'conteo_diferencia_marcado_distinto_de_las_marcas';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER conteo_diferencia_alta BEFORE INSERT ON conteo_diferencia
  FOR EACH ROW EXECUTE FUNCTION conteo_diferencia_validar();
CREATE CONSTRAINT TRIGGER conteo_diferencia_coherente_de_la_diferencia AFTER INSERT ON conteo_diferencia
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION conteo_diferencia_coherente();
CREATE TRIGGER conteo_marca_alta BEFORE INSERT ON conteo_marca
  FOR EACH ROW EXECUTE FUNCTION conteo_marca_validar();
CREATE CONSTRAINT TRIGGER conteo_diferencia_coherente_de_la_marca AFTER INSERT ON conteo_marca
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION conteo_diferencia_coherente();

-- De solo inserción: `solo_insercion()` rechaza el UPDATE, el DELETE y el vaciado, aun al dueño de la base.
CREATE TRIGGER motivo_de_diferencia_solo_insercion BEFORE UPDATE OR DELETE ON motivo_de_diferencia
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER motivo_de_diferencia_sin_truncate BEFORE TRUNCATE ON motivo_de_diferencia
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER conteo_diferencia_solo_insercion BEFORE UPDATE OR DELETE ON conteo_diferencia
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER conteo_diferencia_sin_truncate BEFORE TRUNCATE ON conteo_diferencia
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER conteo_marca_solo_insercion BEFORE UPDATE OR DELETE ON conteo_marca
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER conteo_marca_sin_truncate BEFORE TRUNCATE ON conteo_marca
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna; nadie recibe UPDATE, DELETE ni TRUNCATE sobre las tablas nuevas.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON motivo_de_diferencia, conteo_diferencia, conteo_marca FROM PUBLIC;
GRANT SELECT ON motivo_de_diferencia, conteo_diferencia, conteo_marca TO pedernal_app;
GRANT INSERT (contado_en) ON conteo_registro TO pedernal_app;
GRANT INSERT (empresa_id, conteo_id, articulo_id, registro_id, contada, contado_en, existencia_a_la_hora, diferencia_bruta, marcado,
              diferencia_final, motivo, detalle, explicada_por, explicada_en)
  ON conteo_diferencia TO pedernal_app;
GRANT INSERT (empresa_id, conteo_id, articulo_id, movimiento_id, numero, cantidad, marcada_por, marcada_en) ON conteo_marca TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada; sin política no hay acceso.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE motivo_de_diferencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE motivo_de_diferencia FORCE ROW LEVEL SECURITY;
ALTER TABLE conteo_diferencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE conteo_diferencia FORCE ROW LEVEL SECURITY;
ALTER TABLE conteo_marca ENABLE ROW LEVEL SECURITY;
ALTER TABLE conteo_marca FORCE ROW LEVEL SECURITY;

CREATE POLICY motivo_de_diferencia_app_leer ON motivo_de_diferencia FOR SELECT TO pedernal_app USING (true);

CREATE POLICY conteo_diferencia_app_leer ON conteo_diferencia FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY conteo_diferencia_app_alta ON conteo_diferencia FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND explicada_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );

CREATE POLICY conteo_marca_app_leer ON conteo_marca FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY conteo_marca_app_alta ON conteo_marca FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND marcada_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
