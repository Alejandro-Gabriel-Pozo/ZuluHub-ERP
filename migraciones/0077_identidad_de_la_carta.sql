-- 0077_identidad_de_la_carta (PROPUESTA, sin aplicar): modelo, cara, color propio y logo propio de cada carta de sucursal, y el color de la empresa para sus cartas.
-- ADITIVA: columnas nuevas que admiten vacío (salvo `modelo`, con valor fijo 'LISTA'), una tabla nueva y dos funciones de validación. No toca ninguna fila existente.
-- Reversión: migraciones/reversiones/0077_revertir_identidad_de_la_carta.sql (FRENA si hay datos de identidad cargados).
-- DEPENDE de 0001, 0043 y 0044; se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.carta_publica') IS NULL OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL
     OR to_regprocedure('public.sin_borrado()') IS NULL OR to_regprocedure('public.empresa_operable(uuid)') IS NULL
     OR to_regprocedure('public.app_persona_id()') IS NULL THEN
    RAISE EXCEPTION 'la identidad de la carta requiere 0001 y 0043 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'empresa' AND policyname = 'empresa_publico_de_carta') THEN
    RAISE EXCEPTION 'la identidad de la carta requiere 0044_lectura_publica_de_carta aplicada antes' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_publico') THEN
    RAISE EXCEPTION 'la identidad de la carta requiere el rol pedernal_publico (0007)' USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Funciones de validación (la copia en la base de reglas que viven UNA vez en TypeScript; una prueba espejo las compara).
-- ---------------------------------------------------------------------------------------------
-- Color: `#rrggbb` en minúsculas (copia de COLOR_DEL_TEMA, src/modulos/marcas/dominio/tema.ts). El CONTRASTE no se mide acá: lo aplica el código una sola vez.
CREATE OR REPLACE FUNCTION color_de_carta_valido(t text) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT t IS NOT NULL AND t ~ '^#[0-9a-f]{6}$' $$;

-- Imagen por dirección externa: se guardan las PARTES, las cinco juntas o ninguna. Copia de direccion-externa.ts y proveedores-de-imagen.ts
-- (proveedor de la lista cerrada, cuenta hasta 64, id hasta 200 con tramos separados por «/», versión de 1 a 12 dígitos sin cero inicial, extensiones permitidas).
CREATE OR REPLACE FUNCTION imagen_externa_valida(p_proveedor text, p_cuenta text, p_id_publico text, p_version text, p_extension text)
  RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN p_proveedor IS NULL AND p_cuenta IS NULL AND p_id_publico IS NULL AND p_version IS NULL AND p_extension IS NULL THEN true
    WHEN p_proveedor IS NULL OR p_cuenta IS NULL OR p_id_publico IS NULL OR p_version IS NULL OR p_extension IS NULL THEN false
    ELSE p_proveedor IN ('CLOUDINARY')
      AND p_cuenta ~ '^[a-z0-9_-]{1,64}$'
      AND char_length(p_id_publico) BETWEEN 1 AND 200
      AND p_id_publico ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$'
      AND p_version ~ '^[1-9][0-9]{0,11}$'
      AND p_extension IN ('jpg', 'jpeg', 'png', 'webp')
  END
$$;

GRANT EXECUTE ON FUNCTION color_de_carta_valido(text) TO pedernal_app;
GRANT EXECUTE ON FUNCTION imagen_externa_valida(text, text, text, text, text) TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- Identidad por sucursal: columnas nuevas de `carta_publica`. Vacío = «usa lo de la empresa» (herencia por grupo, CYN 105).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE carta_publica
  ADD COLUMN IF NOT EXISTS modelo text NOT NULL DEFAULT 'LISTA'
    CONSTRAINT carta_publica_modelo_ck CHECK (modelo IN ('LISTA', 'CUADRICULA', 'LIBRO')),
  ADD COLUMN IF NOT EXISTS cara text
    CONSTRAINT carta_publica_cara_ck CHECK (cara IS NULL OR cara IN ('DIA', 'BOLICHE', 'NOCHE')),
  ADD COLUMN IF NOT EXISTS color_propio text
    CONSTRAINT carta_publica_color_ck CHECK (color_propio IS NULL OR color_de_carta_valido(color_propio)),
  ADD COLUMN IF NOT EXISTS logo_proveedor text,
  ADD COLUMN IF NOT EXISTS logo_cuenta text,
  ADD COLUMN IF NOT EXISTS logo_id_publico text,
  ADD COLUMN IF NOT EXISTS logo_version text,
  ADD COLUMN IF NOT EXISTS logo_extension text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carta_publica_logo_ck' AND conrelid = 'public.carta_publica'::regclass) THEN
    ALTER TABLE carta_publica ADD CONSTRAINT carta_publica_logo_ck
      CHECK (imagen_externa_valida(logo_proveedor, logo_cuenta, logo_id_publico, logo_version, logo_extension));
  END IF;
