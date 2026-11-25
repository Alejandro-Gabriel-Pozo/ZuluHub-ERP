-- 0098_correccion_de_lo_recibido: corregir lo recibido de una línea de recepción separada ya confirmada (PR D, decisión del dueño 25/11/2026).
-- La recepción no se reabre ni se edita: cada corrección es una fila nueva de solo inserción, con su movimiento de stock y su causa. El valor vigente es el de la última corrección.
--  * Tabla `correccion_de_lo_recibido`: cantidad de antes y de después (en la unidad de stock, la misma de `saldo_de_linea_de_recepcion` y de la conciliación), causa de una lista
--    cerrada, nota opcional, movimiento de stock que la ejecutó y clave/huella de idempotencia. `numero` encadena las correcciones de una línea: dos a la vez, gana una.
--  * Disparador `correccion_de_lo_recibido_aplicar`: al insertar la corrección ajusta `saldo_de_linea_de_recepcion.cantidad_recibida` SOLO si coincide con `cantidad_anterior` y
--    no queda por debajo de lo ya conciliado (misma técnica que `asignacion_aplicar`: UPDATE condicionado, una fila o excepción). Exige recepción CONFIRMADA de nivel
--    RECEPCION_SEPARADA y que el movimiento exista con origen = esta corrección, clase coherente con el signo y la misma empresa.
--  * Motivos de stock `CORRECCION_DE_RECEPCION` (ENTRADA y SALIDA): solo los escribe el puerto de compras (origen `CORRECCION_DE_RECEPCION`), nunca una persona.
-- Reglas de esta migración (las de 0036, 0047 y 0093):
--  * ADITIVA y compatible hacia atrás: tabla nueva, dos filas nuevas en una tabla de solo inserción, una función y un disparador nuevos, un permiso de UPDATE por columna que el
--    disparador de guardia sigue limitando (solo lo escribe un disparador anidado). No rellena, no cambia ni borra datos existentes.
--  * Su reversión es `migraciones/reversiones/0098_revertir_correccion_de_lo_recibido.sql` (DESTRUCTIVA si hay correcciones: frena antes). El ejecutor no la aplica.
-- DEPENDE de 0030 (stock), 0037 (compras) y 0063 (recepción separada); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.saldo_de_linea_de_recepcion') IS NULL OR to_regclass('public.entrada_de_linea_de_recepcion') IS NULL OR to_regclass('public.movimiento_de_stock') IS NULL OR to_regclass('public.motivo_de_movimiento') IS NULL THEN
    RAISE EXCEPTION '0098 necesita 0030, 0037 y 0063 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.correccion_de_lo_recibido') IS NOT NULL THEN
    RAISE EXCEPTION '0098: la tabla correccion_de_lo_recibido ya existe; esta migración solo crea objetos nuevos' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL OR to_regprocedure('public.solo_insercion()') IS NULL
     OR to_regprocedure('public.app_empresa_id()') IS NULL OR to_regprocedure('public.empresa_operable(uuid)') IS NULL THEN
    RAISE EXCEPTION '0098 necesita las funciones de 0001, 0005, 0007 y 0025' USING ERRCODE = '55000';
  END IF;
END
$$;

INSERT INTO motivo_de_movimiento (clase, codigo, entra_con_costo, entrega_mercaderia) VALUES
  ('ENTRADA', 'CORRECCION_DE_RECEPCION', true, false),
  ('SALIDA', 'CORRECCION_DE_RECEPCION', false, false)
  ON CONFLICT (clase, codigo) DO NOTHING;   -- la reversión no borra los motivos (tabla de solo inserción): al reaplicar ya están

