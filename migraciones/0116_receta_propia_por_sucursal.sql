-- 0116_receta_propia_por_sucursal: la receta puede ser de la CENTRAL (la de la empresa, como hasta hoy) o PROPIA de una sucursal. Tramo T1 de «receta propia por sucursal».
-- Diseño: Pedernal-docs/11-especificaciones/receta-propia-por-sucursal-diseno.md §1 (decisión 74 del dueño, 08/11/2026; aprobada para construir el 27/11/2026).
-- NÚMERO PROVISIONAL: lo confirma el orquestador al abrir el PR (la 0115 la usa el PR #666 de caja; la 0114 no figura en ninguna rama a la fecha de esta revisión).
--
-- QUÉ CAMBIA (aditivo; el código de antes sigue funcionando sin tocarse):
--   1. `composicion.sucursal_id` (nula) y `composicion.origen_numero` (nula). Nula = receta de la central: TODO lo que hay hoy. Una propia lleva su sucursal y el número de la versión de la
--      central que la persona vio al crearla o guardarla (de ahí sale el aviso «la central cambió», que se calcula; no se escribe). `(sucursal_id IS NULL) = (origen_numero IS NULL)`.
--   2. La única `composicion_numero_uk` pasa de (empresa, producto, numero) a (empresa, producto, sucursal, numero) con NULLS NOT DISTINCT: cada ámbito numera la suya desde 1. Mismo nombre
--      (la traducción de errores del código lo usa); para las filas de hoy (todas con sucursal nula) la regla es la misma.
--   3. `composicion_vigente_id(empresa, producto, sucursal)`: la receta que rige para una sucursal (su propia vigente y NO vacía; si no, la última de la central). Una sola regla, un lugar. `pedernal_app` puede EJECUTARLA
--      (la llama el disparador de ciclos con el rol de la aplicación; el repo quita ese permiso por defecto).
--   4. Tres funciones de disparador se reescriben con el ámbito (mismos nombres y mismos disparadores: CREATE OR REPLACE):
--      * composicion_validar: el número es el siguiente al último DEL ÁMBITO; una propia nace de una versión de la central que existe.
--      * articulo_de_stock_validar: un artículo en la composición vigente de CUALQUIER ámbito no se puede apagar.
--      * composicion_sin_ciclos: un grafo por ámbito (la propia, en el de su sucursal; la central, en el suyo y en el de cada sucursal con propias).
--
-- QUÉ NO CAMBIA, a propósito:
--   * Ninguna fila se toca ni se rellena: las recetas de hoy quedan con sucursal nula. Ventas, órdenes y movimientos ya sellados siguen apuntando a su versión.
--   * NO se da permiso de escritura sobre las columnas nuevas a `pedernal_app` (el permiso de `composicion` es por columna): hasta el tramo que crea propias (T4, con su propio permiso),
--     ningún camino de la aplicación puede escribir una propia. Todo nace cerrado. Las pruebas y el dueño de la base sí pueden.
--   * El código de lectura NO se cambia acá: hasta que el tramo T2 haga que toda lectura filtre la central, no debe existir ninguna propia en una base real.
--
-- Compatibilidad: con el código anterior y esta base todo anda igual (escribe sucursal nula; sus lecturas toman «la última versión» y no hay ninguna propia).
-- Reversión: `migraciones/reversiones/0116_revertir_receta_propia_por_sucursal.sql`. FRENA (55000) si hay alguna propia (la tabla es de solo inserción: no se las puede borrar, y el historial de
-- recetas no se borra sin decisión del dueño). Sin propias no pierde datos.
-- DEPENDE de 0001 (sucursal y su única `sucursal_id_empresa_uk`), 0030 (composición) y 0032 (las tres funciones y los pasos); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.composicion') IS NULL OR to_regclass('public.componente_de_composicion') IS NULL OR to_regclass('public.sucursal') IS NULL
     OR to_regprocedure('public.composicion_sin_ciclos()') IS NULL OR to_regprocedure('public.articulo_de_stock_validar()') IS NULL
     OR to_regprocedure('public.composicion_validar()') IS NULL THEN
    RAISE EXCEPTION 'la receta propia por sucursal requiere 0001, 0030 y 0032 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'composicion' AND column_name IN ('sucursal_id', 'origen_numero')) THEN
    RAISE EXCEPTION '0116 ya está aplicada (composicion.sucursal_id u origen_numero existen): hay que revisarlo antes de migrar' USING ERRCODE = '55000';
  END IF;
END
$$;

-- 1. Las dos columnas, nulas (agregar una columna nula no reescribe la tabla ni dispara `composicion_solo_insercion`).
ALTER TABLE composicion ADD COLUMN sucursal_id uuid;
ALTER TABLE composicion ADD COLUMN origen_numero integer;
ALTER TABLE composicion ADD CONSTRAINT composicion_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id);
ALTER TABLE composicion ADD CONSTRAINT composicion_origen_ck
  CHECK ((sucursal_id IS NULL) = (origen_numero IS NULL) AND (origen_numero IS NULL OR origen_numero > 0));

