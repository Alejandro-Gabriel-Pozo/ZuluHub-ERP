-- 0048_departamento_en_la_cuenta: la cuenta de venta (`cuenta_consumo`) guarda el DEPARTAMENTO con el que se abrió (A2c, tramo (a): datos y servidor).
-- Decisiones del dueño (13/11/2026, mensaje relatado por el orquestador): el departamento elegido en el selector de contexto se pega a la CUENTA de venta
-- (se fija al abrir y no cambia), NO a la caja ni a cada movimiento de caja; la caja y el punto de venta siguen siendo de la sucursal
-- (`decisiones-del-dueno-2026-11.md`, filas del 12/11 y 13/11/2026: «Selector de contexto: rótulo «Departamento»…» y «No se crea un departamento por defecto…»).
-- Plan de la sesión: `lo-que-falta-para-terminar.md`, etapa A2c. Departamento = nodo de primer nivel (padre nulo) de `nodo_de_clasificacion` (0045).
--
-- Qué NO es: no es el departamento de cada renglón. `linea_cuenta.departamento_id` (0047) es el departamento DEL PRODUCTO que se vendió (su clasificación al vender);
-- esta columna es el departamento en el que se TRABAJÓ al abrir la cuenta. Son independientes (confirmado por el dueño el 13/11/2026, DEC-0365: vender un producto de
-- otro departamento no se bloquea).
--
-- Reglas de esta migración (las mismas de 0036 y 0047):
--  * ADITIVA y compatible hacia atrás: una columna nullable. Las cuentas que ya existen quedan en NULL («sin departamento»): se abrieron antes de esta migración y no
--    hay de dónde reconstruirlo. No se rellena ni se borra nada. NULL también es válido para empresas sin departamentos.
--  * Clave foránea COMPUESTA `(departamento_id, empresa_id)` a `nodo_de_clasificacion`: la cuenta no puede apuntar a un nodo de otra empresa ni inexistente.
--  * Al INSERTAR, el nodo tiene que ser un departamento (primer nivel) y estar activo; después NO cambia nunca (disparador, además del privilegio: solo hay INSERT por
--    columna, ningún UPDATE de esta columna). Un departamento que se desactiva después no cambia las cuentas ya abiertas.
--  * Sin funciones SECURITY DEFINER: la función fija `search_path` y califica con `public.`. Solo la aplicación (`pedernal_app`) recibe el INSERT de la columna.
--  * Su reversión es un script aparte, revisado: `migraciones/reversiones/0048_revertir_departamento_en_la_cuenta.sql` (DESTRUCTIVA si hay cuentas con departamento).
-- DEPENDE de 0028 (ventas) y 0045 (nodos); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.cuenta_consumo') IS NULL OR to_regclass('public.nodo_de_clasificacion') IS NULL THEN
    RAISE EXCEPTION 'el departamento en la cuenta requiere 0028_ventas y 0045_clasificacion_comercial aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cuenta_consumo' AND column_name = 'departamento_id'
  ) THEN
    RAISE EXCEPTION 'el departamento en la cuenta nace en 0048: la columna ya existe (alguien la creó a mano); hay que revisarla antes de migrar'
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE cuenta_consumo ADD COLUMN departamento_id uuid;
ALTER TABLE cuenta_consumo ADD CONSTRAINT cuenta_departamento_fkey
  FOREIGN KEY (departamento_id, empresa_id) REFERENCES nodo_de_clasificacion (id, empresa_id);
CREATE INDEX cuenta_departamento_ix ON cuenta_consumo (empresa_id, departamento_id) WHERE departamento_id IS NOT NULL;

-- Al abrir: el nodo es un departamento (primer nivel) y está activo. Después: no cambia.
CREATE FUNCTION cuenta_validar_departamento() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.departamento_id IS DISTINCT FROM OLD.departamento_id THEN
      RAISE EXCEPTION 'el departamento de una cuenta se fija al abrirla y no cambia'
        USING ERRCODE = '23514', CONSTRAINT = 'cuenta_departamento_inmutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.departamento_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.nodo_de_clasificacion n
       WHERE n.id = NEW.departamento_id AND n.empresa_id = NEW.empresa_id AND n.padre_id IS NULL
    ) THEN
      RAISE EXCEPTION 'el departamento de la cuenta tiene que ser un nodo de primer nivel de la clasificación'
        USING ERRCODE = '23514', CONSTRAINT = 'cuenta_departamento_no_es_departamento';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.nodo_de_clasificacion n
       WHERE n.id = NEW.departamento_id AND n.empresa_id = NEW.empresa_id AND n.activo
    ) THEN
      RAISE EXCEPTION 'no se abre una cuenta en un departamento desactivado'
        USING ERRCODE = '23514', CONSTRAINT = 'cuenta_departamento_inactivo';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION cuenta_validar_departamento() FROM PUBLIC;
CREATE TRIGGER cuenta_departamento_validar BEFORE INSERT OR UPDATE ON cuenta_consumo
  FOR EACH ROW EXECUTE FUNCTION cuenta_validar_departamento();

-- Privilegio: INSERT por columna, como el resto de la cuenta (ningún UPDATE de esta columna).
GRANT INSERT (departamento_id) ON cuenta_consumo TO pedernal_app;
