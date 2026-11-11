-- 0038_salon: el salón, las comandas y la impresión (E7; decisiones 76, 85, 87, 89, 90, 114, 116, 117, 120, 121, 128, 144, 155 y 181 del dueño).
-- Es ADITIVA sobre 0028_ventas: suma una columna y una tabla a ventas (`linea_cuenta.importe_fijo`, `linea_copiada`), deja mover el ancla de una
-- cuenta ABIERTA y crea las tablas de dos módulos nuevos: SALÓN (`mesa`, `mesa_celda`, `union_de_mesas`, `linea_unida`, `division_de_cuenta`,
-- `parte_de_division`) y COMANDAS (`contador_de_envios`, `envio_de_comanda`, `renglon_de_envio`, `linea_de_comanda`, `aviso_de_anulacion`,
-- `impresora`, `trabajo_de_impresion`, `intento_de_impresion`). Diseño: Pedernal-docs/11-especificaciones/e7-salon-e-impresion-especificacion.md
-- §3.2 y §3.3. Va DESPUÉS de 0028 (cuenta y línea), de 0036 (la línea sella la versión de la variante) y de 0027 (la sesión de caja).
--
-- Reglas de esta migración (las mismas de 0001 a 0036):
--  * Es ADITIVA y compatible hacia atrás: columna nueva NULA, tablas nuevas, dos funciones reemplazadas por un superconjunto de la anterior
--    (`cuenta_validar_cambio`, `linea_validar_cambio`) y una más (`cuenta_total_cuadra`) que suma el importe fijo. Ninguna fila existente cambia.
--  * Su reversión es un script aparte, revisado y DESTRUCTIVO si hay datos (mesas, envíos, impresiones, uniones, divisiones): `migraciones/
--    reversiones/0038_revertir_salon.sql`. El ejecutor no la aplica y frena si alguna tabla tiene filas (salvo confirmación explícita).
--  * Ninguna función SECURITY DEFINER. Toda función fija `search_path = pg_catalog, public, pg_temp` y califica sus tablas con `public.`.
--  * Nadie recibe DELETE ni TRUNCATE (decisión 62: nada se borra, se anula o se desactiva); los disparadores los frenan aun al dueño de la
--    base. INSERT y UPDATE van por columna. RLS activa y FORZADA; una política por comando. Los demás roles no reciben nada.
--  * Toda única de una tabla con `empresa_id` lo incluye y toda clave foránea entre tablas de empresa es COMPUESTA `(x_id, empresa_id)`.
--    Dentro de este SQL SÍ hay claves foráneas hacia `cuenta_consumo` y `linea_cuenta` (salón y comandas están «arriba» de ventas); hacia caja y
--    catálogo no hay ninguna (ids opacos).
--  * Los textos que escribe una persona (motivo) se validan con una LISTA DE PERMITIDOS; los que se copian del catálogo (nombre de cocina,
--    detalle) usan la misma función del catálogo (`texto_de_catalogo_valido`, 0025).
--
-- Decisiones de diseño (probadas por `test/integracion/salon-migracion.test.ts`):
--
--  S1. Una línea se COPIA a otra cuenta (unir, dividir) o a la misma (anular una parte de un ítem ya enviado) SIN recotizar: `linea_copiada` dice de
--      cuál viene y de qué modo (`COMPLETA`, `POR_UNIDADES`, `COMPARTIDA`, `RESTO`) y un disparador diferido (`copias_cuadran`) comprueba al confirmar
--      que lo congelado es idéntico (precio, unidad, paso, alícuota, foto de opciones), que las cantidades suman lo de la origen y que el
--      importe compartido suma el de la origen redondeado una vez (mitad hacia arriba). Una línea con `importe_fijo` solo existe como copia COMPARTIDA.
--  S2. En un ítem compartido las copias llevan la cantidad entera y un importe fijo: la salida de stock la descuenta UNA sola de ellas (la que lleva
--      `controla_stock`), para no descontar k veces lo que se cocinó una.
--  S3. El ancla de una cuenta ABIERTA se puede mover (cambiar de mesa); el índice único de una cuenta abierta por ancla decide la carrera.
--  S4. El número de envío sale de `contador_de_envios` (un `UPDATE ... ultimo + 1` que bloquea la fila): sin huecos y sin repetidos por cuenta
--      (`contador_sin_huecos`, diferido). `envio_id` de una línea de comanda se fija UNA sola vez.
--  S5. La mesa libre no se guarda (se deriva); la superposición la impide la base: `mesa_celda` (única por casilla mientras la mesa está activa).
--  S6. Un documento original se imprime con UN solo trabajo por más toques que haya (única parcial); cada copia es un trabajo nuevo.

DO $$
DECLARE
  v_tabla text;
