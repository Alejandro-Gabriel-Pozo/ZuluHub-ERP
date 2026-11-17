-- 0027_revertir_caja: deshace la migración 0027_caja (las tablas de caja y cobros, las listas del sistema y la contribución de caja al
-- cierre del día, con sus disparadores, funciones, políticas, privilegios y el orden de comparación `valor_de_lista_nombre_ci`).
--
-- SOLO corre con TODAS las tablas de caja VACÍAS y las listas (`valor_de_lista`) tal como las dejó la migración (sus diez semillas, sin
-- un solo cambio ni valor agregado): una caja, un movimiento, un arqueo o una foto de cierre registran dinero y decisiones que NO se
-- pueden recomputar (especificación E3 §3.1: «bajada manual solo con tablas vacías»; con datos reales no se baja, se corrige hacia
-- adelante agregando columnas o valores). Si hay una sola fila en cualquiera, SE NIEGA a correr y no cambia nada; hay que decidir con el
-- dueño qué hacer con el historial ANTES, y este script no se fuerza. Ojo con el código: el módulo `caja` (y quien cobra, desde ventas)
-- lee estas tablas; sin ellas fallan, así que conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     \i migraciones/reversiones/0027_revertir_caja.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0026. No usa CASCADE: si otro objeto depende de estas tablas (una clave foránea o un
-- disparador de una migración posterior), el DROP falla y no se pierde nada. Solo borra su propia fila del registro `migracion`, para
-- que la migración se pueda volver a aplicar. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_tabla text;
  v_filas bigint;
  v_con_datos text := '';
  v_listas_tocadas bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con las tablas ya borradas (una repetición) no hay nada que contar.
  FOREACH v_tabla IN ARRAY ARRAY[
    'conciliacion_de_cobro_por_origen', 'conciliacion_de_jornada', 'cierre_de_caja_de_jornada', 'conforme_de_jornada',
    'declaracion_de_total', 'correccion_de_medio', 'arqueo_billete', 'arqueo_caja', 'cobro', 'movimiento_caja', 'sesion_caja',
    'cuenta_de_cobro', 'medio_de_pago', 'caja'
  ] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      IF v_filas > 0 THEN
        v_con_datos := v_con_datos || format(' %s (%s)', v_tabla, v_filas);
      END IF;
    END IF;
  END LOOP;
  IF v_con_datos <> '' THEN
    RAISE EXCEPTION 'hay datos guardados en:% : la reversión solo corre con las tablas vacías (avisar al dueño; el historial de caja no se recupera)', v_con_datos
      USING ERRCODE = '55000';
  END IF;

  -- Las listas: solo las semillas, intactas (la plataforma no agregó, cambió ni desactivó nada).
  IF to_regclass('public.valor_de_lista') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FROM public.valor_de_lista v
       WHERE v.version <> 1 OR NOT v.activo
          OR (v.lista, v.nombre, v.fija) NOT IN (
            ('MARCAS_DE_TARJETA', 'Visa', false), ('MARCAS_DE_TARJETA', 'Mastercard', false),
            ('MARCAS_DE_TARJETA', 'American Express', false), ('MARCAS_DE_TARJETA', 'Cabal', false),
            ('MARCAS_DE_TARJETA', 'Naranja X', false), ('MARCAS_DE_TARJETA', 'Otra', true),
            ('MOTIVOS_DE_RECHAZO', 'Temperatura', false), ('MOTIVOS_DE_RECHAZO', 'Envase dañado', false),
            ('MOTIVOS_DE_RECHAZO', 'Vencida', false), ('MOTIVOS_DE_RECHAZO', 'No es lo pedido', false))
    $q$ INTO v_listas_tocadas;
    EXECUTE 'SELECT count(*) FROM public.valor_de_lista' INTO v_filas;
    IF v_listas_tocadas > 0 OR v_filas > 10 THEN
      RAISE EXCEPTION 'las listas del sistema tienen cambios respecto de las semillas (% filas distintas, % en total): la reversión solo corre con las listas sin tocar', v_listas_tocadas, v_filas
        USING ERRCODE = '55000';
    END IF;
  END IF;
END
$$;

-- Los disparadores, las políticas y los privilegios caen con las tablas. Orden inverso al de la creación.
DROP TABLE IF EXISTS conciliacion_de_cobro_por_origen;
DROP TABLE IF EXISTS conciliacion_de_jornada;
DROP TABLE IF EXISTS cierre_de_caja_de_jornada;
DROP TABLE IF EXISTS conforme_de_jornada;
DROP TABLE IF EXISTS declaracion_de_total;
DROP TABLE IF EXISTS correccion_de_medio;
DROP TABLE IF EXISTS arqueo_billete;
DROP TABLE IF EXISTS arqueo_caja;
DROP TABLE IF EXISTS cobro;
DROP TABLE IF EXISTS valor_de_lista;
DROP TABLE IF EXISTS movimiento_caja;
DROP TABLE IF EXISTS sesion_caja;
DROP TABLE IF EXISTS cuenta_de_cobro;
DROP TABLE IF EXISTS medio_de_pago;
DROP TABLE IF EXISTS caja;

DROP COLLATION IF EXISTS valor_de_lista_nombre_ci;

DROP FUNCTION IF EXISTS cierre_de_caja_verificar();
DROP FUNCTION IF EXISTS conciliacion_de_cobro_validar_alta();
DROP FUNCTION IF EXISTS conciliacion_de_jornada_validar_alta();
DROP FUNCTION IF EXISTS cierre_de_caja_validar_alta();
DROP FUNCTION IF EXISTS conforme_de_jornada_validar_alta();
DROP FUNCTION IF EXISTS declaracion_de_total_validar_alta();
DROP FUNCTION IF EXISTS correccion_de_medio_validar_alta();
DROP FUNCTION IF EXISTS sesion_caja_verificar_cierre();
DROP FUNCTION IF EXISTS arqueo_verificar_sesion_cerrada();
DROP FUNCTION IF EXISTS arqueo_billete_validar_alta();
DROP FUNCTION IF EXISTS arqueo_caja_validar_alta();
DROP FUNCTION IF EXISTS cobro_validar_alta();
DROP FUNCTION IF EXISTS valor_de_lista_validar_cambio();
DROP FUNCTION IF EXISTS movimiento_caja_verificar_documento();
DROP FUNCTION IF EXISTS movimiento_caja_validar_alta();
DROP FUNCTION IF EXISTS sesion_caja_validar_cambio();
DROP FUNCTION IF EXISTS sesion_caja_validar_alta();
DROP FUNCTION IF EXISTS cuenta_de_cobro_validar_cambio();
DROP FUNCTION IF EXISTS medio_de_pago_validar_cambio();
DROP FUNCTION IF EXISTS caja_validar_cambio();
DROP FUNCTION IF EXISTS par_de_cobro_validar(text, uuid, uuid, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS cuenta_admitida_por_medio(text, text);
DROP FUNCTION IF EXISTS fecha_de_negocio(timestamptz, text, time);

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_caja.sql' ESCAPE '\';
  END IF;
END
$$;
