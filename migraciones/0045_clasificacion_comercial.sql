-- 0045_clasificacion_comercial: el árbol de clasificación comercial de la empresa (departamento → categoría → niveles inferiores), tramo T-A de A2b.
-- Ficha de concepto: Pedernal-docs/11-especificaciones/conceptos/clasificacion-comercial-y-seccion-de-la-carta.md §2; plan aprobado por el dueño el 12/11/2026
-- («Plan de clasificación comercial aprobado», decisiones-del-dueno-2026-11.md); maqueta aprobada `clasificacion.html` (carpeta de prototipos de Pedernal-docs, 10-ux-ui); decisiones 2, 8, 9, 33
-- y 60 de catalogo-y-niveles-maqueta.md. SOLO la tabla de nodos: el vínculo del producto con vigencia (0046) y la copia del camino al renglón de venta (0047) son
-- tramos siguientes, cada uno con su migración.
--
-- Qué es: un nodo tiene UN solo padre (una sola columna) y UNA sola empresa (clave foránea compuesta); el primer nivel (padre nulo) es el departamento. Es común a la
-- empresa (no tiene sucursal). NO hereda la alícuota (decisión 33). No se borra: se desactiva (decisión del plan). El orden es alfabético (supuesto S4 de la maqueta), por
-- eso no hay columna de orden.
--
-- Reglas que la base hace cumplir (la regla de negocio vive en `src/primitivas/clasificacion/arbol.ts`; esto es la defensa en profundidad, y una prueba compara el tope):
--  * Sin ciclos. Un nodo no puede quedar debajo de sí mismo ni de uno de sus descendientes.
--  * Tope de niveles: `tope_de_niveles_de_clasificacion()` (4), fijado UNA vez por la plataforma y nunca reducible (reducirlo dejaría árboles que ya no cumplen). Un
--    movimiento cuenta el nivel del nuevo padre MÁS la altura de todo el subárbol que se mueve.
--  * Un departamento no se mueve y ningún nodo pasa a primer nivel (supuesto S3 de la maqueta).
--  * No se pone un nodo bajo uno desactivado, no se reactiva uno cuyo padre está desactivado y no se desactiva uno con hijos activos (supuesto S6 y «Primero desactivá
--    lo que tiene adentro.», aprobado el 12/11/2026).
--  * Toda escritura del árbol de una empresa toma el mismo candado de la transacción (`pg_advisory_xact_lock` sobre la empresa): dos movimientos a la vez, que cada uno
--    por separado serían válidos y juntos harían un ciclo, se serializan. El caso de uso toma el mismo candado antes de leer (ver T-B).
--
-- Reglas de esta migración (las mismas de 0025): sin funciones SECURITY DEFINER (todas fijan `search_path` y califican con `public.`); nadie recibe DELETE ni TRUNCATE
-- (los disparadores los frenan aun al dueño); RLS activa y forzada, una política por comando; INSERT y UPDATE por columna; toda única incluye `empresa_id` y la clave
-- foránea es compuesta; los textos con la lista de permitidos `texto_de_catalogo_valido`. Solo la aplicación (`pedernal_app`) recibe algo.
-- Su reversión es un script aparte: `migraciones/reversiones/0045_revertir_clasificacion_comercial.sql` (DESTRUCTIVA si hay nodos). DEPENDE de 0001 y de 0025.