BEGIN
  IF to_regclass('public.cuenta_consumo') IS NULL OR to_regclass('public.linea_cuenta') IS NULL OR to_regclass('public.sucursal') IS NULL
     OR to_regclass('public.persona') IS NULL OR to_regclass('public.empresa') IS NULL
     OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL OR to_regprocedure('public.solo_insercion()') IS NULL
     OR to_regprocedure('public.empresa_operable(uuid)') IS NULL OR to_regprocedure('public.app_persona_id()') IS NULL
     OR to_regprocedure('public.app_empresa_id()') IS NULL OR to_regprocedure('public.sin_borrado()') IS NULL THEN
    RAISE EXCEPTION 'salón requiere 0001, 0007 y 0028_ventas aplicadas antes (cuenta, línea y funciones de contexto)'
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL OR to_regprocedure('public.fecha_de_negocio_de(uuid, uuid, timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'salón requiere 0025_catalogo y 0028_ventas aplicadas antes (texto_de_catalogo_valido, fecha_de_negocio_de)'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'linea_cuenta' AND column_name = 'variante_version_de_opcion_id') THEN
    RAISE EXCEPTION 'salón requiere 0036_ventas_sella_variante aplicada antes (falta linea_cuenta.variante_version_de_opcion_id)'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'linea_cuenta' AND column_name = 'importe_fijo') THEN
    RAISE EXCEPTION 'el importe fijo nace en 0038: la columna linea_cuenta.importe_fijo ya existe (alguien la creó a mano); hay que revisarla antes de migrar'
      USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['linea_copiada', 'mesa', 'mesa_celda', 'union_de_mesas', 'linea_unida', 'division_de_cuenta', 'parte_de_division',
                                 'contador_de_envios', 'envio_de_comanda', 'renglon_de_envio', 'linea_de_comanda', 'aviso_de_anulacion',
                                 'impresora', 'trabajo_de_impresion', 'intento_de_impresion'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      RAISE EXCEPTION 'el salón nace en 0038: la tabla % ya existe (alguien la creó a mano); hay que revisarla antes de migrar', v_tabla
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- VENTAS (S1, S2, S3): el importe fijo de una línea compartida, el ancla móvil y la línea copiada
-- ---------------------------------------------------------------------------------------------
ALTER TABLE linea_cuenta ADD COLUMN importe_fijo numeric(18,2)
  CONSTRAINT linea_importe_fijo_ck CHECK (importe_fijo IS NULL OR (importe_fijo >= 0 AND importe_fijo < 1000000000));
GRANT INSERT (importe_fijo) ON linea_cuenta TO pedernal_app;

-- El total de la cuenta: el importe de cada línea vigente es `importe_fijo` si lo tiene y `precio × cantidad` si no (la misma regla que
-- `calcularTicket`), redondeado una vez (mitad hacia arriba).
CREATE OR REPLACE FUNCTION cuenta_total_cuadra() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_cuenta uuid;
  v_empresa uuid;
  v_total numeric;
  v_esperado numeric;
BEGIN
  IF TG_TABLE_NAME = 'cuenta_consumo' THEN
    v_cuenta := NEW.id;
  ELSE
    v_cuenta := NEW.cuenta_id;
  END IF;
  v_empresa := NEW.empresa_id;
  SELECT c.total_provisorio INTO v_total FROM public.cuenta_consumo c WHERE c.id = v_cuenta AND c.empresa_id = v_empresa;
  SELECT round(coalesce(sum(coalesce(l.importe_fijo, l.precio_unitario * l.cantidad)), 0), 2) INTO v_esperado
    FROM public.linea_cuenta l WHERE l.cuenta_id = v_cuenta AND l.empresa_id = v_empresa AND l.estado = 'VIGENTE';
  IF v_total IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'el total de la cuenta (%) no es el de sus líneas vigentes (%)', v_total, v_esperado
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_total_cuadra';
  END IF;
  RETURN NULL;
END
$$;

-- La línea: mismo cuerpo de 0036 más `importe_fijo` entre lo que no se edita.
CREATE OR REPLACE FUNCTION linea_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  -- Todo lo que se congeló al agregar la línea queda como está: solo cambia `estado` (y su marca de anulación).
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id
     OR NEW.posicion IS DISTINCT FROM OLD.posicion OR NEW.producto_id IS DISTINCT FROM OLD.producto_id
     OR NEW.descripcion IS DISTINCT FROM OLD.descripcion OR NEW.variante_opcion_id IS DISTINCT FROM OLD.variante_opcion_id
     OR NEW.variante_nombre IS DISTINCT FROM OLD.variante_nombre
     OR NEW.variante_version_de_opcion_id IS DISTINCT FROM OLD.variante_version_de_opcion_id
     OR NEW.precio_id IS DISTINCT FROM OLD.precio_id
     OR NEW.origen_del_precio IS DISTINCT FROM OLD.origen_del_precio OR NEW.moneda IS DISTINCT FROM OLD.moneda
     OR NEW.precio_base IS DISTINCT FROM OLD.precio_base OR NEW.precio_unitario IS DISTINCT FROM OLD.precio_unitario
     OR NEW.importe_fijo IS DISTINCT FROM OLD.importe_fijo
     OR NEW.cantidad IS DISTINCT FROM OLD.cantidad OR NEW.unidad_de_venta IS DISTINCT FROM OLD.unidad_de_venta
     OR NEW.paso_de_cantidad IS DISTINCT FROM OLD.paso_de_cantidad OR NEW.alicuota IS DISTINCT FROM OLD.alicuota
     OR NEW.controla_stock IS DISTINCT FROM OLD.controla_stock OR NEW.creada_por IS DISTINCT FROM OLD.creada_por
     OR NEW.creada_en IS DISTINCT FROM OLD.creada_en OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'una línea no se edita: se anula con motivo y se agrega otra'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_inmutable';
  END IF;
  IF OLD.estado = 'ANULADA' THEN
    RAISE EXCEPTION 'una línea anulada no se puede modificar'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_anulada_congelada';
  END IF;
  IF NEW.estado = 'ANULADA' THEN
    IF NEW.anulada_por IS DISTINCT FROM public.app_persona_id() THEN
      RAISE EXCEPTION 'la línea la anula la persona del contexto'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_persona_del_contexto';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cuenta_consumo c WHERE c.id = NEW.cuenta_id AND c.empresa_id = NEW.empresa_id AND c.estado = 'ABIERTA') THEN
      RAISE EXCEPTION 'solo se anulan líneas de una cuenta abierta'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_cuenta_no_abierta';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- La cuenta: mismo cuerpo de 0028 pero el ancla (tipo e id) se puede mover mientras la cuenta está ABIERTA (S3): una cuenta cerrada o anulada
-- sigue congelada por el segundo control.
CREATE OR REPLACE FUNCTION cuenta_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id OR NEW.etiqueta IS DISTINCT FROM OLD.etiqueta
     OR NEW.moneda IS DISTINCT FROM OLD.moneda OR NEW.momento_de_stock IS DISTINCT FROM OLD.momento_de_stock
     OR NEW.abierta_por IS DISTINCT FROM OLD.abierta_por OR NEW.abierta_en IS DISTINCT FROM OLD.abierta_en
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'la identidad de una cuenta no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_inmutable';
  END IF;
  IF OLD.estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'una cuenta cerrada o anulada no se puede modificar'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_resuelta_congelada';
  END IF;
  -- Reservar una posición sube `ultima_posicion` de a una; ninguna otra cosa la mueve.
  IF NEW.ultima_posicion IS DISTINCT FROM OLD.ultima_posicion AND NEW.ultima_posicion <> OLD.ultima_posicion + 1 THEN
    RAISE EXCEPTION 'las posiciones de una cuenta suben de a una'
      USING ERRCODE = '23514', CONSTRAINT = 'cuenta_posicion_invalida';
  END IF;
  IF NEW.estado <> 'ABIERTA' THEN
    -- Quien cierra o anula es la persona del contexto firmado: la aplicación no puede poner a otra.
    IF NEW.resuelta_por IS DISTINCT FROM public.app_persona_id() THEN
      RAISE EXCEPTION 'la cuenta la resuelve la persona del contexto'
        USING ERRCODE = '23514', CONSTRAINT = 'cuenta_persona_del_contexto';
    END IF;
    IF NEW.ultima_posicion IS DISTINCT FROM OLD.ultima_posicion OR NEW.total_provisorio IS DISTINCT FROM OLD.total_provisorio
       OR NEW.ancla_tipo IS DISTINCT FROM OLD.ancla_tipo OR NEW.ancla_id IS DISTINCT FROM OLD.ancla_id THEN
      RAISE EXCEPTION 'al cerrar o anular una cuenta no se cambian sus líneas, su total ni su ancla'
        USING ERRCODE = '23514', CONSTRAINT = 'cuenta_transicion_invalida';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
GRANT UPDATE (ancla_tipo, ancla_id) ON cuenta_consumo TO pedernal_app;

CREATE TABLE linea_copiada (                                           -- solo inserción
  empresa_id       uuid NOT NULL REFERENCES empresa (id),
  linea_nueva_id   uuid NOT NULL,
  linea_origen_id  uuid NOT NULL,
  modo             text NOT NULL CONSTRAINT linea_copiada_modo_ck CHECK (modo IN ('COMPLETA', 'POR_UNIDADES', 'COMPARTIDA', 'RESTO')),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linea_copiada_pkey PRIMARY KEY (empresa_id, linea_nueva_id),
  CONSTRAINT linea_copiada_nueva_fkey FOREIGN KEY (linea_nueva_id, empresa_id) REFERENCES linea_cuenta (id, empresa_id),
  CONSTRAINT linea_copiada_origen_fkey FOREIGN KEY (linea_origen_id, empresa_id) REFERENCES linea_cuenta (id, empresa_id),
  CONSTRAINT linea_copiada_distintas_ck CHECK (linea_nueva_id <> linea_origen_id)
);
CREATE INDEX linea_copiada_origen_ix ON linea_copiada (empresa_id, linea_origen_id);

-- Una copia nace con su línea nueva, en la misma transacción, de una origen ya anulada, de la misma sucursal; y con motivo `TRASLADADA` salvo
-- `RESTO` (anular parte de un ítem enviado: lleva el motivo real que escribió quien anuló).
CREATE FUNCTION linea_copiada_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_nueva public.linea_cuenta%ROWTYPE;
  v_origen public.linea_cuenta%ROWTYPE;
BEGIN
  SELECT * INTO v_nueva FROM public.linea_cuenta l WHERE l.id = NEW.linea_nueva_id AND l.empresa_id = NEW.empresa_id AND l.xmin = pg_current_xact_id()::xid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la copia de una línea nace con la línea nueva, en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_copiada_solo_con_la_linea';
  END IF;
  SELECT * INTO v_origen FROM public.linea_cuenta l WHERE l.id = NEW.linea_origen_id AND l.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_origen.estado <> 'ANULADA' OR v_nueva.estado <> 'VIGENTE' THEN
    RAISE EXCEPTION 'se copia una línea ya anulada a una línea vigente'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_copiada_origen_invalida';
  END IF;
  IF (NEW.modo = 'RESTO') = (v_origen.motivo_de_anulacion = 'TRASLADADA') THEN
    RAISE EXCEPTION 'la línea trasladada lleva el motivo TRASLADADA y solo ella; el resto de una anulación parcial lleva el motivo real'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_copiada_motivo_invalido';
  END IF;
  IF (SELECT c.sucursal_id FROM public.cuenta_consumo c WHERE c.id = v_nueva.cuenta_id AND c.empresa_id = v_nueva.empresa_id)
     IS DISTINCT FROM (SELECT c.sucursal_id FROM public.cuenta_consumo c WHERE c.id = v_origen.cuenta_id AND c.empresa_id = v_origen.empresa_id) THEN
    RAISE EXCEPTION 'una línea no se copia a otra sucursal'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_copiada_otra_sucursal';
  END IF;
  RETURN NEW;
END
$$;

-- S1 y S2: al confirmar, lo congelado es idéntico, las cantidades suman lo de la origen y el importe compartido suma el de la origen.
CREATE FUNCTION copias_cuadran() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_origen public.linea_cuenta%ROWTYPE;
  v_modos integer;
  v_modo text;
  v_copias integer;
  v_suma_cantidad numeric;
  v_suma_fijo numeric;
  v_con_stock integer;
BEGIN
  SELECT * INTO v_origen FROM public.linea_cuenta l WHERE l.id = NEW.linea_origen_id AND l.empresa_id = NEW.empresa_id;
  SELECT count(DISTINCT c.modo), min(c.modo), count(*), coalesce(sum(n.cantidad), 0), coalesce(sum(n.importe_fijo), 0),
         count(*) FILTER (WHERE n.controla_stock)
    INTO v_modos, v_modo, v_copias, v_suma_cantidad, v_suma_fijo, v_con_stock
    FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
   WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id;
  IF v_modos <> 1 THEN
    RAISE EXCEPTION 'las copias de una línea son todas del mismo modo'
      USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
  END IF;
  -- Lo congelado no se recotiza: precio, unidad, paso, alícuota, producto, variante y la foto de las opciones son los de la origen.
  IF EXISTS (
    SELECT 1 FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
     WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id
       AND (n.producto_id IS DISTINCT FROM v_origen.producto_id OR n.descripcion IS DISTINCT FROM v_origen.descripcion
            OR n.variante_opcion_id IS DISTINCT FROM v_origen.variante_opcion_id OR n.variante_nombre IS DISTINCT FROM v_origen.variante_nombre
            OR n.variante_version_de_opcion_id IS DISTINCT FROM v_origen.variante_version_de_opcion_id
            OR n.precio_id IS DISTINCT FROM v_origen.precio_id OR n.origen_del_precio IS DISTINCT FROM v_origen.origen_del_precio
            OR n.precio_base IS DISTINCT FROM v_origen.precio_base OR n.precio_unitario IS DISTINCT FROM v_origen.precio_unitario
            OR n.unidad_de_venta IS DISTINCT FROM v_origen.unidad_de_venta OR n.paso_de_cantidad IS DISTINCT FROM v_origen.paso_de_cantidad
            OR n.alicuota IS DISTINCT FROM v_origen.alicuota
            OR EXISTS (
              (SELECT o.orden, o.opcion_id, o.version_de_opcion_id, o.grupo_id, o.nombre_de_grupo, o.nombre, o.clase, o.recargo, o.origen_del_recargo
                 FROM public.linea_cuenta_opcion o WHERE o.linea_id = n.id AND o.empresa_id = n.empresa_id
               EXCEPT
               SELECT o.orden, o.opcion_id, o.version_de_opcion_id, o.grupo_id, o.nombre_de_grupo, o.nombre, o.clase, o.recargo, o.origen_del_recargo
                 FROM public.linea_cuenta_opcion o WHERE o.linea_id = v_origen.id AND o.empresa_id = v_origen.empresa_id)
              UNION ALL
              (SELECT o.orden, o.opcion_id, o.version_de_opcion_id, o.grupo_id, o.nombre_de_grupo, o.nombre, o.clase, o.recargo, o.origen_del_recargo
                 FROM public.linea_cuenta_opcion o WHERE o.linea_id = v_origen.id AND o.empresa_id = v_origen.empresa_id
               EXCEPT
               SELECT o.orden, o.opcion_id, o.version_de_opcion_id, o.grupo_id, o.nombre_de_grupo, o.nombre, o.clase, o.recargo, o.origen_del_recargo
                 FROM public.linea_cuenta_opcion o WHERE o.linea_id = n.id AND o.empresa_id = n.empresa_id)))
  ) THEN
    RAISE EXCEPTION 'la copia de una línea conserva lo congelado de la origen: no se recotiza'
      USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
  END IF;
  IF v_modo = 'COMPLETA' THEN
    IF v_copias <> 1 OR v_suma_cantidad <> v_origen.cantidad OR v_suma_fijo IS DISTINCT FROM coalesce(v_origen.importe_fijo, 0)
       OR EXISTS (SELECT 1 FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
                   WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id
                     AND (n.importe_fijo IS DISTINCT FROM v_origen.importe_fijo OR n.controla_stock IS DISTINCT FROM v_origen.controla_stock)) THEN
      RAISE EXCEPTION 'una línea trasladada entera pasa con su misma cantidad e importe'
        USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
    END IF;
  ELSIF v_modo = 'POR_UNIDADES' THEN
    IF v_copias < 2 OR v_suma_cantidad <> v_origen.cantidad OR v_origen.importe_fijo IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
                   WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id
                     AND (n.importe_fijo IS NOT NULL OR n.controla_stock IS DISTINCT FROM v_origen.controla_stock)) THEN
      RAISE EXCEPTION 'las partes de una línea repartida por unidades suman su cantidad'
        USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
    END IF;
  ELSIF v_modo = 'COMPARTIDA' THEN
    IF v_copias < 2 OR v_origen.importe_fijo IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
                   WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id
                     AND (n.importe_fijo IS NULL OR n.cantidad <> v_origen.cantidad))
       OR v_suma_fijo <> round(v_origen.precio_unitario * v_origen.cantidad, 2)
       OR v_con_stock <> (CASE WHEN v_origen.controla_stock THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION 'las partes de un ítem compartido suman el importe de la línea y solo una descuenta stock'
        USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
    END IF;
  ELSE -- RESTO: lo que sigue vigente de un ítem anulado en parte
    IF v_copias <> 1 OR v_suma_cantidad >= v_origen.cantidad OR v_origen.importe_fijo IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.linea_copiada c JOIN public.linea_cuenta n ON n.id = c.linea_nueva_id AND n.empresa_id = c.empresa_id
                   WHERE c.linea_origen_id = NEW.linea_origen_id AND c.empresa_id = NEW.empresa_id
                     AND (n.importe_fijo IS NOT NULL OR n.controla_stock IS DISTINCT FROM v_origen.controla_stock
                          OR n.cuenta_id IS DISTINCT FROM v_origen.cuenta_id)) THEN
      RAISE EXCEPTION 'el resto de un ítem anulado en parte es menor que lo anulado y queda en la misma cuenta'
        USING ERRCODE = '23514', CONSTRAINT = 'copias_cuadran';
    END IF;
  END IF;
  RETURN NULL;
