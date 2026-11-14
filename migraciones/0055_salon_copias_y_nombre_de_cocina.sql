-- 0055_salon_copias_y_nombre_de_cocina: dos correcciones de salón de la auditoría de reglas (INTEGRACION §5), en un solo archivo porque la segunda vuelve a reemplazar las
-- mismas funciones que la primera.
--
--  D2. `copias_cuadran` (0038) exige que la copia de una línea conserve lo congelado de la origen («no se recotiza»), pero 0047 sumó a lo congelado `departamento_id` y
--      `camino_de_clasificacion` (decisión 60: la clasificación se copia a la venta y no cambia) y el disparador no los miraba: solo lo garantizaba el código de `copiar-linea.ts`.
--      Previene: un traslado o una división que reclasifica en silencio lo ya vendido. Probado por `test/integracion/salon-copias-clasificacion.test.ts`.
--  D3. La comanda debe decir el NOMBRE DE COCINA (CYN 72, dueño, 08/11/2026: «en la comanda va el nombre de cocina… porque así se sabe qué stock descuento»; si el producto no lo
--      tiene, el comercial: catalogo-y-niveles-maqueta.md, «Si algo no tiene nombre de cocina, usa el comercial»). La línea de la cuenta no lo guardaba (solo `descripcion`, el
--      nombre comercial): se suma `linea_cuenta.nombre_de_cocina`, congelado al agregar la línea como el precio y la descripción, con la misma forma que su fuente
--      (`producto.nombre_de_cocina`: nulo o texto de catálogo de 1 a 80). Previene: la cocina lee el nombre del cliente en vez del suyo. Probado por
--      `test/integracion/comandas-nombre-de-cocina.test.ts`.
--
-- Reglas de esta migración (las mismas de 0036 y 0047):
--  * Es ADITIVA y compatible hacia atrás: una columna nullable (las líneas que ya existen quedan en NULL: la comanda usa entonces el nombre comercial, como hasta hoy; no hay de
--    dónde reconstruir lo que decía el producto al venderse) y dos funciones de disparador reemplazadas (`CREATE OR REPLACE`, misma firma, mismo `search_path`, mismos permisos y
--    mismos disparadores) que suman una comparación cada una. No se rellena ni se borra nada. Las copias ya hechas no se revalidan (el disparador corre al insertar).
--  * No agrega funciones SECURITY DEFINER ni cambia roles.
--  * Su reversión es `migraciones/reversiones/0055_revertir_salon_copias_y_nombre_de_cocina.sql` (DESTRUCTIVA si hay líneas con nombre de cocina: lo congelado no se
--    reconstruye). El ejecutor no la aplica.
-- DEPENDE de 0028, 0038 y 0047 (las versiones vigentes de las dos funciones); se comprueba al empezar.

DO $$
BEGIN
  IF to_regprocedure('public.copias_cuadran()') IS NULL OR to_regprocedure('public.linea_validar_cambio()') IS NULL OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'linea_cuenta' AND column_name = 'camino_de_clasificacion'
  ) THEN
    RAISE EXCEPTION 'esta migración requiere 0028_ventas, 0038_salon y 0047_camino_en_el_renglon aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'linea_cuenta' AND column_name = 'nombre_de_cocina'
  ) THEN
    RAISE EXCEPTION 'el nombre de cocina en la línea nace en 0055: la columna ya existe (alguien la creó a mano); hay que revisarla antes de migrar'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- D3. El nombre de cocina que tenía el producto al agregar la línea (nulo = el producto no tenía: la comanda usa `descripcion`).
ALTER TABLE linea_cuenta ADD COLUMN nombre_de_cocina text
  CONSTRAINT linea_nombre_de_cocina_ck CHECK (nombre_de_cocina IS NULL OR texto_de_catalogo_valido(nombre_de_cocina, 80));
-- Privilegio: INSERT por columna, como el resto de la línea (ningún UPDATE de esta columna).
GRANT INSERT (nombre_de_cocina) ON linea_cuenta TO pedernal_app;

-- D3. Cambio: lo sellado queda como está (el cuerpo vigente de 0047 más esta columna en lo inmutable).
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
     OR NEW.creada_en IS DISTINCT FROM OLD.creada_en OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
     OR NEW.departamento_id IS DISTINCT FROM OLD.departamento_id
     OR NEW.camino_de_clasificacion IS DISTINCT FROM OLD.camino_de_clasificacion
     OR NEW.nombre_de_cocina IS DISTINCT FROM OLD.nombre_de_cocina THEN
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

-- D2 y D3. La copia conserva lo congelado de la origen (el cuerpo de 0038 más departamento, camino y nombre de cocina).
CREATE OR REPLACE FUNCTION copias_cuadran() RETURNS trigger LANGUAGE plpgsql
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
            OR n.departamento_id IS DISTINCT FROM v_origen.departamento_id
            OR n.camino_de_clasificacion IS DISTINCT FROM v_origen.camino_de_clasificacion
            OR n.nombre_de_cocina IS DISTINCT FROM v_origen.nombre_de_cocina
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
