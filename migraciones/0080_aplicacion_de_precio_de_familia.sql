-- 0080_aplicacion_de_precio_de_familia (M-B de la especificación de familias, A8): el registro de cada «Aplicar el precio por medida a toda la familia». Una fila = una aplicación
-- hecha; su `id` lo manda la aplicación y es la CLAVE DE IDEMPOTENCIA de la acción (como `copia_de_opciones`): repetir el mismo `id` con el mismo pedido (misma huella) devuelve lo ya
-- guardado sin escribir precios; el mismo `id` con otro pedido es `ID_REUTILIZADO`. Aditiva: una tabla nueva; los precios siguen siendo filas de `precio_de_venta` (no se tocan).
-- Especificación: familias-especificacion.md §3 CU-F6 y §7. Decisiones del dueño: MIG §12.23 y §12.24 (sin vínculo permanente).
--
-- Reglas: las de 0079. Solo se inserta: no hay UPDATE (disparador, aun al dueño), DELETE ni TRUNCATE. Reversión: `reversiones/0080_revertir_aplicacion_de_precio_de_familia.sql`.
-- DEPENDE de 0079.
--  A1. `huella` = SHA-256 en hex de lo pedido (familia, productos, precios y `precioIdEsperado`), calculada por la aplicación: la base solo exige la forma de 64 hex.
--  A2. `precios_escritos` y `precios_sin_cambio` son lo que pasó en esa aplicación (los precios que ya valían lo mismo no se escriben).

DO $$
BEGIN
  IF to_regclass('public.familia_de_producto') IS NULL OR to_regclass('public.persona') IS NULL THEN
    RAISE EXCEPTION 'la aplicación de precio de familia requiere 0079 aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.aplicacion_de_precio_de_familia') IS NOT NULL THEN
    RAISE EXCEPTION 'la aplicación de precio de familia nace en 0080: la tabla ya existe; hay que revisarla antes de migrar' USING ERRCODE = '55000';
  END IF;
END
$$;

CREATE TABLE aplicacion_de_precio_de_familia (
  id                 uuid PRIMARY KEY,   -- lo manda la app: es la clave de idempotencia
  empresa_id         uuid NOT NULL REFERENCES empresa (id),
  familia_id         uuid NOT NULL,
  huella             text NOT NULL CONSTRAINT aplicacion_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  precios_escritos   integer NOT NULL CONSTRAINT aplicacion_escritos_ck CHECK (precios_escritos BETWEEN 0 AND 1000),
  precios_sin_cambio integer NOT NULL CONSTRAINT aplicacion_sin_cambio_ck CHECK (precios_sin_cambio BETWEEN 0 AND 1000),
  aplicada_por       uuid REFERENCES persona (id),
  aplicada_en        timestamptz NOT NULL,
  CONSTRAINT aplicacion_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT aplicacion_familia_fkey FOREIGN KEY (familia_id, empresa_id) REFERENCES familia_de_producto (id, empresa_id)
);
CREATE INDEX aplicacion_de_precio_de_familia_ix ON aplicacion_de_precio_de_familia (empresa_id, familia_id, aplicada_en);

CREATE FUNCTION aplicacion_de_precio_de_familia_inmutable() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION 'una aplicación de precio ya hecha no se cambia: queda como registro'
    USING ERRCODE = '23514', CONSTRAINT = 'aplicacion_inmutable';
END
$$;

CREATE TRIGGER aplicacion_de_precio_de_familia_cambio BEFORE UPDATE ON aplicacion_de_precio_de_familia
  FOR EACH ROW EXECUTE FUNCTION aplicacion_de_precio_de_familia_inmutable();
CREATE TRIGGER aplicacion_de_precio_de_familia_sin_borrado BEFORE DELETE ON aplicacion_de_precio_de_familia
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER aplicacion_de_precio_de_familia_sin_truncate BEFORE TRUNCATE ON aplicacion_de_precio_de_familia
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

REVOKE ALL ON aplicacion_de_precio_de_familia FROM PUBLIC;
GRANT SELECT ON aplicacion_de_precio_de_familia TO pedernal_app;
GRANT INSERT (id, empresa_id, familia_id, huella, precios_escritos, precios_sin_cambio, aplicada_por, aplicada_en) ON aplicacion_de_precio_de_familia TO pedernal_app;

ALTER TABLE aplicacion_de_precio_de_familia ENABLE ROW LEVEL SECURITY;
ALTER TABLE aplicacion_de_precio_de_familia FORCE ROW LEVEL SECURITY;
CREATE POLICY aplicacion_de_precio_de_familia_app_leer ON aplicacion_de_precio_de_familia FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY aplicacion_de_precio_de_familia_app_alta ON aplicacion_de_precio_de_familia FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND aplicada_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
