-- 0081_orden_y_destacado_de_la_carta (M-C de la especificación de familias, A8): el orden a mano de los renglones de una sección de la carta y la estrella (★), POR EMPRESA y sin
-- tope de estrellas (DDD 68 y 69). Un renglón es una familia agrupada o un producto suelto. Aditiva: dos columnas en `familia_de_producto` (tabla de 0079), dos en `seccion_de_carta`
-- y una tabla nueva para los productos sueltos. NO toca `producto` (su versión sube con cualquier UPDATE).
-- Especificación: familias-especificacion.md §3 CU-F8 y §4. Reversión: `reversiones/0081_revertir_orden_y_destacado_de_la_carta.sql`. DEPENDE de 0079 y 0043.
--
--  O1. `seccion_de_carta.orden_de_renglones`: 'ALFABETICO' (por defecto, como hoy) o 'A_MANO'. `version_del_orden`: la versión del ORDEN de la sección (control optimista de «reordenar»); la
--      aplicación la sube de a 1 junto con el cambio y un disparador impide cualquier otro salto. La fila de la sección se toma `FOR UPDATE`: dos reordenamientos a la vez se ponen en fila.
--  O2. `familia_de_producto.orden` y `.destacada`: el lugar y la estrella de una familia agrupada. `lugar_en_carta_de_producto`: lo mismo para un producto suelto (una fila por producto; sin fila =
--      no destacado y al final, alfabético). Un producto que es miembro de una familia no usa su fila: manda la familia (regla de la aplicación).
--  O3. `lugar_en_carta_de_producto` fija un ESTADO por producto: la clave primaria es `(empresa_id, producto_id)` y escribir es `INSERT … ON CONFLICT DO UPDATE`; repetir no cambia nada.

DO $$
BEGIN
  IF to_regclass('public.familia_de_producto') IS NULL OR to_regclass('public.seccion_de_carta') IS NULL OR to_regclass('public.carta_publica') IS NULL THEN
    RAISE EXCEPTION 'el orden y la estrella requieren 0079 y 0043 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.lugar_en_carta_de_producto') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'seccion_de_carta' AND column_name = 'orden_de_renglones') THEN
    RAISE EXCEPTION 'el orden y la estrella nacen en 0081: ya existe algo suyo (alguien lo creó a mano); hay que revisarlo antes de migrar' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE seccion_de_carta
  ADD COLUMN orden_de_renglones text NOT NULL DEFAULT 'ALFABETICO' CONSTRAINT seccion_orden_de_renglones_ck CHECK (orden_de_renglones IN ('ALFABETICO', 'A_MANO')),
  ADD COLUMN version_del_orden integer NOT NULL DEFAULT 1 CONSTRAINT seccion_version_del_orden_ck CHECK (version_del_orden >= 1);

ALTER TABLE familia_de_producto
  ADD COLUMN orden integer NOT NULL DEFAULT 0 CONSTRAINT familia_orden_ck CHECK (orden BETWEEN 0 AND 100000),
  ADD COLUMN destacada boolean NOT NULL DEFAULT false;

CREATE TABLE lugar_en_carta_de_producto (
  empresa_id      uuid NOT NULL REFERENCES empresa (id),
  producto_id     uuid NOT NULL,
  orden           integer NOT NULL DEFAULT 0 CONSTRAINT lugar_orden_ck CHECK (orden BETWEEN 0 AND 100000),
  destacado       boolean NOT NULL DEFAULT false,
  actualizado_por uuid REFERENCES persona (id),
  actualizado_en  timestamptz NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT lugar_en_carta_pk PRIMARY KEY (empresa_id, producto_id),
  CONSTRAINT lugar_producto_fkey FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id)
);

CREATE FUNCTION seccion_de_carta_orden_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.version_del_orden IS DISTINCT FROM OLD.version_del_orden AND NEW.version_del_orden <> OLD.version_del_orden + 1 THEN
    RAISE EXCEPTION 'la versión del orden de una sección sube de a uno'
      USING ERRCODE = '23514', CONSTRAINT = 'seccion_version_del_orden_salto';
  END IF;
  RETURN NEW;
END
$$;
-- Nombre elegido para correr junto a los de 0025 (`_version` sube la versión general de la sección).
CREATE TRIGGER seccion_de_carta_orden BEFORE UPDATE ON seccion_de_carta
  FOR EACH ROW EXECUTE FUNCTION seccion_de_carta_orden_validar();

CREATE FUNCTION lugar_en_carta_de_producto_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.producto_id IS DISTINCT FROM OLD.producto_id THEN
    RAISE EXCEPTION 'el producto de un lugar en la carta no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'lugar_identidad_inmutable';
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;
CREATE TRIGGER lugar_en_carta_de_producto_cambio BEFORE UPDATE ON lugar_en_carta_de_producto
  FOR EACH ROW EXECUTE FUNCTION lugar_en_carta_de_producto_validar();
CREATE TRIGGER lugar_en_carta_de_producto_sin_borrado BEFORE DELETE ON lugar_en_carta_de_producto
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER lugar_en_carta_de_producto_sin_truncate BEFORE TRUNCATE ON lugar_en_carta_de_producto
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

REVOKE ALL ON lugar_en_carta_de_producto FROM PUBLIC;
GRANT SELECT ON lugar_en_carta_de_producto TO pedernal_app;
GRANT INSERT (empresa_id, producto_id, orden, destacado, actualizado_por, actualizado_en) ON lugar_en_carta_de_producto TO pedernal_app;
GRANT UPDATE (orden, destacado, actualizado_por, actualizado_en) ON lugar_en_carta_de_producto TO pedernal_app;
GRANT UPDATE (orden_de_renglones, version_del_orden) ON seccion_de_carta TO pedernal_app;
GRANT UPDATE (orden, destacada) ON familia_de_producto TO pedernal_app;
GRANT INSERT (orden, destacada) ON familia_de_producto TO pedernal_app;

-- Lectura pública (solo columnas): el orden y la estrella de la carta en línea con ese código.
GRANT SELECT (orden_de_renglones) ON seccion_de_carta TO pedernal_publico;
GRANT SELECT (orden, destacada) ON familia_de_producto TO pedernal_publico;
GRANT SELECT (empresa_id, producto_id, orden, destacado) ON lugar_en_carta_de_producto TO pedernal_publico;

ALTER TABLE lugar_en_carta_de_producto ENABLE ROW LEVEL SECURITY;
ALTER TABLE lugar_en_carta_de_producto FORCE ROW LEVEL SECURITY;
CREATE POLICY lugar_en_carta_de_producto_app_leer ON lugar_en_carta_de_producto FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY lugar_en_carta_de_producto_app_alta ON lugar_en_carta_de_producto FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND actualizado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY lugar_en_carta_de_producto_app_cambiar ON lugar_en_carta_de_producto FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND actualizado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
CREATE POLICY lugar_en_carta_de_producto_publico_leer ON lugar_en_carta_de_producto FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.estado = 'EN_LINEA' AND c.empresa_id = lugar_en_carta_de_producto.empresa_id
  ));