-- 2. La única, con el ámbito. Misma transacción que el resto: nunca hay un instante sin única.
ALTER TABLE composicion DROP CONSTRAINT composicion_numero_uk;
ALTER TABLE composicion ADD CONSTRAINT composicion_numero_uk UNIQUE NULLS NOT DISTINCT (empresa_id, producto_id, sucursal_id, numero);

-- 3. La receta que rige para una sucursal: su propia vigente y no vacía (una versión propia vacía es «volver a la central»); si no, la última de la central. Con sucursal nula, la de la central.
CREATE FUNCTION composicion_vigente_id(p_empresa uuid, p_producto uuid, p_sucursal uuid) RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT coalesce(
    (SELECT p.id FROM public.composicion p
      WHERE p_sucursal IS NOT NULL AND p.empresa_id = p_empresa AND p.producto_id = p_producto AND p.sucursal_id = p_sucursal
        AND p.numero = (SELECT max(q.numero) FROM public.composicion q
                         WHERE q.empresa_id = p_empresa AND q.producto_id = p_producto AND q.sucursal_id = p_sucursal)
        AND EXISTS (SELECT 1 FROM public.componente_de_composicion k WHERE k.empresa_id = p.empresa_id AND k.composicion_id = p.id)),
    (SELECT c.id FROM public.composicion c
      WHERE c.empresa_id = p_empresa AND c.producto_id = p_producto AND c.sucursal_id IS NULL
      ORDER BY c.numero DESC LIMIT 1))
$$;

-- El repo quita el permiso de ejecutar funciones a todos por defecto (0001): la llama el disparador de ciclos y corre con el rol de la aplicación, así que se lo damos (solo ejecutar; no escribe nada).
GRANT EXECUTE ON FUNCTION composicion_vigente_id(uuid, uuid, uuid) TO pedernal_app;

-- 4. Las tres funciones, con el ámbito.

CREATE OR REPLACE FUNCTION composicion_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
  v_anterior integer;
  v_central integer;
BEGIN
  NEW.registrada_en := now();
  SELECT p.clase_de_uso INTO v_clase FROM public.producto p WHERE p.id = NEW.producto_id AND p.empresa_id = NEW.empresa_id;
  IF v_clase IS NOT NULL AND v_clase NOT IN ('VENDIBLE', 'ELABORADO') THEN
    RAISE EXCEPTION 'solo un producto vendible o elaborado tiene composición'
      USING ERRCODE = '23514', CONSTRAINT = 'composicion_producto_no_vendible';
  END IF;
  SELECT coalesce(max(c.numero), 0) INTO v_anterior
    FROM public.composicion c WHERE c.empresa_id = NEW.empresa_id AND c.producto_id = NEW.producto_id
     AND c.sucursal_id IS NOT DISTINCT FROM NEW.sucursal_id;
  IF NEW.numero <> v_anterior + 1 THEN
    RAISE EXCEPTION 'el número de versión de una composición es el siguiente al último'
      USING ERRCODE = '23514', CONSTRAINT = 'composicion_numero_salteado';
  END IF;
  -- Una receta propia nace de una versión de la central que existe: no se puede decir que salió de una que nunca hubo.
  IF NEW.sucursal_id IS NOT NULL THEN
    SELECT max(c.numero) INTO v_central
      FROM public.composicion c WHERE c.empresa_id = NEW.empresa_id AND c.producto_id = NEW.producto_id AND c.sucursal_id IS NULL;
    IF v_central IS NULL OR NEW.origen_numero > v_central THEN
      RAISE EXCEPTION 'la receta propia nace de una versión de la central que existe'
        USING ERRCODE = '23514', CONSTRAINT = 'composicion_origen_inexistente';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION articulo_de_stock_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_clase text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.producto_id IS DISTINCT FROM OLD.producto_id
       OR NEW.unidad_de_stock_id IS DISTINCT FROM OLD.unidad_de_stock_id OR NEW.dimension IS DISTINCT FROM OLD.dimension THEN
      RAISE EXCEPTION 'el producto y la unidad de un artículo de stock no cambian'
        USING ERRCODE = '23514', CONSTRAINT = 'articulo_de_stock_inmutable';
    END IF;
    IF OLD.activo AND NOT NEW.activo AND EXISTS (
         SELECT 1
           FROM public.componente_de_composicion k
           JOIN public.composicion c ON c.id = k.composicion_id AND c.empresa_id = k.empresa_id
          WHERE k.empresa_id = OLD.empresa_id AND k.articulo_id = OLD.id
            AND c.numero = (SELECT max(c2.numero) FROM public.composicion c2
                             WHERE c2.empresa_id = c.empresa_id AND c2.producto_id = c.producto_id
                               AND c2.sucursal_id IS NOT DISTINCT FROM c.sucursal_id)) THEN
      RAISE EXCEPTION 'el artículo está en la composición vigente de un producto (de la central o de una sucursal)'
        USING ERRCODE = '23514', CONSTRAINT = 'articulo_de_stock_en_composicion_activa';
    END IF;
    RETURN NEW;
  END IF;
  SELECT p.clase_de_uso INTO v_clase FROM public.producto p WHERE p.id = NEW.producto_id AND p.empresa_id = NEW.empresa_id;
  IF v_clase IS NOT NULL AND v_clase NOT IN ('MATERIA_PRIMA', 'INSUMO', 'REVENTA', 'ELABORADO', 'VENDIBLE') THEN
    RAISE EXCEPTION 'esta clase de producto no se controla en stock'
      USING ERRCODE = '23514', CONSTRAINT = 'articulo_de_stock_clase_no_controlable';
  END IF;
  RETURN NEW;
