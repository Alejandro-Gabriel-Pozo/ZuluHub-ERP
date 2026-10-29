-- 0017_comprobante_sucursal_abierta: una sucursal CERRADA no emite (D-50, decisión del dueño del 2026-10-29: «No, una sucursal
-- cerrada no emite»; `facturador-contratos-de-pantalla.md`). Hasta hoy desactivar una sucursal no apagaba sus puntos de venta y el
-- alta del comprobante no miraba la sucursal: un punto de venta ACTIVO de una sucursal cerrada seguía emitiendo.
--
-- Reglas de esta migración (las mismas de 0001 a 0016):
--  * Es ADITIVA: reemplaza UNA función (`comprobante_validar_alta`, la de 0016 con un agregado) y nada más. No toca ninguna tabla,
--    columna, fila, privilegio ni disparador, y no agrega funciones SECURITY DEFINER. NO es destructiva: los comprobantes que ya
--    existen no se vuelven a validar (el disparador corre solo al INSERT) y los puntos de venta no se desactivan. Su reversión es un
--    script aparte (`migraciones/reversiones/0017_revertir_comprobante_sucursal_abierta.sql`) que devuelve la función de 0016; el
--    ejecutor no lo aplica.
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro).
--  * DEPENDE de 0016 (la función que reemplaza y la columna `comprobante.sucursal_id`); se comprueba al empezar.
--
-- Decisión de diseño (probada por tests con dos conexiones en los dos órdenes, contra `pg_stat_activity`):
--
--  A1. El BLOQUEO está en la base, no en la aplicación: la regla de bloqueos del repositorio es «el disparador de alta toma FOR SHARE
--      sobre el padre que mira» (ADR-004: sin FOR UPDATE como mecanismo general; el mismo patrón de `punto_de_venta` en 0009 y 0016,
--      de `tenant` en `empresa_validar_alta` y de la sucursal en la sesión de caja). La aplicación TAMBIÉN pregunta (para dar el
--      error de negocio `SUCURSAL_CERRADA` sin esperar a la base), pero esa lectura sola no frena la carrera: bajo serializable una
--      emisión que leyó la sucursal abierta podía confirmar después de que su cierre confirmó (el orden «emisión, cierre» es
--      serializable, pero deja un comprobante nuevo en una sucursal ya cerrada). Con FOR SHARE el cierre concurrente espera.
--  A2. Sin privilegios nuevos: el rol de la aplicación ya tiene SELECT y UPDATE (nombre, activa) sobre `sucursal` (0001), que es lo
--      que FOR SHARE exige, y la política `sucursal_app_cambiar` ve las sucursales de su empresa.
--  A3. Sin ciclos de espera: el alta toma primero el punto de venta y después la sucursal (los dos con FOR SHARE). Cerrar una sucursal
--      (0005) toma el bloqueo consultivo de las bajas, la fila de esa sucursal y FOR SHARE de las OTRAS sucursales activas de la
--      empresa: nunca un punto de venta, así que no hay quien espere al alta mientras el alta lo espera. Mover un punto de venta toma el
--      punto de venta y mira la sucursal destino con FOR KEY SHARE, que no choca con FOR SHARE.
--  A4. Solo cuenta la sucursal del PUNTO DE VENTA con el que se emite, también en una nota: la sucursal de la factura que corrige (D-38
--      y D-40) puede estar cerrada y la nota se emite igual.

DO $$
BEGIN
  IF to_regprocedure('public.comprobante_validar_alta()') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.comprobante') AND attname = 'sucursal_id' AND NOT attisdropped
     ) THEN
    RAISE EXCEPTION 'la sucursal abierta para emitir requiere 0016_comprobante_con_sucursal aplicada antes (falta la sucursal del comprobante y su disparador de alta)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- El alta, con la sucursal del punto de venta bloqueada y abierta (A1). Es la función de 0016 con UN agregado (la declaración
-- `v_sucursal_abierta` y el bloque que sigue a la lectura del punto de venta). Todo lo demás, igual: los debilitamientos de 0009 y
-- 0016 buscan esos mismos textos.
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
  v_sucursal_abierta boolean;
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
    -- D-50: una sucursal cerrada no emite. La sucursal del punto de venta se bloquea con FOR SHARE ANTES de mirar si está abierta,
    -- como el punto de venta de arriba: quien la cierre a la vez (UPDATE de `activa`) espera a que esta transacción termine, o esta
    -- alta ve la sucursal ya cerrada (bajo serializable, la que llegó segunda repite y la encuentra cerrada). Sin este bloqueo una
    -- emisión que leyó la sucursal abierta podía confirmar DESPUÉS de que el cierre confirmó. Aplica a toda clase de comprobante: el
    -- que cuenta es la sucursal del PUNTO DE VENTA, no la del comprobante que una nota corrige (que puede estar cerrada, D-51).
    SELECT s.activa INTO v_sucursal_abierta
      FROM public.sucursal s
     WHERE s.id = v_pv.sucursal_id AND s.empresa_id = NEW.empresa_id
       FOR SHARE;
    IF FOUND AND NOT v_sucursal_abierta THEN
      RAISE EXCEPTION 'la sucursal del punto de venta está cerrada: no emite'
        USING ERRCODE = '23514', CONSTRAINT = 'comprobante_sucursal_cerrada';
    END IF;
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