END
$$;

-- Una línea con importe fijo solo existe como copia COMPARTIDA (S1): ningún otro camino puede fijar un importe.
CREATE FUNCTION linea_importe_fijo_solo_compartida() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.importe_fijo IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.linea_copiada c WHERE c.linea_nueva_id = NEW.id AND c.empresa_id = NEW.empresa_id AND c.modo = 'COMPARTIDA'
  ) THEN
    RAISE EXCEPTION 'solo una línea compartida lleva importe fijo'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_importe_fijo_solo_compartida';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER linea_copiada_alta BEFORE INSERT ON linea_copiada FOR EACH ROW EXECUTE FUNCTION linea_copiada_validar_alta();
CREATE CONSTRAINT TRIGGER copias_cuadran_ck AFTER INSERT ON linea_copiada
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION copias_cuadran();
CREATE CONSTRAINT TRIGGER linea_importe_fijo_ck_trg AFTER INSERT ON linea_cuenta
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION linea_importe_fijo_solo_compartida();
CREATE TRIGGER linea_copiada_solo_insercion BEFORE UPDATE OR DELETE ON linea_copiada FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER linea_copiada_sin_truncate BEFORE TRUNCATE ON linea_copiada FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

REVOKE ALL ON linea_copiada FROM PUBLIC;
GRANT SELECT ON linea_copiada TO pedernal_app;
GRANT INSERT (empresa_id, linea_nueva_id, linea_origen_id, modo) ON linea_copiada TO pedernal_app;
ALTER TABLE linea_copiada ENABLE ROW LEVEL SECURITY;
ALTER TABLE linea_copiada FORCE ROW LEVEL SECURITY;
CREATE POLICY linea_copiada_app_leer ON linea_copiada FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY linea_copiada_app_alta ON linea_copiada FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

-- ---------------------------------------------------------------------------------------------
-- SALÓN: la mesa y sus casillas (S5)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE mesa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),          -- lo manda la app: es la idempotencia del alta
  empresa_id      uuid NOT NULL REFERENCES empresa (id),
  sucursal_id     uuid NOT NULL,
  numero          smallint NOT NULL CONSTRAINT mesa_numero_ck CHECK (numero BETWEEN 1 AND 99),
  forma           text NOT NULL CONSTRAINT mesa_forma_ck CHECK (forma IN ('REDONDA', 'CUADRADA', 'LARGA')),
  tamano          text NOT NULL CONSTRAINT mesa_tamano_ck CHECK (tamano IN ('CHICA', 'MEDIANA', 'GRANDE')),
  columna         smallint NOT NULL CONSTRAINT mesa_columna_ck CHECK (columna BETWEEN 1 AND 14),
  fila            smallint NOT NULL CONSTRAINT mesa_fila_ck CHECK (fila BETWEEN 1 AND 9),
  activa          boolean NOT NULL DEFAULT true,
  creada_por      uuid NOT NULL REFERENCES persona (id),
  creada_en       timestamptz NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT mesa_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT mesa_numero_uk UNIQUE (empresa_id, sucursal_id, numero),   -- también entre las desactivadas
  CONSTRAINT mesa_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id)
);