DO $$
BEGIN
  IF to_regclass('public.seccion_de_carta') IS NULL OR to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL
     OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL OR to_regprocedure('public.sin_borrado()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL THEN
    RAISE EXCEPTION 'la clasificación comercial requiere 0025_catalogo aplicada antes (faltan sus funciones base)' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.nodo_de_clasificacion') IS NOT NULL THEN
    RAISE EXCEPTION 'la clasificación comercial nace en 0045: la tabla nodo_de_clasificacion ya existe (alguien la creó a mano); hay que revisarla antes de migrar'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- El tope de niveles, en UN solo lugar de la base. Una prueba lo compara con `MAXIMO_DE_NIVELES_DE_CLASIFICACION` de la primitiva.
CREATE FUNCTION tope_de_niveles_de_clasificacion() RETURNS integer LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT 4 $$;
REVOKE ALL ON FUNCTION tope_de_niveles_de_clasificacion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tope_de_niveles_de_clasificacion() TO pedernal_app;

CREATE TABLE nodo_de_clasificacion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la idempotencia del alta
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  padre_id       uuid,                                          -- nulo = departamento (primer nivel)
  nombre         text NOT NULL CONSTRAINT nodo_de_clasificacion_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 80)),
  nombre_clave   text NOT NULL CONSTRAINT nodo_de_clasificacion_nombre_clave_ck CHECK (char_length(nombre_clave) BETWEEN 1 AND 240),
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT nodo_de_clasificacion_id_empresa_uk UNIQUE (id, empresa_id),
  -- Un mismo nombre no se repite entre hermanos (también entre departamentos: `NULLS NOT DISTINCT` cuenta el padre nulo como un valor).
  CONSTRAINT nodo_de_clasificacion_nombre_uk UNIQUE NULLS NOT DISTINCT (empresa_id, padre_id, nombre_clave),
  CONSTRAINT nodo_de_clasificacion_padre_fkey FOREIGN KEY (padre_id, empresa_id) REFERENCES nodo_de_clasificacion (id, empresa_id),
  CONSTRAINT nodo_de_clasificacion_padre_distinto_ck CHECK (padre_id IS DISTINCT FROM id)
);
CREATE INDEX nodo_de_clasificacion_padre_ix ON nodo_de_clasificacion (empresa_id, padre_id);

