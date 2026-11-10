-- 0028_revertir_ventas: deshace la migración 0028_ventas (las once tablas de la cuenta y el ticket interno: cuenta_consumo,
-- linea_cuenta, linea_cuenta_opcion, numerador_ticket, ticket, ticket_ejemplar, ejemplar_grupo, ejemplar_linea, cobranza_de_ticket,
-- aplicacion_de_cobro y ticket_correccion, con sus funciones y disparadores).
--
-- DESTRUCTIVA si hay datos: BORRA todas las cuentas, líneas, tickets, ejemplares, cobranzas y el numerador de cada sucursal, y eso NO SE
-- RECUPERA (un ticket emitido es un comprobante interno que el cliente pudo recibir, y reiniciar el numerador repetiría números). Hay que
-- AVISAR AL DUEÑO antes de correrla si hay alguna fila. Ojo con el código: el módulo `ventas` y su aporte al cierre del día leen esas
-- tablas; sin ellas fallan, así que conviene bajar primero ese código. Con 0029 aplicada, revertir ANTES 0029 (reversiones/
-- 0029_revertir_facturacion.sql): su puntero `documento_de_ticket` apunta a ticket y ejemplar, y sin CASCADE esta reversión falla.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay algún dato de ventas cargado
--     \i migraciones/reversiones/0028_revertir_ventas.sql
--     COMMIT;
--
-- Deja la base como estaba antes de 0028. No usa CASCADE: si otro objeto depende de una tabla (una clave foránea de una migración
-- posterior), el DROP falla y no se pierde nada. Solo borra su propia fila del registro `migracion`, para que la migración se pueda
-- volver a aplicar. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_tabla text;
  v_filas bigint;
  v_total bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con las tablas ya borradas (una repetición) no hay nada que contar.
  FOREACH v_tabla IN ARRAY ARRAY['cuenta_consumo', 'linea_cuenta', 'linea_cuenta_opcion', 'numerador_ticket', 'ticket', 'ticket_ejemplar',
                                 'ejemplar_grupo', 'ejemplar_linea', 'cobranza_de_ticket', 'aplicacion_de_cobro', 'ticket_correccion'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas de ventas (cuentas, líneas, tickets, numerador, cobranzas) que esta reversión borraría (no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los disparadores, las políticas y los privilegios caen con las tablas (DROP TABLE no dispara los de borrado). Orden inverso de las
-- claves foráneas.
DROP TABLE IF EXISTS ticket_correccion;
DROP TABLE IF EXISTS aplicacion_de_cobro;
DROP TABLE IF EXISTS cobranza_de_ticket;
DROP TABLE IF EXISTS ejemplar_linea;
DROP TABLE IF EXISTS ejemplar_grupo;
DROP TABLE IF EXISTS ticket_ejemplar;
DROP TABLE IF EXISTS ticket;
DROP TABLE IF EXISTS numerador_ticket;
DROP TABLE IF EXISTS linea_cuenta_opcion;
DROP TABLE IF EXISTS linea_cuenta;
DROP TABLE IF EXISTS cuenta_consumo;

DROP FUNCTION IF EXISTS correccion_validar_alta();
DROP FUNCTION IF EXISTS aplicacion_validar_alta();
DROP FUNCTION IF EXISTS cobranza_cuadra();
DROP FUNCTION IF EXISTS cobranza_validar_cambio();
DROP FUNCTION IF EXISTS cobranza_validar_alta();
DROP FUNCTION IF EXISTS ejemplar_cuadra();
DROP FUNCTION IF EXISTS ejemplar_hijo_validar_alta();
DROP FUNCTION IF EXISTS ejemplar_validar_alta();
DROP FUNCTION IF EXISTS ticket_ejemplar_vigente_existe();
DROP FUNCTION IF EXISTS ticket_validar_cambio();
DROP FUNCTION IF EXISTS ticket_validar_alta();
DROP FUNCTION IF EXISTS numerador_sin_huecos();
DROP FUNCTION IF EXISTS numerador_validar_cambio();
DROP FUNCTION IF EXISTS numerador_validar_alta();
DROP FUNCTION IF EXISTS linea_opcion_validar_alta();
DROP FUNCTION IF EXISTS linea_precio_cuadra();
DROP FUNCTION IF EXISTS linea_validar_cambio();
DROP FUNCTION IF EXISTS linea_validar_alta();
DROP FUNCTION IF EXISTS cuenta_total_cuadra();
DROP FUNCTION IF EXISTS cuenta_validar_cambio();
DROP FUNCTION IF EXISTS cuenta_validar_alta();
DROP FUNCTION IF EXISTS fecha_de_negocio_de(uuid, uuid, timestamptz);

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_ventas.sql' ESCAPE '\';
  END IF;
END
$$;
