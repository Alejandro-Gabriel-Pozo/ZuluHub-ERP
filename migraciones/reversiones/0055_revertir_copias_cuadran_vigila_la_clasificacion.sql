-- 0055_revertir_copias_cuadran_vigila_la_clasificacion: deshace 0055 devolviendo `copias_cuadran` a la versión de 0038 (sin comparar departamento ni camino).
-- NO destruye datos: solo afloja un control. Aviso: con la versión de 0038 la base deja de impedir que una copia cambie la clasificación (queda solo el código de
-- `copiar-linea.ts`). Este script NO lo aplica el ejecutor: se corre a mano, revisado, en una transacción y con el rol dueño. Solo borra su propia fila del registro
-- `migracion` para poder volver a aplicar 0055. Se puede repetir sin que cambie nada.

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
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0055_copias_cuadran_vigila_la_clasificacion.sql';
  END IF;
END
$$;
