-- 0031_stock_costos: el costo del stock (E5 tramo TCO, E5-T10): el costo promedio móvil ponderado por (depósito, artículo) y el costo
-- congelado de cada renglón del libro. Dos tablas nuevas, aditivas; no toca ninguna de 0030.
-- Especificación: Pedernal-docs/11-especificaciones/e5-stock-especificacion.md (§3.6 y P-1) y decisiones 24, 25 y 91 de
-- catalogo-y-niveles-maqueta.md (D24: promedio ponderado por depósito; PEPS y capas quedan fuera).
--
-- Reglas de esta migración (las mismas de 0001 a 0030):
--  * Es ADITIVA: crea dos tablas. Nada se rellena: ningún movimiento anterior tiene costo (su renglón queda sin fila de costo y se lee como
--    «sin dato»). Se frena con un error claro si alguna de las dos ya existe.
--  * No agrega NINGUNA función SECURITY DEFINER. Toda función fija `search_path = pg_catalog, public, pg_temp` y califica sus tablas con
--    `public.`. Ninguna función nueva se otorga a la aplicación: es de disparador.
--  * Nadie recibe DELETE ni TRUNCATE. INSERT y UPDATE van por columna. RLS activa y FORZADA; una política por comando, ninguna `FOR ALL`.
--  * Toda clave foránea entre tablas de empresa lleva `empresa_id`. Importes en `numeric(18,6)` y cantidades en `numeric(18,4)`, exactos
--    (nunca flotantes) y con cota en ambos sentidos: `numeric` acepta `NaN`, que es mayor que todo número y pasaría un `>= 0`.
--  * Su reversión es un script aparte, revisado y DESTRUCTIVO si hay datos: `migraciones/reversiones/0031_revertir_stock_costos.sql`.
--
-- Decisiones de diseño (probadas por `test/integracion/stock-costos.test.ts`):
--
--  C1. `costo_de_articulo` es el ESTADO del promedio por (depósito, artículo): el costo unitario vigente y la cantidad valorizada (las
--      unidades que tienen costo: lo que entró «sin costo» no cuenta). Se escribe con INSERT y UPDATE desde el caso de uso de costos, en la
--      misma transacción del movimiento y DESPUÉS de que el renglón haya tomado el saldo (el saldo serializa a quienes mueven lo mismo). Su
--      clave foránea al saldo exige que el par exista en el libro. Moneda `ARS` explícita (CHECK).
--  C2. `costo_de_renglon` es el costo CONGELADO de cada renglón: `DEFINITIVO` con su costo unitario, o `SIN_COSTO` con el costo nulo (nunca
--      cero: cero sería inventar un dato). Es de SOLO INSERCIÓN (ni el dueño la cambia) y solo entra en la misma transacción que el movimiento
--      del renglón: un cambio posterior del precio de compra no reescribe lo ya costeado.
--  C3. El costo es dato de la empresa y la RLS lo aísla como a todo el stock; quién puede VERLO lo decide la acción `costos.ver` en el
--      servidor, no la base.

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.empresa') IS NULL OR to_regprocedure('public.solo_insercion()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL OR to_regprocedure('public.app_empresa_id()') IS NULL
     OR to_regprocedure('public.sin_borrado()') IS NULL THEN
    RAISE EXCEPTION 'los costos de stock requieren 0001 y 0007 (empresa, funciones de contexto, de solo inserción y de borrado) aplicadas antes'
      USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.saldo_de_stock') IS NULL OR to_regclass('public.renglon_de_movimiento') IS NULL
     OR to_regclass('public.movimiento_de_stock') IS NULL THEN
    RAISE EXCEPTION 'los costos de stock requieren 0030_stock aplicada antes (faltan el saldo, el renglón o el movimiento)'
      USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['costo_de_articulo', 'costo_de_renglon'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'los costos de stock nacen en 0031: la tabla % ya existe (alguien la creó a mano); hay que revisarla antes de migrar', v_tabla
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Costo de artículo: el promedio móvil ponderado por (depósito, artículo). Sin fila: nunca entró nada con costo.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE costo_de_articulo (
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  deposito_id         uuid NOT NULL,
  articulo_id         uuid NOT NULL,
  costo_unitario      numeric(18,6) NOT NULL CONSTRAINT costo_de_articulo_costo_ck
                      CHECK (costo_unitario >= 0 AND costo_unitario < 1000000000000),
  cantidad_valorizada numeric(18,4) NOT NULL CONSTRAINT costo_de_articulo_cantidad_ck
                      CHECK (cantidad_valorizada >= 0 AND cantidad_valorizada < 100000000000000),
  moneda              char(3) NOT NULL DEFAULT 'ARS' CONSTRAINT costo_de_articulo_moneda_ck CHECK (moneda = 'ARS'),
  CONSTRAINT costo_de_articulo_pkey PRIMARY KEY (empresa_id, deposito_id, articulo_id),
  CONSTRAINT costo_de_articulo_saldo_fkey FOREIGN KEY (empresa_id, deposito_id, articulo_id)
    REFERENCES saldo_de_stock (empresa_id, deposito_id, articulo_id)
);
CREATE INDEX costo_de_articulo_articulo_ix ON costo_de_articulo (empresa_id, articulo_id);

-- ---------------------------------------------------------------------------------------------
-- Costo de renglón: el costo congelado de cada renglón del libro. `costo_unitario` nulo si y solo si `SIN_COSTO`.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE costo_de_renglon (
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  movimiento_id  uuid NOT NULL,
  numero         integer NOT NULL,
  estado         text NOT NULL CONSTRAINT costo_de_renglon_estado_ck CHECK (estado IN ('SIN_COSTO', 'DEFINITIVO')),
  costo_unitario numeric(18,6) CONSTRAINT costo_de_renglon_costo_ck
                 CHECK (costo_unitario >= 0 AND costo_unitario < 1000000000000),
  CONSTRAINT costo_de_renglon_pkey PRIMARY KEY (empresa_id, movimiento_id, numero),
  CONSTRAINT costo_de_renglon_estado_y_costo_ck CHECK ((estado = 'SIN_COSTO') = (costo_unitario IS NULL)),
  CONSTRAINT costo_de_renglon_renglon_fkey FOREIGN KEY (empresa_id, movimiento_id, numero)
    REFERENCES renglon_de_movimiento (empresa_id, movimiento_id, numero)
);

-- Costo de renglón (antes de insertar): solo en la misma transacción que el movimiento de su renglón (C2).
CREATE FUNCTION costo_de_renglon_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_de_esta_transaccion boolean;
BEGIN
  SELECT x.registrado_en = now() INTO v_de_esta_transaccion
    FROM public.movimiento_de_stock x WHERE x.id = NEW.movimiento_id AND x.empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el movimiento del costo no existe'
      USING ERRCODE = '23503', CONSTRAINT = 'costo_de_renglon_renglon_fkey';
  END IF;
  IF NOT v_de_esta_transaccion THEN
    RAISE EXCEPTION 'el costo de un renglón solo se carga en la misma transacción que crea su movimiento'
      USING ERRCODE = '23514', CONSTRAINT = 'costo_de_renglon_movimiento_confirmado';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER costo_de_renglon_alta BEFORE INSERT ON costo_de_renglon
  FOR EACH ROW EXECUTE FUNCTION costo_de_renglon_validar();

-- Nada se borra ni se vacía (ni el dueño de la base); el costo congelado además no se modifica.
CREATE TRIGGER costo_de_articulo_sin_borrado BEFORE DELETE ON costo_de_articulo
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER costo_de_articulo_sin_truncate BEFORE TRUNCATE ON costo_de_articulo
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER costo_de_renglon_solo_insercion BEFORE UPDATE OR DELETE ON costo_de_renglon
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER costo_de_renglon_sin_truncate BEFORE TRUNCATE ON costo_de_renglon
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE ni TRUNCATE. Solo la aplicación (`pedernal_app`) recibe algo. `moneda` no se concede:
-- la fija la base.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON costo_de_articulo, costo_de_renglon FROM PUBLIC;

GRANT SELECT ON costo_de_articulo, costo_de_renglon TO pedernal_app;
GRANT INSERT (empresa_id, deposito_id, articulo_id, costo_unitario, cantidad_valorizada) ON costo_de_articulo TO pedernal_app;
GRANT UPDATE (costo_unitario, cantidad_valorizada) ON costo_de_articulo TO pedernal_app;
GRANT INSERT (empresa_id, movimiento_id, numero, estado, costo_unitario) ON costo_de_renglon TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada; una política por comando, siempre con la empresa del contexto
-- ---------------------------------------------------------------------------------------------
ALTER TABLE costo_de_articulo ENABLE ROW LEVEL SECURITY;
ALTER TABLE costo_de_articulo FORCE ROW LEVEL SECURITY;
ALTER TABLE costo_de_renglon ENABLE ROW LEVEL SECURITY;
ALTER TABLE costo_de_renglon FORCE ROW LEVEL SECURITY;

CREATE POLICY costo_de_articulo_app_leer ON costo_de_articulo FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY costo_de_articulo_app_alta ON costo_de_articulo FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY costo_de_articulo_app_cambiar ON costo_de_articulo FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

CREATE POLICY costo_de_renglon_app_leer ON costo_de_renglon FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY costo_de_renglon_app_alta ON costo_de_renglon FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