CREATE TABLE mesa_celda (
  empresa_id   uuid NOT NULL REFERENCES empresa (id),
  sucursal_id  uuid NOT NULL,
  mesa_id      uuid NOT NULL,
  columna      smallint NOT NULL CONSTRAINT mesa_celda_columna_ck CHECK (columna BETWEEN 1 AND 14),
  fila         smallint NOT NULL CONSTRAINT mesa_celda_fila_ck CHECK (fila BETWEEN 1 AND 9),
  activa       boolean NOT NULL DEFAULT true,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesa_celda_pkey PRIMARY KEY (empresa_id, mesa_id, columna, fila),
  CONSTRAINT mesa_celda_mesa_fkey FOREIGN KEY (mesa_id, empresa_id) REFERENCES mesa (id, empresa_id),
  CONSTRAINT mesa_celda_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id)
);
-- Dos mesas activas no ocupan la misma casilla (S5).
CREATE UNIQUE INDEX mesa_celda_ocupada_uk ON mesa_celda (empresa_id, sucursal_id, columna, fila) WHERE activa;

CREATE FUNCTION mesa_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id
     OR NEW.creada_por IS DISTINCT FROM OLD.creada_por OR NEW.creada_en IS DISTINCT FROM OLD.creada_en OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'la identidad de una mesa no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'mesa_inmutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION mesa_celda_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_mesa public.mesa%ROWTYPE;
BEGIN
  SELECT * INTO v_mesa FROM public.mesa m WHERE m.id = NEW.mesa_id AND m.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_mesa.sucursal_id <> NEW.sucursal_id THEN
    RAISE EXCEPTION 'la casilla es de otra sucursal que su mesa'
      USING ERRCODE = '23514', CONSTRAINT = 'mesa_celda_sucursal_invalida';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id
     OR NEW.mesa_id IS DISTINCT FROM OLD.mesa_id OR NEW.columna IS DISTINCT FROM OLD.columna OR NEW.fila IS DISTINCT FROM OLD.fila) THEN
    RAISE EXCEPTION 'una casilla solo se activa o se desactiva'
      USING ERRCODE = '23514', CONSTRAINT = 'mesa_celda_inmutable';
  END IF;
  RETURN NEW;
END
$$;

-- Al confirmar: una mesa activa ocupa al menos una casilla y una desactivada ninguna.
CREATE FUNCTION mesa_celdas_cuadran() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_mesa uuid;
  v_activa boolean;
  v_celdas integer;
BEGIN
  IF TG_TABLE_NAME = 'mesa' THEN
    v_mesa := NEW.id;
  ELSE
    v_mesa := NEW.mesa_id;
  END IF;
  SELECT m.activa INTO v_activa FROM public.mesa m WHERE m.id = v_mesa AND m.empresa_id = NEW.empresa_id;
  SELECT count(*) INTO v_celdas FROM public.mesa_celda c WHERE c.mesa_id = v_mesa AND c.empresa_id = NEW.empresa_id AND c.activa;
  IF (v_activa AND v_celdas < 1) OR (NOT v_activa AND v_celdas > 0) THEN
    RAISE EXCEPTION 'una mesa activa ocupa casillas y una desactivada no'
      USING ERRCODE = '23514', CONSTRAINT = 'mesa_celdas_cuadran';
  END IF;
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- SALÓN: unir y dividir
-- ---------------------------------------------------------------------------------------------
CREATE TABLE union_de_mesas (                                          -- solo inserción
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- lo manda la app
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  sucursal_id         uuid NOT NULL,
  cuenta_destino_id   uuid NOT NULL,
  mesa_destino_id     uuid NOT NULL,
  cuenta_origen_id    uuid NOT NULL,                                   -- la cuenta de reserva: sigue abierta y sin líneas vigentes
  mesa_origen_id      uuid NOT NULL,
  clave               text NOT NULL CONSTRAINT union_clave_ck CHECK (clave ~ '^[A-Za-z0-9_-]{16,128}$'),
  unida_por           uuid NOT NULL REFERENCES persona (id),
  unida_en            timestamptz NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT union_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT union_clave_uk UNIQUE (empresa_id, clave),
  CONSTRAINT union_origen_uk UNIQUE (empresa_id, cuenta_origen_id),
  CONSTRAINT union_distintas_ck CHECK (cuenta_destino_id <> cuenta_origen_id AND mesa_destino_id <> mesa_origen_id),
  CONSTRAINT union_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT union_cuenta_destino_fkey FOREIGN KEY (cuenta_destino_id, empresa_id) REFERENCES cuenta_consumo (id, empresa_id),
  CONSTRAINT union_cuenta_origen_fkey FOREIGN KEY (cuenta_origen_id, empresa_id) REFERENCES cuenta_consumo (id, empresa_id),
  CONSTRAINT union_mesa_destino_fkey FOREIGN KEY (mesa_destino_id, empresa_id) REFERENCES mesa (id, empresa_id),
  CONSTRAINT union_mesa_origen_fkey FOREIGN KEY (mesa_origen_id, empresa_id) REFERENCES mesa (id, empresa_id)
);
CREATE INDEX union_destino_ix ON union_de_mesas (empresa_id, cuenta_destino_id);

CREATE TABLE linea_unida (                                             -- solo inserción: de qué mesa vino cada ítem pasado por una unión
  empresa_id      uuid NOT NULL REFERENCES empresa (id),
  linea_id        uuid NOT NULL,
  union_id        uuid NOT NULL,
  mesa_origen_id  uuid NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linea_unida_pkey PRIMARY KEY (empresa_id, linea_id),
  CONSTRAINT linea_unida_linea_fkey FOREIGN KEY (linea_id, empresa_id) REFERENCES linea_cuenta (id, empresa_id),
  CONSTRAINT linea_unida_union_fkey FOREIGN KEY (union_id, empresa_id) REFERENCES union_de_mesas (id, empresa_id),
  CONSTRAINT linea_unida_mesa_fkey FOREIGN KEY (mesa_origen_id, empresa_id) REFERENCES mesa (id, empresa_id)
);

CREATE TABLE division_de_cuenta (                                      -- solo inserción
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),        -- lo manda la app
  empresa_id        uuid NOT NULL REFERENCES empresa (id),
  sucursal_id       uuid NOT NULL,
  cuenta_madre_id   uuid NOT NULL,                                     -- la cuenta de reserva: sigue abierta y sin líneas vigentes
  mesa_id           uuid NOT NULL,
  partes            smallint NOT NULL CONSTRAINT division_partes_ck CHECK (partes BETWEEN 2 AND 4),
  dividida_por      uuid NOT NULL REFERENCES persona (id),
  dividida_en       timestamptz NOT NULL,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT division_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT division_madre_uk UNIQUE (empresa_id, cuenta_madre_id),   -- una división por cuenta
  CONSTRAINT division_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT division_madre_fkey FOREIGN KEY (cuenta_madre_id, empresa_id) REFERENCES cuenta_consumo (id, empresa_id),
  CONSTRAINT division_mesa_fkey FOREIGN KEY (mesa_id, empresa_id) REFERENCES mesa (id, empresa_id)
);

CREATE TABLE parte_de_division (                                       -- solo inserción
  empresa_id   uuid NOT NULL REFERENCES empresa (id),
  division_id  uuid NOT NULL,
  numero       smallint NOT NULL CONSTRAINT parte_numero_ck CHECK (numero BETWEEN 1 AND 4),
  cuenta_id    uuid NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parte_pkey PRIMARY KEY (empresa_id, division_id, numero),
  CONSTRAINT parte_cuenta_uk UNIQUE (empresa_id, cuenta_id),
  CONSTRAINT parte_division_fkey FOREIGN KEY (division_id, empresa_id) REFERENCES division_de_cuenta (id, empresa_id),
  CONSTRAINT parte_cuenta_fkey FOREIGN KEY (cuenta_id, empresa_id) REFERENCES cuenta_consumo (id, empresa_id)
);

-- Una división tiene tantas cuentas hijas como partes declara, numeradas de 1 en adelante sin saltos (se comprueba al confirmar).
CREATE FUNCTION division_partes_cuadran() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_division uuid;
  v_partes integer;
  v_hijas integer;
  v_maximo integer;
