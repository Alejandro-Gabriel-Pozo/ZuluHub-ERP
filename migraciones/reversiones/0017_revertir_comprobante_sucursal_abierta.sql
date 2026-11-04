-- 0017_revertir_comprobante_sucursal_abierta: deshace la migración 0017_comprobante_sucursal_abierta y devuelve
-- `comprobante_validar_alta` a su versión de 0016 (sin mirar si la sucursal del punto de venta está abierta). Después de esto una
-- sucursal cerrada vuelve a poder emitir por sus puntos de venta activos (D-50 deja de cumplirse en la base).
--
-- NO ES DESTRUCTIVA: reemplaza una función y no toca ninguna tabla, columna ni fila de negocio (solo borra su propia fila del
-- registro `migracion`, para que 0017 pueda volver a aplicarse). No hace falta avisar al dueño por pérdida de
-- datos, pero sí de que la regla de «una sucursal cerrada no emite» queda sin el bloqueo de la base (la aplicación seguirá
-- rechazando por su lado mientras el código sea el nuevo; con el código viejo, no).
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`):
-- se corre a mano, revisado, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0017_revertir_comprobante_sucursal_abierta.sql
--     COMMIT;
--
-- Deja el catálogo como estaba después de 0016. Se puede repetir sin que cambie nada.

CREATE OR REPLACE FUNCTION comprobante_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_pv record;
  v_df record;
  v_cuit text;
  v_aso record;
  v_sucursal uuid;
  v_sucursal_aso uuid;
BEGIN
  IF NEW.estado <> 'PENDIENTE' OR NEW.envios <> 0 THEN
    RAISE EXCEPTION 'un comprobante nace PENDIENTE y sin envíos'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
  END IF;

  -- Un punto de venta, unos datos fiscales o un emisor inexistentes (o de otra empresa) los rechazan las
  -- claves foráneas compuestas: acá solo se compara lo que existe.
  SELECT p.estado, p.numero, p.ambiente, p.sucursal_id INTO v_pv
    FROM public.punto_de_venta p
   WHERE p.id = NEW.punto_de_venta_id AND p.empresa_id = NEW.empresa_id AND p.emisor_id = NEW.emisor_id
     FOR SHARE;
  IF FOUND AND (v_pv.estado <> 'ACTIVO' OR v_pv.numero <> NEW.punto_de_venta_numero
                OR v_pv.ambiente <> NEW.ambiente) THEN
    RAISE EXCEPTION 'el punto de venta no está activo, o su número o su ambiente no son los del comprobante'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
  END IF;
  -- La sucursal del comprobante es la de su punto de venta EN ESTE MOMENTO, leída con el bloqueo FOR SHARE de arriba: quien
  -- mueva el punto de venta a otra sucursal espera a que esta transacción termine, así que no hay una sucursal leída y otra
  -- al confirmar. Se fija al final de la función (una nota de crédito toma la de la factura que corrige, D-38).
  IF FOUND THEN
    v_sucursal := v_pv.sucursal_id;
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
    SELECT a.estado, a.ambiente, a.clase, a.tipo_comprobante, a.receptor_documento_tipo, a.receptor_documento_numero,
           a.sucursal_id
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
    -- La nota lleva la sucursal del comprobante que corrige o aumenta (D-38 y D-40), leída en la MISMA lectura de arriba.
    IF FOUND THEN
      v_sucursal_aso := v_aso.sucursal_id;
    END IF;
  END IF;

  -- La sucursal (S1 y S6). Sin punto de venta (inexistente, de otro emisor o de otra empresa) no hay nada que copiar: la fila no
  -- puede quedar (la clave foránea del punto de venta la rechaza, y la política antes que ella si es de otra empresa) y esos
  -- errores siguen siendo los de siempre. Una NOTA (de crédito o de débito) lleva la sucursal del comprobante que corrige o
  -- aumenta, que no cambia nunca (D-38 y D-40); una factura, la de su punto de venta. Nadie la elige: la aplicación no la manda
  -- (no tiene INSERT sobre la columna) y, si el dueño de la base manda una, tiene que ser esa.
  IF v_sucursal IS NOT NULL THEN
    IF v_sucursal_aso IS NOT NULL THEN
      v_sucursal := v_sucursal_aso;
    END IF;
    IF NEW.sucursal_id IS NOT NULL AND NEW.sucursal_id <> v_sucursal THEN
      RAISE EXCEPTION 'la sucursal del comprobante no es la que le corresponde (la de su punto de venta, o la del comprobante que corrige una nota)'
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_alta_invalida';
    END IF;
    NEW.sucursal_id := v_sucursal;
  END IF;
  RETURN NEW;
END
$$;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla (y la guarda MIGRACION_REQUERIDA='0017'
-- dejaría pasar código nuevo sobre una base sin el bloqueo).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_comprobante_sucursal_abierta.sql' ESCAPE '\';
  END IF;
END
$$;