END
$$;

-- Sin ciclos y hasta cinco niveles (L5), un grafo por ámbito. DIFERIDO: corre una vez por versión (en el último componente). El candado de empresa serializa dos guardados cruzados.
CREATE OR REPLACE FUNCTION composicion_sin_ciclos() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_producto uuid;
  v_sucursal uuid;
  v_ambito uuid;
  v_ultimo integer;
  v_ciclo boolean;
  v_niveles integer;
BEGIN
  SELECT max(k.numero) INTO v_ultimo
    FROM public.componente_de_composicion k WHERE k.empresa_id = NEW.empresa_id AND k.composicion_id = NEW.composicion_id;
  IF NEW.numero <> v_ultimo THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('composicion_sin_ciclos:' || NEW.empresa_id::text, 0));
  SELECT c.producto_id, c.sucursal_id INTO v_producto, v_sucursal
    FROM public.composicion c WHERE c.id = NEW.composicion_id AND c.empresa_id = NEW.empresa_id;
  -- Un grafo por ámbito. Una versión propia se mira en el de su sucursal. Una versión de la central se mira en el de la central Y en el de cada sucursal que tenga alguna propia
  -- (su grafo puede pasar por esta central). Sin propias en la empresa, el único ámbito es la central y esto es lo mismo que antes.
  FOR v_ambito IN
    SELECT v_sucursal WHERE v_sucursal IS NOT NULL
    UNION ALL
    SELECT NULL::uuid WHERE v_sucursal IS NULL
    UNION ALL
    SELECT DISTINCT c.sucursal_id FROM public.composicion c
     WHERE v_sucursal IS NULL AND c.empresa_id = NEW.empresa_id AND c.sucursal_id IS NOT NULL
  LOOP
    WITH RECURSIVE camino (producto_id, nivel, ruta, ciclo) AS (
      SELECT v_producto, 1, ARRAY[v_producto], false
      UNION ALL
      SELECT k.compuesto_id, camino.nivel + 1, camino.ruta || k.compuesto_id, k.compuesto_id = ANY (camino.ruta)
        FROM camino
        JOIN public.componente_de_composicion k
          ON k.empresa_id = NEW.empresa_id
         AND k.composicion_id = public.composicion_vigente_id(NEW.empresa_id, camino.producto_id, v_ambito)
         AND k.compuesto_id IS NOT NULL
       WHERE NOT camino.ciclo AND camino.nivel < 7
    )
    SELECT coalesce(bool_or(ciclo), false), coalesce(max(nivel) FILTER (WHERE NOT ciclo), 1) INTO v_ciclo, v_niveles FROM camino;
    IF v_ciclo THEN
      RAISE EXCEPTION 'una receta no puede contener, directa ni indirectamente, al propio producto'
        USING ERRCODE = '23514', CONSTRAINT = 'composicion_con_ciclo';
    END IF;
    IF v_niveles > 5 THEN
      RAISE EXCEPTION 'una receta admite hasta cinco niveles de recetas dentro de recetas'
        USING ERRCODE = '23514', CONSTRAINT = 'composicion_demasiado_anidada';
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;