BEGIN
  IF TG_TABLE_NAME = 'division_de_cuenta' THEN
    v_division := NEW.id;
  ELSE
    v_division := NEW.division_id;
  END IF;
  SELECT d.partes INTO v_partes FROM public.division_de_cuenta d WHERE d.id = v_division AND d.empresa_id = NEW.empresa_id;
  SELECT count(*), coalesce(max(p.numero), 0) INTO v_hijas, v_maximo
    FROM public.parte_de_division p WHERE p.division_id = v_division AND p.empresa_id = NEW.empresa_id;
  IF v_hijas <> v_partes OR v_maximo <> v_partes THEN
    RAISE EXCEPTION 'la división declara % partes y tiene % cuentas hijas', v_partes, v_hijas
      USING ERRCODE = '23514', CONSTRAINT = 'division_partes_cuadran';
  END IF;
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- COMANDAS: contador y envíos (S4)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE contador_de_envios (
  empresa_id  uuid NOT NULL REFERENCES empresa (id),
  cuenta_id   uuid NOT NULL,
  ultimo      integer NOT NULL DEFAULT 0 CONSTRAINT contador_ultimo_ck CHECK (ultimo >= 0 AND ultimo < 10000),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT contador_pkey PRIMARY KEY (empresa_id, cuenta_id),
  CONSTRAINT contador_cuenta_fkey FOREIGN KEY (cuenta_id, empresa_id) REFERENCES cuenta_consumo (id, empresa_id)
);

CREATE TABLE envio_de_comanda (                                        -- solo inserción
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),           -- lo manda la app
  empresa_id     uuid NOT NULL REFERENCES empresa (id),
  sucursal_id    uuid NOT NULL,
  cuenta_id      uuid NOT NULL,
  numero         integer NOT NULL CONSTRAINT envio_numero_ck CHECK (numero BETWEEN 1 AND 9999),
  tipo           text NOT NULL CONSTRAINT envio_tipo_ck CHECK (tipo IN ('ENVIO', 'SALIDA_PEDIDA')),
  rotulo         text NOT NULL CONSTRAINT envio_rotulo_ck CHECK (texto_de_catalogo_valido(rotulo, 40)),  -- foto: «Mesa 5»
  enviado_por    uuid NOT NULL REFERENCES persona (id),
  enviado_en     timestamptz NOT NULL,                                 -- el `ahora` de la aplicación (D87): la copia muestra ESTA hora
  fecha_negocio  date NOT NULL CONSTRAINT envio_fecha_ck CHECK (fecha_negocio BETWEEN date '2000-01-01' AND date '2200-12-31'),
  clave          text NOT NULL CONSTRAINT envio_clave_ck CHECK (clave ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella         text NOT NULL CONSTRAINT envio_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT envio_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT envio_numero_uk UNIQUE (empresa_id, cuenta_id, numero),
  CONSTRAINT envio_clave_uk UNIQUE (empresa_id, clave),
  CONSTRAINT envio_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT envio_cuenta_fkey FOREIGN KEY (cuenta_id, empresa_id) REFERENCES cuenta_consumo (id, empresa_id)
);
CREATE INDEX envio_jornada_ix ON envio_de_comanda (empresa_id, sucursal_id, fecha_negocio);

CREATE FUNCTION detalle_de_cocina_valido(p_detalle text[]) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT p_detalle IS NOT NULL AND coalesce(array_length(p_detalle, 1), 0) <= 50
     AND NOT EXISTS (SELECT 1 FROM unnest(p_detalle) AS t(x) WHERE x IS NULL OR NOT public.texto_de_catalogo_valido(x, 200))
$$;

REVOKE ALL ON FUNCTION detalle_de_cocina_valido(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION detalle_de_cocina_valido(text[]) TO pedernal_app;      -- la usan los CHECK, que corren con los permisos de quien escribe

CREATE TABLE renglon_de_envio (                                        -- solo inserción: la foto de lo que dice el papel (D87)
  empresa_id          uuid NOT NULL REFERENCES empresa (id),
  envio_id            uuid NOT NULL,
  orden               integer NOT NULL CONSTRAINT renglon_orden_ck CHECK (orden BETWEEN 1 AND 1000),
  linea_id            uuid NOT NULL,
  cantidad            numeric(18,4) NOT NULL CONSTRAINT renglon_cantidad_ck CHECK (cantidad > 0 AND cantidad <= 9999),
  rol                 text NOT NULL CONSTRAINT renglon_rol_ck CHECK (rol IN ('SALE', 'ESPERA')),
  nombre_de_cocina    text NOT NULL CONSTRAINT renglon_nombre_ck CHECK (texto_de_catalogo_valido(nombre_de_cocina, 200)),
  detalle_de_cocina   text[] NOT NULL DEFAULT '{}' CONSTRAINT renglon_detalle_ck CHECK (detalle_de_cocina_valido(detalle_de_cocina)),
  creado_en           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT renglon_pkey PRIMARY KEY (empresa_id, envio_id, orden),
  CONSTRAINT renglon_envio_fkey FOREIGN KEY (envio_id, empresa_id) REFERENCES envio_de_comanda (id, empresa_id),
  CONSTRAINT renglon_linea_fkey FOREIGN KEY (linea_id, empresa_id) REFERENCES linea_cuenta (id, empresa_id)
);

CREATE TABLE linea_de_comanda (
  empresa_id  uuid NOT NULL REFERENCES empresa (id),
  linea_id    uuid NOT NULL,
  cuenta_id   uuid NOT NULL,
  salida      text NOT NULL DEFAULT 'AHORA' CONSTRAINT linea_de_comanda_salida_ck CHECK (salida IN ('AHORA', 'DESPUES')),
  envio_id    uuid,                                                    -- nulo = sin enviar; se fija UNA sola vez
  creado_en   timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT linea_de_comanda_pkey PRIMARY KEY (empresa_id, linea_id),
  CONSTRAINT linea_de_comanda_linea_fkey FOREIGN KEY (linea_id, empresa_id) REFERENCES linea_cuenta (id, empresa_id),
  CONSTRAINT linea_de_comanda_cuenta_fkey FOREIGN KEY (cuenta_id, empresa_id) REFERENCES cuenta_consumo (id, empresa_id),
  CONSTRAINT linea_de_comanda_envio_fkey FOREIGN KEY (envio_id, empresa_id) REFERENCES envio_de_comanda (id, empresa_id)
);
CREATE INDEX linea_de_comanda_cuenta_ix ON linea_de_comanda (empresa_id, cuenta_id);
CREATE INDEX linea_de_comanda_envio_ix ON linea_de_comanda (empresa_id, envio_id) WHERE envio_id IS NOT NULL;

CREATE TABLE aviso_de_anulacion (                                      -- solo inserción: el papel «ANULACIÓN · NO PREPARAR»
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),        -- lo manda la app
  empresa_id        uuid NOT NULL REFERENCES empresa (id),
  cuenta_id         uuid NOT NULL,
  linea_origen_id   uuid NOT NULL,
  envio_id          uuid NOT NULL,                                     -- el envío en que salió el ítem
  cantidad          numeric(18,4) NOT NULL CONSTRAINT aviso_cantidad_ck CHECK (cantidad > 0 AND cantidad <= 9999),
  quedan            numeric(18,4) NOT NULL CONSTRAINT aviso_quedan_ck CHECK (quedan >= 0 AND quedan <= 9999),
  motivo            text NOT NULL CONSTRAINT aviso_motivo_ck CHECK (
                      motivo = btrim(motivo) AND char_length(motivo) BETWEEN 1 AND 500
                      AND motivo ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'),
  nombre_de_cocina  text NOT NULL CONSTRAINT aviso_nombre_ck CHECK (texto_de_catalogo_valido(nombre_de_cocina, 200)),
  detalle_de_cocina text[] NOT NULL DEFAULT '{}' CONSTRAINT aviso_detalle_ck CHECK (detalle_de_cocina_valido(detalle_de_cocina)),
  rotulo            text NOT NULL CONSTRAINT aviso_rotulo_ck CHECK (texto_de_catalogo_valido(rotulo, 40)),
  anulado_por       uuid NOT NULL REFERENCES persona (id),
  anulado_en        timestamptz NOT NULL,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aviso_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT aviso_linea_uk UNIQUE (empresa_id, linea_origen_id),     -- una anulación por línea: anular parte genera una línea nueva con el resto
  CONSTRAINT aviso_cuenta_fkey FOREIGN KEY (cuenta_id, empresa_id) REFERENCES cuenta_consumo (id, empresa_id),
  CONSTRAINT aviso_linea_fkey FOREIGN KEY (linea_origen_id, empresa_id) REFERENCES linea_cuenta (id, empresa_id),
  CONSTRAINT aviso_envio_fkey FOREIGN KEY (envio_id, empresa_id) REFERENCES envio_de_comanda (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- COMANDAS: impresoras y trabajos de impresión (S6)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE impresora (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),          -- lo manda la app
  empresa_id      uuid NOT NULL REFERENCES empresa (id),
  sucursal_id     uuid NOT NULL,
  nombre          text NOT NULL CONSTRAINT impresora_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 40)),
  uso             text NOT NULL CONSTRAINT impresora_uso_ck CHECK (uso IN ('COMANDA', 'TICKET')),
  papel_mm        smallint NOT NULL CONSTRAINT impresora_papel_ck CHECK (papel_mm IN (58, 80)),
  activa          boolean NOT NULL DEFAULT true,
  creada_por      uuid NOT NULL REFERENCES persona (id),
  creada_en       timestamptz NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT impresora_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT impresora_nombre_uk UNIQUE (empresa_id, sucursal_id, nombre),
  CONSTRAINT impresora_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id)
);