CREATE TABLE correccion_de_lo_recibido (
  id                 uuid NOT NULL,
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  recepcion_id       uuid NOT NULL,
  linea              integer NOT NULL,
  -- La versión optimista: dos correcciones de la misma línea a la vez, gana una (la otra choca con esta clave).
  numero             integer NOT NULL CONSTRAINT correccion_de_lo_recibido_numero_ck CHECK (numero >= 1),
  cantidad_anterior  numeric(18,4) NOT NULL CONSTRAINT correccion_de_lo_recibido_anterior_ck CHECK (cantidad_anterior > 0 AND cantidad_anterior < 100000000000000),
  cantidad_nueva     numeric(18,4) NOT NULL CONSTRAINT correccion_de_lo_recibido_nueva_ck CHECK (cantidad_nueva > 0 AND cantidad_nueva < 100000000000000),
  causa              text NOT NULL CONSTRAINT correccion_de_lo_recibido_causa_ck CHECK (causa IN ('ERROR_DE_CARGA', 'REPARTO_INTERNO', 'FALTANTE_DEL_PROVEEDOR')),
  nota               text CONSTRAINT correccion_de_lo_recibido_nota_ck CHECK (nota IS NULL OR texto_de_catalogo_valido(nota, 200)),
  movimiento_id      uuid NOT NULL,
  clave_idempotencia text NOT NULL CONSTRAINT correccion_de_lo_recibido_clave_ck CHECK (clave_idempotencia ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella             text NOT NULL CONSTRAINT correccion_de_lo_recibido_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  registrado_por     uuid NOT NULL REFERENCES persona (id),
  CONSTRAINT correccion_de_lo_recibido_pkey PRIMARY KEY (id),
  CONSTRAINT correccion_de_lo_recibido_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT correccion_de_lo_recibido_numero_uk UNIQUE (empresa_id, recepcion_id, linea, numero),
  CONSTRAINT correccion_de_lo_recibido_clave_uk UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT correccion_de_lo_recibido_linea_fkey FOREIGN KEY (empresa_id, recepcion_id, linea) REFERENCES linea_de_recepcion (empresa_id, recepcion_id, numero),
  CONSTRAINT correccion_de_lo_recibido_movimiento_fkey FOREIGN KEY (movimiento_id, empresa_id) REFERENCES movimiento_de_stock (id, empresa_id),
  CONSTRAINT correccion_de_lo_recibido_cambia_ck CHECK (cantidad_nueva <> cantidad_anterior)
);

-- Cada corrección ajusta el saldo de la línea (lo recibido), sin dejar lo conciliado por encima, y solo si está bien armada.
CREATE FUNCTION correccion_de_lo_recibido_aplicar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_filas integer;
  v_ultimo integer;
  v_producto uuid;
  v_renglones integer;
  v_renglon record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.recepcion r
     WHERE r.id = NEW.recepcion_id AND r.empresa_id = NEW.empresa_id AND r.estado = 'CONFIRMADA' AND r.nivel = 'RECEPCION_SEPARADA'
  ) THEN
    RAISE EXCEPTION 'solo se corrige lo recibido de una recepción separada confirmada' USING ERRCODE = '23514', CONSTRAINT = 'correccion_de_lo_recibido_recepcion_ck';
  END IF;
  -- Serializa las correcciones de la línea (y las conciliaciones, que escriben el mismo saldo): lo que sigue ve lo ya confirmado.
  PERFORM 1 FROM public.saldo_de_linea_de_recepcion s
   WHERE s.empresa_id = NEW.empresa_id AND s.recepcion_id = NEW.recepcion_id AND s.numero = NEW.linea FOR UPDATE;
  -- Sin saltos: cada corrección es la siguiente de la cadena de su línea.
  SELECT coalesce(max(c.numero), 0) INTO v_ultimo FROM public.correccion_de_lo_recibido c
   WHERE c.empresa_id = NEW.empresa_id AND c.recepcion_id = NEW.recepcion_id AND c.linea = NEW.linea AND c.id <> NEW.id;
  IF NEW.numero <> v_ultimo + 1 THEN
    RAISE EXCEPTION 'la corrección no es la siguiente de la línea' USING ERRCODE = '23514', CONSTRAINT = 'correccion_de_lo_recibido_numero_seguido_ck';
  END IF;
  -- El movimiento de stock: de esta corrección, del sentido que dice el signo, con UN renglón del producto de la línea, en un depósito donde entró la línea y por la diferencia exacta.
  IF NOT EXISTS (
    SELECT 1 FROM public.movimiento_de_stock m
     WHERE m.id = NEW.movimiento_id AND m.empresa_id = NEW.empresa_id AND m.origen_tipo = 'CORRECCION_DE_RECEPCION' AND m.origen_id = NEW.id
       AND m.motivo = 'CORRECCION_DE_RECEPCION'
       AND m.clase = CASE WHEN NEW.cantidad_nueva > NEW.cantidad_anterior THEN 'ENTRADA' ELSE 'SALIDA' END
  ) THEN
    RAISE EXCEPTION 'la corrección necesita su movimiento de stock, con ella como origen' USING ERRCODE = '23514', CONSTRAINT = 'correccion_de_lo_recibido_movimiento_ck';
  END IF;
  SELECT l.producto_id INTO v_producto FROM public.linea_de_recepcion l
   WHERE l.empresa_id = NEW.empresa_id AND l.recepcion_id = NEW.recepcion_id AND l.numero = NEW.linea;
  SELECT count(*) INTO v_renglones FROM public.renglon_de_movimiento r WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = NEW.movimiento_id;
  SELECT r.cantidad, r.deposito_id, a.producto_id INTO v_renglon
    FROM public.renglon_de_movimiento r
    JOIN public.articulo_de_stock a ON a.id = r.articulo_id AND a.empresa_id = r.empresa_id
   WHERE r.empresa_id = NEW.empresa_id AND r.movimiento_id = NEW.movimiento_id
   LIMIT 1;
  IF v_renglones <> 1 OR v_renglon.producto_id IS DISTINCT FROM v_producto
     OR v_renglon.cantidad <> NEW.cantidad_nueva - NEW.cantidad_anterior
     OR NOT EXISTS (
       SELECT 1 FROM public.entrada_de_linea_de_recepcion e
        WHERE e.empresa_id = NEW.empresa_id AND e.recepcion_id = NEW.recepcion_id AND e.linea = NEW.linea AND e.deposito_id = v_renglon.deposito_id) THEN
    RAISE EXCEPTION 'el movimiento de la corrección no es la diferencia de esa línea en su depósito' USING ERRCODE = '23514', CONSTRAINT = 'correccion_de_lo_recibido_renglon_ck';
  END IF;
  UPDATE public.saldo_de_linea_de_recepcion s SET cantidad_recibida = NEW.cantidad_nueva
   WHERE s.empresa_id = NEW.empresa_id AND s.recepcion_id = NEW.recepcion_id AND s.numero = NEW.linea
     AND s.cantidad_recibida = NEW.cantidad_anterior AND s.cantidad_asignada <= NEW.cantidad_nueva;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'lo recibido ya cambió o quedaría por debajo de lo conciliado' USING ERRCODE = '23514', CONSTRAINT = 'correccion_excede_lo_conciliado';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER correccion_de_lo_recibido_aplicar AFTER INSERT ON correccion_de_lo_recibido FOR EACH ROW EXECUTE FUNCTION correccion_de_lo_recibido_aplicar();
