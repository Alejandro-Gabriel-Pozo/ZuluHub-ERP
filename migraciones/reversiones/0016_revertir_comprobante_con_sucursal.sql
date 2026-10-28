-- 0016_revertir_comprobante_con_sucursal: deshace la migración 0016_comprobante_con_sucursal (la columna
-- `comprobante.sucursal_id`, su clave foránea, su índice) y devuelve `comprobante_validar_alta` a su versión de 0009.
-- EL NÚMERO ES PROVISORIO, como el de la migración: se renumera junto con ella.
--
-- DESTRUCTIVA en lo único que agregó 0016: borra la sucursal guardada de cada comprobante. Esa sucursal NO se puede
-- recomputar después: si un punto de venta se mudó de sucursal tras emitir, el dato de dónde se emitió se pierde. No toca
-- ninguna otra columna ni fila. Hay que AVISAR AL DUEÑO antes de correrla si hay comprobantes. Ojo con el código: el
-- listado filtra por esa columna; sin ella la consulta falla, así que conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta
-- `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de la base (que evade RLS, o el
-- conteo de abajo no vería nada):
--
--     BEGIN;
--     SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay comprobantes
--     \i migraciones/reversiones/0016_revertir_comprobante_con_sucursal.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0015. No usa CASCADE: si otro objeto depende de la columna (una vista o una
-- restricción de una migración posterior), el DROP falla y no se pierde nada. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_datos bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el conteo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;

  -- Con la columna ya borrada (una repetición) no hay nada que contar.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.comprobante'::regclass AND attname = 'sucursal_id' AND NOT attisdropped
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.comprobante' INTO v_datos;
    IF v_datos > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
      RAISE EXCEPTION 'hay % comprobantes cuya sucursal esta reversión borraría (no se puede recomputar): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_datos
        USING ERRCODE = '55000';
    END IF;
  END IF;
END
$$;

-- La función primero: la de 0009 no nombra la columna, así que puede volver con la columna todavía puesta.
CREATE OR REPLACE FUNCTION comprobante_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_pv record;
  v_df record;
  v_cuit text;
  v_aso record;
BEGIN
  IF NEW.estado <> 'PENDIENTE' OR NEW.envios <> 0 THEN
    RAISE EXCEPTION 'un comprobante nace PENDIENTE y sin envíos'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
  END IF;

  -- Un punto de venta, unos datos fiscales o un emisor inexistentes (o de otra empresa) los rechazan las
  -- claves foráneas compuestas: acá solo se compara lo que existe.
  SELECT p.estado, p.numero, p.ambiente INTO v_pv
    FROM public.punto_de_venta p
   WHERE p.id = NEW.punto_de_venta_id AND p.empresa_id = NEW.empresa_id AND p.emisor_id = NEW.emisor_id
     FOR SHARE;
  IF FOUND AND (v_pv.estado <> 'ACTIVO' OR v_pv.numero <> NEW.punto_de_venta_numero
                OR v_pv.ambiente <> NEW.ambiente) THEN
    RAISE EXCEPTION 'el punto de venta no está activo, o su número o su ambiente no son los del comprobante'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
  END IF;

  SELECT d.estado, d.razon_social, d.condicion_iva, d.inicio_actividades, d.iibb_numero, d.iibb_condicion
    INTO v_df
    FROM public.datos_fiscales d
   WHERE d.id = NEW.datos_fiscales_id AND d.empresa_id = NEW.empresa_id AND d.emisor_id = NEW.emisor_id;
  IF FOUND AND (v_df.estado <> 'CONFIRMADA'
                OR v_df.razon_social IS DISTINCT FROM NEW.emisor_razon_social
                OR v_df.condicion_iva IS DISTINCT FROM NEW.emisor_condicion_iva
                OR v_df.inicio_actividades IS DISTINCT FROM NEW.emisor_inicio_actividades
                OR v_df.iibb_numero IS DISTINCT FROM NEW.emisor_iibb_numero
                OR v_df.iibb_condicion IS DISTINCT FROM NEW.emisor_iibb_condicion) THEN
    RAISE EXCEPTION 'la foto del emisor no coincide con sus datos fiscales confirmados'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
  END IF;

  -- El CUIT del emisor principal es el de la empresa (E1 de 0006).
  SELECT coalesce(x.cuit, e.cuit) INTO v_cuit
    FROM public.emisor x JOIN public.empresa e ON e.id = x.empresa_id
   WHERE x.id = NEW.emisor_id AND x.empresa_id = NEW.empresa_id;
  IF FOUND AND v_cuit IS DISTINCT FROM NEW.emisor_cuit THEN
    RAISE EXCEPTION 'el CUIT del comprobante no es el del emisor'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
  END IF;

  IF NEW.comprobante_asociado_id IS NOT NULL THEN
    SELECT a.estado, a.ambiente, a.clase, a.tipo_comprobante, a.receptor_documento_tipo, a.receptor_documento_numero
      INTO v_aso
      FROM public.comprobante a
     WHERE a.id = NEW.comprobante_asociado_id AND a.empresa_id = NEW.empresa_id AND a.emisor_id = NEW.emisor_id;
    IF FOUND AND (v_aso.estado <> 'AUTORIZADO'
                  OR v_aso.ambiente <> NEW.ambiente
                  OR v_aso.clase = 'NOTA_CREDITO'
                  OR right(v_aso.tipo_comprobante, 1) <> right(NEW.tipo_comprobante, 1)
                  OR v_aso.receptor_documento_tipo <> NEW.receptor_documento_tipo
                  OR v_aso.receptor_documento_numero IS DISTINCT FROM NEW.receptor_documento_numero) THEN
      RAISE EXCEPTION 'la nota no corresponde a su comprobante asociado (autorizado, mismo ambiente, misma letra, mismo receptor, y no una nota de crédito)'
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_asociado_invalido';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS comprobante_con_sucursal ON comprobante;
DROP FUNCTION IF EXISTS comprobante_exigir_sucursal();
ALTER TABLE comprobante DROP CONSTRAINT IF EXISTS comprobante_sucursal_fkey;
DROP INDEX IF EXISTS comprobante_sucursal_listado_ix;
ALTER TABLE comprobante DROP COLUMN IF EXISTS sucursal_id;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_comprobante_con_sucursal.sql' ESCAPE '\';
  END IF;
END
$$;