CREATE TABLE trabajo_de_impresion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),         -- lo manda la app
  empresa_id       uuid NOT NULL REFERENCES empresa (id),
  sucursal_id      uuid NOT NULL,
  impresora_id     uuid,                                               -- nulo = «Ver en pantalla»
  documento_tipo   text NOT NULL CONSTRAINT trabajo_imp_tipo_ck CHECK (documento_tipo IN ('COMANDA', 'ANULACION', 'TICKET')),
  documento_id     uuid NOT NULL,                                      -- opaco: el envío, el aviso o el ticket
  es_copia         boolean NOT NULL DEFAULT false,
  estado           text NOT NULL DEFAULT 'PENDIENTE' CONSTRAINT trabajo_imp_estado_ck CHECK (estado IN ('PENDIENTE', 'IMPRESA', 'FALLIDA')),
  intentos         integer NOT NULL DEFAULT 1 CONSTRAINT trabajo_imp_intentos_ck CHECK (intentos BETWEEN 1 AND 1000),
  clave            text NOT NULL CONSTRAINT trabajo_imp_clave_ck CHECK (clave ~ '^[A-Za-z0-9_-]{16,128}$'),
  huella           text NOT NULL CONSTRAINT trabajo_imp_huella_ck CHECK (huella ~ '^[0-9a-f]{64}$'),
  solicitado_por   uuid NOT NULL REFERENCES persona (id),
  solicitado_en    timestamptz NOT NULL,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT trabajo_imp_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT trabajo_imp_clave_uk UNIQUE (empresa_id, clave),
  CONSTRAINT trabajo_imp_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT trabajo_imp_impresora_fkey FOREIGN KEY (impresora_id, empresa_id) REFERENCES impresora (id, empresa_id)
);
-- Un documento ORIGINAL tiene un solo trabajo, por más toques que haya (S6); cada copia es un trabajo nuevo con su clave.
CREATE UNIQUE INDEX trabajo_imp_original_uk ON trabajo_de_impresion (empresa_id, documento_tipo, documento_id) WHERE NOT es_copia;
CREATE INDEX trabajo_imp_documento_ix ON trabajo_de_impresion (empresa_id, documento_tipo, documento_id);