-- ---------------------------------------------------------------------------------------------
-- Validación del árbol (defensa en profundidad; la regla vive en la primitiva). Toma el candado de la empresa ANTES de leer.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION nodo_de_clasificacion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_tope integer := public.tope_de_niveles_de_clasificacion();
  v_nivel_del_padre integer;
  v_hay_ciclo boolean;
  v_altura integer;
  v_cambia_el_padre boolean;
  v_padre_activo boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('clasificacion:' || NEW.empresa_id::text, 0));

  IF TG_OP = 'UPDATE' THEN
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
      RAISE EXCEPTION 'un nodo no cambia de empresa'
        USING ERRCODE = '23514', CONSTRAINT = 'nodo_de_clasificacion_inmutable';
    END IF;
    v_cambia_el_padre := NEW.padre_id IS DISTINCT FROM OLD.padre_id;
    IF v_cambia_el_padre AND (OLD.padre_id IS NULL OR NEW.padre_id IS NULL) THEN
      RAISE EXCEPTION 'un departamento no se mueve y ningún nodo pasa a primer nivel'
        USING ERRCODE = '23514', CONSTRAINT = 'nodo_de_clasificacion_raiz_fija';
    END IF;
    IF NEW.activo IS DISTINCT FROM OLD.activo THEN
      IF NEW.activo THEN
        IF NEW.padre_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.nodo_de_clasificacion p WHERE p.id = NEW.padre_id AND p.empresa_id = NEW.empresa_id AND p.activo
        ) THEN
          RAISE EXCEPTION 'no se reactiva un nodo cuyo padre está desactivado'
            USING ERRCODE = '23514', CONSTRAINT = 'nodo_de_clasificacion_padre_desactivado';
        END IF;
      ELSIF EXISTS (
        SELECT 1 FROM public.nodo_de_clasificacion h WHERE h.padre_id = NEW.id AND h.empresa_id = NEW.empresa_id AND h.activo
      ) THEN
        RAISE EXCEPTION 'no se desactiva un nodo con hijos activos'
          USING ERRCODE = '23514', CONSTRAINT = 'nodo_de_clasificacion_hijos_activos';
      END IF;
    END IF;
  ELSE
    v_cambia_el_padre := true;
  END IF;

  IF v_cambia_el_padre AND NEW.padre_id IS NOT NULL THEN
    SELECT p.activo INTO v_padre_activo FROM public.nodo_de_clasificacion p WHERE p.id = NEW.padre_id AND p.empresa_id = NEW.empresa_id;
    IF NOT FOUND THEN
      -- El disparador corre antes que la clave foránea: el mismo error que daría ella (el padre no existe en esta empresa).
      RAISE EXCEPTION 'el padre no existe en la empresa del nodo'
        USING ERRCODE = '23503', CONSTRAINT = 'nodo_de_clasificacion_padre_fkey';
    END IF;
    IF NOT v_padre_activo THEN
      RAISE EXCEPTION 'no se pone un nodo bajo uno desactivado'
        USING ERRCODE = '23514', CONSTRAINT = 'nodo_de_clasificacion_padre_desactivado';
    END IF;
    -- Nivel del nuevo padre y ciclo: se sube por los padres hasta la raíz (el recorrido se corta una vuelta después del tope por si el árbol ya estuviera dañado).
    WITH RECURSIVE ancestros(id, padre_id, nivel) AS (
      SELECT n.id, n.padre_id, 1 FROM public.nodo_de_clasificacion n WHERE n.id = NEW.padre_id AND n.empresa_id = NEW.empresa_id
      UNION ALL
      SELECT n.id, n.padre_id, a.nivel + 1 FROM public.nodo_de_clasificacion n
        JOIN ancestros a ON n.id = a.padre_id AND n.empresa_id = NEW.empresa_id
       WHERE a.nivel <= v_tope
    )
    SELECT max(nivel), coalesce(bool_or(id = NEW.id), false) INTO v_nivel_del_padre, v_hay_ciclo FROM ancestros;
    IF v_hay_ciclo THEN
      RAISE EXCEPTION 'un nodo no puede quedar debajo de sí mismo ni de uno de sus descendientes'
        USING ERRCODE = '23514', CONSTRAINT = 'nodo_de_clasificacion_ciclo';
    END IF;
    -- Altura de lo que se mueve (1 = el nodo solo): un alta es un nodo solo.
    IF TG_OP = 'UPDATE' THEN
      WITH RECURSIVE bajo(id, nivel) AS (
        SELECT NEW.id, 1
        UNION ALL
        SELECT n.id, b.nivel + 1 FROM public.nodo_de_clasificacion n
          JOIN bajo b ON n.padre_id = b.id AND n.empresa_id = NEW.empresa_id
         WHERE b.nivel <= v_tope
      )
      SELECT max(nivel) INTO v_altura FROM bajo;
    ELSE
      v_altura := 1;
    END IF;
    IF v_nivel_del_padre + v_altura > v_tope THEN
      RAISE EXCEPTION 'el árbol no puede pasar de % niveles', v_tope
        USING ERRCODE = '23514', CONSTRAINT = 'nodo_de_clasificacion_tope';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER nodo_de_clasificacion_validar BEFORE INSERT OR UPDATE ON nodo_de_clasificacion
  FOR EACH ROW EXECUTE FUNCTION nodo_de_clasificacion_validar();
CREATE TRIGGER nodo_de_clasificacion_version BEFORE UPDATE ON nodo_de_clasificacion
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
-- Un nodo no se borra ni se vacía (ni el dueño de la base): se desactiva.
CREATE TRIGGER nodo_de_clasificacion_sin_borrado BEFORE DELETE ON nodo_de_clasificacion
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER nodo_de_clasificacion_sin_truncate BEFORE TRUNCATE ON nodo_de_clasificacion
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- ---------------------------------------------------------------------------------------------
-- Privilegios por columna (nadie recibe DELETE ni TRUNCATE) y RLS activa y forzada, una política por comando.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON nodo_de_clasificacion FROM PUBLIC;
GRANT SELECT ON nodo_de_clasificacion TO pedernal_app;
GRANT INSERT (id, empresa_id, padre_id, nombre, nombre_clave) ON nodo_de_clasificacion TO pedernal_app;
GRANT UPDATE (padre_id, nombre, nombre_clave, activo) ON nodo_de_clasificacion TO pedernal_app;

ALTER TABLE nodo_de_clasificacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodo_de_clasificacion FORCE ROW LEVEL SECURITY;

CREATE POLICY nodo_de_clasificacion_app_leer ON nodo_de_clasificacion FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY nodo_de_clasificacion_app_alta ON nodo_de_clasificacion FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY nodo_de_clasificacion_app_cambiar ON nodo_de_clasificacion FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