END
$$;

-- La aplicación escribe las columnas nuevas (los GRANT por columna se SUMAN a los de 0043).
GRANT INSERT (modelo, cara, color_propio, logo_proveedor, logo_cuenta, logo_id_publico, logo_version, logo_extension) ON carta_publica TO pedernal_app;
GRANT UPDATE (modelo, cara, color_propio, logo_proveedor, logo_cuenta, logo_id_publico, logo_version, logo_extension) ON carta_publica TO pedernal_app;
-- El rol público lee lo que la carta muestra de sí misma. La política de 0043 (solo `codigo` = `app.codigo_de_carta` y EN_LINEA) no cambia.
GRANT SELECT (modelo, cara, color_propio, logo_proveedor, logo_cuenta, logo_id_publico, logo_version, logo_extension) ON carta_publica TO pedernal_publico;

-- ---------------------------------------------------------------------------------------------
-- Color de la empresa para sus cartas: una fila por empresa (la herencia «Usar lo de la empresa» del grupo «Colores»).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identidad_de_carta_empresa (
  empresa_id      uuid PRIMARY KEY REFERENCES empresa (id),
  color_principal text CONSTRAINT identidad_de_carta_empresa_color_ck CHECK (color_principal IS NULL OR color_de_carta_valido(color_principal)),
  creado_por      uuid REFERENCES persona (id),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION identidad_de_carta_empresa_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'la empresa de una identidad no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'identidad_de_carta_empresa_identidad_inmutable';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS identidad_de_carta_empresa_cambio ON identidad_de_carta_empresa;
CREATE TRIGGER identidad_de_carta_empresa_cambio BEFORE UPDATE ON identidad_de_carta_empresa
  FOR EACH ROW EXECUTE FUNCTION identidad_de_carta_empresa_validar();
DROP TRIGGER IF EXISTS identidad_de_carta_empresa_version ON identidad_de_carta_empresa;
CREATE TRIGGER identidad_de_carta_empresa_version BEFORE UPDATE ON identidad_de_carta_empresa
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
DROP TRIGGER IF EXISTS identidad_de_carta_empresa_sin_borrado ON identidad_de_carta_empresa;
CREATE TRIGGER identidad_de_carta_empresa_sin_borrado BEFORE DELETE ON identidad_de_carta_empresa
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
DROP TRIGGER IF EXISTS identidad_de_carta_empresa_sin_truncate ON identidad_de_carta_empresa;
CREATE TRIGGER identidad_de_carta_empresa_sin_truncate BEFORE TRUNCATE ON identidad_de_carta_empresa
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

REVOKE ALL ON identidad_de_carta_empresa FROM PUBLIC;
GRANT SELECT ON identidad_de_carta_empresa TO pedernal_app;
GRANT INSERT (empresa_id, color_principal, creado_por) ON identidad_de_carta_empresa TO pedernal_app;
GRANT UPDATE (color_principal) ON identidad_de_carta_empresa TO pedernal_app;
-- Público: solo el color (y la empresa, que la política necesita). Ni quién lo creó ni cuándo ni la versión.
GRANT SELECT (empresa_id, color_principal) ON identidad_de_carta_empresa TO pedernal_publico;

ALTER TABLE identidad_de_carta_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE identidad_de_carta_empresa FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS identidad_de_carta_empresa_app_leer ON identidad_de_carta_empresa;
CREATE POLICY identidad_de_carta_empresa_app_leer ON identidad_de_carta_empresa FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
DROP POLICY IF EXISTS identidad_de_carta_empresa_app_alta ON identidad_de_carta_empresa;
CREATE POLICY identidad_de_carta_empresa_app_alta ON identidad_de_carta_empresa FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id)
    AND creado_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
DROP POLICY IF EXISTS identidad_de_carta_empresa_app_cambiar ON identidad_de_carta_empresa;
CREATE POLICY identidad_de_carta_empresa_app_cambiar ON identidad_de_carta_empresa FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

-- Público: solo la fila de la empresa de la carta pedida (y solo si la carta está EN_LINEA: la subconsulta pasa por la política de `carta_publica`).
DROP POLICY IF EXISTS identidad_de_carta_empresa_publico_de_carta ON identidad_de_carta_empresa;
CREATE POLICY identidad_de_carta_empresa_publico_de_carta ON identidad_de_carta_empresa FOR SELECT TO pedernal_publico
  USING (EXISTS (
    SELECT 1 FROM public.carta_publica c
     WHERE c.codigo = current_setting('app.codigo_de_carta', true) AND c.empresa_id = identidad_de_carta_empresa.empresa_id
  ));