CREATE TABLE intento_de_impresion (                                    -- solo inserción
  empresa_id    uuid NOT NULL REFERENCES empresa (id),
  trabajo_id    uuid NOT NULL,
  numero        integer NOT NULL CONSTRAINT intento_numero_ck CHECK (numero BETWEEN 1 AND 1000),
  resultado     text NOT NULL CONSTRAINT intento_resultado_ck CHECK (resultado IN ('IMPRESA', 'FALLIDA')),
  declarado_por uuid NOT NULL REFERENCES persona (id),
  declarado_en  timestamptz NOT NULL,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intento_pkey PRIMARY KEY (empresa_id, trabajo_id, numero),
  CONSTRAINT intento_trabajo_fkey FOREIGN KEY (trabajo_id, empresa_id) REFERENCES trabajo_de_impresion (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- Disparadores: comandas
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION contador_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.ultimo <> 0 THEN
    RAISE EXCEPTION 'el contador de envíos de una cuenta arranca en 0'
      USING ERRCODE = '23514', CONSTRAINT = 'contador_alta_invalida';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION contador_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'la identidad del contador de envíos no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'contador_inmutable';
  END IF;
  IF NEW.ultimo <> OLD.ultimo + 1 THEN
    RAISE EXCEPTION 'el contador de envíos solo sube de a uno'
      USING ERRCODE = '23514', CONSTRAINT = 'contador_solo_sube_de_a_uno';
  END IF;
  RETURN NEW;
END
$$;

-- S4: al confirmar, los envíos de la cuenta son exactamente 1..ultimo: ni huecos ni números sin envío.
CREATE FUNCTION contador_sin_huecos() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_cuenta uuid;
  v_ultimo integer;
  v_cantidad integer;
BEGIN
  v_cuenta := NEW.cuenta_id;
  SELECT c.ultimo INTO v_ultimo FROM public.contador_de_envios c WHERE c.cuenta_id = v_cuenta AND c.empresa_id = NEW.empresa_id;
  SELECT count(*) INTO v_cantidad FROM public.envio_de_comanda e WHERE e.cuenta_id = v_cuenta AND e.empresa_id = NEW.empresa_id;
  IF v_ultimo IS NULL OR v_cantidad <> v_ultimo OR NOT EXISTS (
    SELECT 1 FROM public.envio_de_comanda e WHERE e.cuenta_id = v_cuenta AND e.empresa_id = NEW.empresa_id AND e.numero = v_ultimo
  ) THEN
    RAISE EXCEPTION 'los envíos de la cuenta no son 1..% sin huecos (hay %)', v_ultimo, v_cantidad
      USING ERRCODE = '23514', CONSTRAINT = 'contador_sin_huecos';
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION envio_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_cuenta public.cuenta_consumo%ROWTYPE;
  v_ultimo integer;
BEGIN
  SELECT * INTO v_cuenta FROM public.cuenta_consumo c WHERE c.id = NEW.cuenta_id AND c.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_cuenta.estado <> 'ABIERTA' OR v_cuenta.sucursal_id <> NEW.sucursal_id THEN
    RAISE EXCEPTION 'un envío es de una cuenta abierta y de su misma sucursal'
      USING ERRCODE = '23514', CONSTRAINT = 'envio_cuenta_invalida';
  END IF;
  -- El número lo dio el contador en esta misma transacción (la fila está bloqueada hasta el final).
  SELECT c.ultimo INTO v_ultimo FROM public.contador_de_envios c WHERE c.cuenta_id = NEW.cuenta_id AND c.empresa_id = NEW.empresa_id;
  IF v_ultimo IS DISTINCT FROM NEW.numero THEN
    RAISE EXCEPTION 'el envío toma el número que dio el contador (%)', v_ultimo
      USING ERRCODE = '23514', CONSTRAINT = 'envio_numero_del_contador';
  END IF;
  -- La fecha de negocio es la de la sucursal a la hora del envío: la fija la base, no la aplicación.
  NEW.fecha_negocio := public.fecha_de_negocio_de(NEW.empresa_id, NEW.sucursal_id, NEW.enviado_en);
  RETURN NEW;
END
$$;

CREATE FUNCTION renglon_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_envio public.envio_de_comanda%ROWTYPE;
  v_linea public.linea_cuenta%ROWTYPE;
BEGIN
  SELECT * INTO v_envio FROM public.envio_de_comanda e WHERE e.id = NEW.envio_id AND e.empresa_id = NEW.empresa_id AND e.xmin = pg_current_xact_id()::xid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'los renglones de un envío entran con el envío, en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_solo_con_el_envio';
  END IF;
  SELECT * INTO v_linea FROM public.linea_cuenta l WHERE l.id = NEW.linea_id AND l.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_linea.cuenta_id <> v_envio.cuenta_id OR NEW.cantidad > v_linea.cantidad THEN
    RAISE EXCEPTION 'un renglón es de una línea de la cuenta del envío y no excede su cantidad'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_linea_ajena';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION linea_de_comanda_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_linea public.linea_cuenta%ROWTYPE;
  v_origen uuid;
  v_envio_origen uuid;
  v_envio public.envio_de_comanda%ROWTYPE;
BEGIN
  SELECT * INTO v_linea FROM public.linea_cuenta l WHERE l.id = NEW.linea_id AND l.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_linea.cuenta_id <> NEW.cuenta_id OR v_linea.estado <> 'VIGENTE' THEN
    RAISE EXCEPTION 'el estado de comanda es de una línea vigente de su cuenta'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_linea_invalida';
  END IF;
  IF NEW.envio_id IS NOT NULL THEN
    -- Una línea nace ya enviada solo si es la copia de una ya enviada (unir, dividir, anular una parte): conserva su envío.
    SELECT c.linea_origen_id INTO v_origen FROM public.linea_copiada c WHERE c.linea_nueva_id = NEW.linea_id AND c.empresa_id = NEW.empresa_id;
    SELECT d.envio_id INTO v_envio_origen FROM public.linea_de_comanda d WHERE d.linea_id = v_origen AND d.empresa_id = NEW.empresa_id;
    IF v_origen IS NULL OR v_envio_origen IS DISTINCT FROM NEW.envio_id THEN
      RAISE EXCEPTION 'una línea nace sin enviar, salvo la copia de una ya enviada'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_alta_invalida';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION linea_de_comanda_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_envio public.envio_de_comanda%ROWTYPE;
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.linea_id IS DISTINCT FROM OLD.linea_id OR NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'la identidad del estado de comanda no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_inmutable';
  END IF;
  -- S4: el envío se fija una sola vez, y la salida solo cambia mientras la línea no se envió.
  IF OLD.envio_id IS NOT NULL THEN
    RAISE EXCEPTION 'una línea ya enviada no cambia su envío ni su salida'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_ya_enviada';
  END IF;
  IF NEW.envio_id IS NOT NULL THEN
    SELECT * INTO v_envio FROM public.envio_de_comanda e WHERE e.id = NEW.envio_id AND e.empresa_id = NEW.empresa_id AND e.xmin = pg_current_xact_id()::xid;
    IF NOT FOUND OR v_envio.cuenta_id <> OLD.cuenta_id THEN
      RAISE EXCEPTION 'la línea se envía en un envío de su cuenta, creado en esta transacción'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_envio_invalido';
    END IF;
    IF NEW.salida IS DISTINCT FROM OLD.salida THEN
      RAISE EXCEPTION 'al enviar una línea no se cambia su salida'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_ya_enviada';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION trabajo_de_impresion_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.estado <> 'PENDIENTE' OR NEW.intentos <> 1 THEN
    RAISE EXCEPTION 'un trabajo de impresión nace pendiente, en su primer intento'
      USING ERRCODE = '23514', CONSTRAINT = 'trabajo_alta_invalida';
  END IF;
  IF NEW.impresora_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.impresora i WHERE i.id = NEW.impresora_id AND i.empresa_id = NEW.empresa_id AND i.sucursal_id = NEW.sucursal_id
  ) THEN
    RAISE EXCEPTION 'la impresora es de otra sucursal que el trabajo'
      USING ERRCODE = '23514', CONSTRAINT = 'trabajo_impresora_de_otra_sucursal';
  END IF;
  RETURN NEW;
END
$$;

-- El estado del trabajo solo se mueve así: PENDIENTE → IMPRESA | FALLIDA (por un intento declarado) y FALLIDA → PENDIENTE con un intento más
-- («Reintentar»: el mismo trabajo). IMPRESA es final.
CREATE FUNCTION trabajo_de_impresion_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id
     OR NEW.impresora_id IS DISTINCT FROM OLD.impresora_id OR NEW.documento_tipo IS DISTINCT FROM OLD.documento_tipo
     OR NEW.documento_id IS DISTINCT FROM OLD.documento_id OR NEW.es_copia IS DISTINCT FROM OLD.es_copia OR NEW.clave IS DISTINCT FROM OLD.clave
     OR NEW.huella IS DISTINCT FROM OLD.huella OR NEW.solicitado_por IS DISTINCT FROM OLD.solicitado_por
     OR NEW.solicitado_en IS DISTINCT FROM OLD.solicitado_en OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'un trabajo de impresión no cambia lo que se pidió'
      USING ERRCODE = '23514', CONSTRAINT = 'trabajo_inmutable';
  END IF;
  IF NOT ((OLD.estado = 'PENDIENTE' AND NEW.estado IN ('IMPRESA', 'FALLIDA') AND NEW.intentos = OLD.intentos)
          OR (OLD.estado = 'FALLIDA' AND NEW.estado = 'PENDIENTE' AND NEW.intentos = OLD.intentos + 1)) THEN
    RAISE EXCEPTION 'el trabajo no puede pasar de % a % (intentos % a %)', OLD.estado, NEW.estado, OLD.intentos, NEW.intentos
      USING ERRCODE = '23514', CONSTRAINT = 'trabajo_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

-- Un intento declara el resultado de uno de los intentos pedidos; el trabajo toma el resultado del intento en curso.
CREATE FUNCTION intento_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_trabajo public.trabajo_de_impresion%ROWTYPE;
BEGIN
  SELECT * INTO v_trabajo FROM public.trabajo_de_impresion t WHERE t.id = NEW.trabajo_id AND t.empresa_id = NEW.empresa_id FOR UPDATE;
  IF NOT FOUND OR NEW.numero > v_trabajo.intentos THEN
    RAISE EXCEPTION 'el intento % no fue pedido (el trabajo va por el %)', NEW.numero, v_trabajo.intentos
      USING ERRCODE = '23514', CONSTRAINT = 'intento_no_pedido';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION intento_mueve_el_trabajo() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  UPDATE public.trabajo_de_impresion t SET estado = NEW.resultado
   WHERE t.id = NEW.trabajo_id AND t.empresa_id = NEW.empresa_id AND t.intentos = NEW.numero AND t.estado = 'PENDIENTE';
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Disparadores: alta, cambio, versión y solo inserción / sin borrado
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER mesa_cambio BEFORE UPDATE ON mesa FOR EACH ROW EXECUTE FUNCTION mesa_validar_cambio();
CREATE TRIGGER mesa_version BEFORE UPDATE ON mesa FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER mesa_celda_alta BEFORE INSERT OR UPDATE ON mesa_celda FOR EACH ROW EXECUTE FUNCTION mesa_celda_validar();
CREATE CONSTRAINT TRIGGER mesa_celdas_de_la_mesa AFTER INSERT OR UPDATE ON mesa
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mesa_celdas_cuadran();
CREATE CONSTRAINT TRIGGER mesa_celdas_de_la_celda AFTER INSERT OR UPDATE ON mesa_celda
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mesa_celdas_cuadran();
CREATE CONSTRAINT TRIGGER division_partes_de_la_division AFTER INSERT ON division_de_cuenta
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION division_partes_cuadran();
CREATE CONSTRAINT TRIGGER division_partes_de_la_parte AFTER INSERT ON parte_de_division
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION division_partes_cuadran();

CREATE TRIGGER contador_alta BEFORE INSERT ON contador_de_envios FOR EACH ROW EXECUTE FUNCTION contador_validar_alta();
CREATE TRIGGER contador_cambio BEFORE UPDATE ON contador_de_envios FOR EACH ROW EXECUTE FUNCTION contador_validar_cambio();
CREATE TRIGGER contador_version BEFORE UPDATE ON contador_de_envios FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE CONSTRAINT TRIGGER contador_sin_huecos_del_contador AFTER UPDATE ON contador_de_envios
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION contador_sin_huecos();
CREATE CONSTRAINT TRIGGER contador_sin_huecos_del_envio AFTER INSERT ON envio_de_comanda
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION contador_sin_huecos();
CREATE TRIGGER envio_alta BEFORE INSERT ON envio_de_comanda FOR EACH ROW EXECUTE FUNCTION envio_validar_alta();
CREATE TRIGGER renglon_alta BEFORE INSERT ON renglon_de_envio FOR EACH ROW EXECUTE FUNCTION renglon_validar_alta();
CREATE TRIGGER linea_de_comanda_alta BEFORE INSERT ON linea_de_comanda FOR EACH ROW EXECUTE FUNCTION linea_de_comanda_validar_alta();
CREATE TRIGGER linea_de_comanda_cambio BEFORE UPDATE ON linea_de_comanda FOR EACH ROW EXECUTE FUNCTION linea_de_comanda_validar_cambio();
CREATE TRIGGER linea_de_comanda_version BEFORE UPDATE ON linea_de_comanda FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER impresora_version BEFORE UPDATE ON impresora FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER trabajo_alta BEFORE INSERT ON trabajo_de_impresion FOR EACH ROW EXECUTE FUNCTION trabajo_de_impresion_validar_alta();
CREATE TRIGGER trabajo_cambio BEFORE UPDATE ON trabajo_de_impresion FOR EACH ROW EXECUTE FUNCTION trabajo_de_impresion_validar_cambio();
CREATE TRIGGER trabajo_version BEFORE UPDATE ON trabajo_de_impresion FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER intento_alta BEFORE INSERT ON intento_de_impresion FOR EACH ROW EXECUTE FUNCTION intento_validar_alta();
CREATE TRIGGER intento_mueve AFTER INSERT ON intento_de_impresion FOR EACH ROW EXECUTE FUNCTION intento_mueve_el_trabajo();

CREATE TRIGGER mesa_sin_borrado BEFORE DELETE ON mesa FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER mesa_sin_truncate BEFORE TRUNCATE ON mesa FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER mesa_celda_sin_borrado BEFORE DELETE ON mesa_celda FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER mesa_celda_sin_truncate BEFORE TRUNCATE ON mesa_celda FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER contador_sin_borrado BEFORE DELETE ON contador_de_envios FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER contador_sin_truncate BEFORE TRUNCATE ON contador_de_envios FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER linea_de_comanda_sin_borrado BEFORE DELETE ON linea_de_comanda FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER linea_de_comanda_sin_truncate BEFORE TRUNCATE ON linea_de_comanda FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER impresora_sin_borrado BEFORE DELETE ON impresora FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER impresora_sin_truncate BEFORE TRUNCATE ON impresora FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER trabajo_sin_borrado BEFORE DELETE ON trabajo_de_impresion FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER trabajo_sin_truncate BEFORE TRUNCATE ON trabajo_de_impresion FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

CREATE TRIGGER union_solo_insercion BEFORE UPDATE OR DELETE ON union_de_mesas FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER union_sin_truncate BEFORE TRUNCATE ON union_de_mesas FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER linea_unida_solo_insercion BEFORE UPDATE OR DELETE ON linea_unida FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER linea_unida_sin_truncate BEFORE TRUNCATE ON linea_unida FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER division_solo_insercion BEFORE UPDATE OR DELETE ON division_de_cuenta FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER division_sin_truncate BEFORE TRUNCATE ON division_de_cuenta FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER parte_solo_insercion BEFORE UPDATE OR DELETE ON parte_de_division FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER parte_sin_truncate BEFORE TRUNCATE ON parte_de_division FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER envio_solo_insercion BEFORE UPDATE OR DELETE ON envio_de_comanda FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER envio_sin_truncate BEFORE TRUNCATE ON envio_de_comanda FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER renglon_solo_insercion BEFORE UPDATE OR DELETE ON renglon_de_envio FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER renglon_sin_truncate BEFORE TRUNCATE ON renglon_de_envio FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER aviso_solo_insercion BEFORE UPDATE OR DELETE ON aviso_de_anulacion FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER aviso_sin_truncate BEFORE TRUNCATE ON aviso_de_anulacion FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER intento_solo_insercion BEFORE UPDATE OR DELETE ON intento_de_impresion FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER intento_sin_truncate BEFORE TRUNCATE ON intento_de_impresion FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE. Solo la aplicación (la plataforma, el grupo y los trabajos, nada).
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON mesa, mesa_celda, union_de_mesas, linea_unida, division_de_cuenta, parte_de_division, contador_de_envios, envio_de_comanda,
  renglon_de_envio, linea_de_comanda, aviso_de_anulacion, impresora, trabajo_de_impresion, intento_de_impresion FROM PUBLIC;
GRANT SELECT ON mesa, mesa_celda, union_de_mesas, linea_unida, division_de_cuenta, parte_de_division, contador_de_envios, envio_de_comanda,
  renglon_de_envio, linea_de_comanda, aviso_de_anulacion, impresora, trabajo_de_impresion, intento_de_impresion TO pedernal_app;

GRANT INSERT (id, empresa_id, sucursal_id, numero, forma, tamano, columna, fila, creada_por, creada_en) ON mesa TO pedernal_app;
GRANT UPDATE (numero, forma, tamano, columna, fila, activa) ON mesa TO pedernal_app;
GRANT INSERT (empresa_id, sucursal_id, mesa_id, columna, fila) ON mesa_celda TO pedernal_app;
GRANT UPDATE (activa) ON mesa_celda TO pedernal_app;
GRANT INSERT (id, empresa_id, sucursal_id, cuenta_destino_id, mesa_destino_id, cuenta_origen_id, mesa_origen_id, clave, unida_por, unida_en)
  ON union_de_mesas TO pedernal_app;
GRANT INSERT (empresa_id, linea_id, union_id, mesa_origen_id) ON linea_unida TO pedernal_app;
GRANT INSERT (id, empresa_id, sucursal_id, cuenta_madre_id, mesa_id, partes, dividida_por, dividida_en) ON division_de_cuenta TO pedernal_app;
GRANT INSERT (empresa_id, division_id, numero, cuenta_id) ON parte_de_division TO pedernal_app;

GRANT INSERT (empresa_id, cuenta_id) ON contador_de_envios TO pedernal_app;
GRANT UPDATE (ultimo) ON contador_de_envios TO pedernal_app;
-- `fecha_negocio` no se concede: la fija el disparador.
GRANT INSERT (id, empresa_id, sucursal_id, cuenta_id, numero, tipo, rotulo, enviado_por, enviado_en, clave, huella) ON envio_de_comanda TO pedernal_app;
GRANT INSERT (empresa_id, envio_id, orden, linea_id, cantidad, rol, nombre_de_cocina, detalle_de_cocina) ON renglon_de_envio TO pedernal_app;
GRANT INSERT (empresa_id, linea_id, cuenta_id, salida, envio_id) ON linea_de_comanda TO pedernal_app;
GRANT UPDATE (salida, envio_id) ON linea_de_comanda TO pedernal_app;
GRANT INSERT (id, empresa_id, cuenta_id, linea_origen_id, envio_id, cantidad, quedan, motivo, nombre_de_cocina, detalle_de_cocina, rotulo, anulado_por, anulado_en)
  ON aviso_de_anulacion TO pedernal_app;
GRANT INSERT (id, empresa_id, sucursal_id, nombre, uso, papel_mm, creada_por, creada_en) ON impresora TO pedernal_app;
GRANT UPDATE (nombre, uso, papel_mm, activa) ON impresora TO pedernal_app;
GRANT INSERT (id, empresa_id, sucursal_id, impresora_id, documento_tipo, documento_id, es_copia, clave, huella, solicitado_por, solicitado_en)
  ON trabajo_de_impresion TO pedernal_app;
GRANT UPDATE (estado, intentos) ON trabajo_de_impresion TO pedernal_app;
GRANT INSERT (empresa_id, trabajo_id, numero, resultado, declarado_por, declarado_en) ON intento_de_impresion TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada; sin política no hay acceso (el dueño de la base tampoco ve nada sin BYPASSRLS)
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['mesa', 'mesa_celda', 'union_de_mesas', 'linea_unida', 'division_de_cuenta', 'parte_de_division', 'contador_de_envios',
                                 'envio_de_comanda', 'renglon_de_envio', 'linea_de_comanda', 'aviso_de_anulacion', 'impresora', 'trabajo_de_impresion',
                                 'intento_de_impresion'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pedernal_app USING (empresa_id = (SELECT app_empresa_id()))', v_tabla || '_app_leer', v_tabla);
  END LOOP;
END
$$;

-- Alta: la empresa del contexto opera y, donde hay persona, es la del contexto. Cambiar: la empresa del contexto opera.
CREATE POLICY mesa_app_alta ON mesa FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND creada_por = (SELECT app_persona_id()));
CREATE POLICY mesa_app_cambiar ON mesa FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY mesa_celda_app_alta ON mesa_celda FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY mesa_celda_app_cambiar ON mesa_celda FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY union_de_mesas_app_alta ON union_de_mesas FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND unida_por = (SELECT app_persona_id()));
CREATE POLICY linea_unida_app_alta ON linea_unida FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY division_de_cuenta_app_alta ON division_de_cuenta FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND dividida_por = (SELECT app_persona_id()));
CREATE POLICY parte_de_division_app_alta ON parte_de_division FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY contador_de_envios_app_alta ON contador_de_envios FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY contador_de_envios_app_cambiar ON contador_de_envios FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY envio_de_comanda_app_alta ON envio_de_comanda FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND enviado_por = (SELECT app_persona_id()));
CREATE POLICY renglon_de_envio_app_alta ON renglon_de_envio FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY linea_de_comanda_app_alta ON linea_de_comanda FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY linea_de_comanda_app_cambiar ON linea_de_comanda FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY aviso_de_anulacion_app_alta ON aviso_de_anulacion FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND anulado_por = (SELECT app_persona_id()));
CREATE POLICY impresora_app_alta ON impresora FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND creada_por = (SELECT app_persona_id()));
CREATE POLICY impresora_app_cambiar ON impresora FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY trabajo_de_impresion_app_alta ON trabajo_de_impresion FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND solicitado_por = (SELECT app_persona_id()));
CREATE POLICY trabajo_de_impresion_app_cambiar ON trabajo_de_impresion FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY intento_de_impresion_app_alta ON intento_de_impresion FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND declarado_por = (SELECT app_persona_id()));