CREATE TRIGGER correccion_de_lo_recibido_solo_insercion BEFORE UPDATE OR DELETE ON correccion_de_lo_recibido FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER correccion_de_lo_recibido_sin_truncate BEFORE TRUNCATE ON correccion_de_lo_recibido FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

REVOKE ALL ON correccion_de_lo_recibido FROM PUBLIC;
GRANT SELECT ON correccion_de_lo_recibido TO pedernal_app;
GRANT INSERT (id, empresa_id, recepcion_id, linea, numero, cantidad_anterior, cantidad_nueva, causa, nota, movimiento_id, clave_idempotencia, huella, registrado_por)
  ON correccion_de_lo_recibido TO pedernal_app;
-- El saldo de lo recibido solo lo cambia este disparador: el de guardia (`compras_saldo_solo_por_disparadores`) sigue rechazando cualquier UPDATE directo de la aplicación.
GRANT UPDATE (cantidad_recibida) ON saldo_de_linea_de_recepcion TO pedernal_app;

ALTER TABLE correccion_de_lo_recibido ENABLE ROW LEVEL SECURITY;
ALTER TABLE correccion_de_lo_recibido FORCE ROW LEVEL SECURITY;
CREATE POLICY correccion_de_lo_recibido_app_leer ON correccion_de_lo_recibido FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY correccion_de_lo_recibido_app_alta ON correccion_de_lo_recibido FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
