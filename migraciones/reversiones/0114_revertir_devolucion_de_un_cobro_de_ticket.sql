-- 0114_revertir_devolucion_de_un_cobro_de_ticket: deshace 0114. FRENA (55000) si ya hay devoluciones de una cobranza de ticket. AVISAR AL DUEÑO antes de correrla con datos.
-- Se corre en UNA sola transacción, con el dueño de la base (evade RLS: sin eso el conteo no vería las devoluciones de las empresas y la reversión pasaría con datos).
-- Restituye los dos cuerpos de 0091 tal cual estaban y la restricción original; se puede repetir sin que cambie nada.
DO $$
DECLARE
  v_devoluciones bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'movimiento_de_dinero' AND column_name = 'devuelve_origen_id') THEN
    EXECUTE 'SELECT count(*) FROM public.movimiento_de_dinero WHERE devuelve_origen_id IS NOT NULL' INTO v_devoluciones;
  END IF;
  IF v_devoluciones > 0 THEN
    RAISE EXCEPTION 'hay % devoluciones de una cobranza de ticket: no se revierte sin decisión del dueño', v_devoluciones USING ERRCODE = '55000';
  END IF;
END
$$;

-- Los cuerpos de 0091, byte a byte.
CREATE OR REPLACE FUNCTION movimiento_de_dinero_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_caja uuid;
  v_sucursal uuid;
  v_egreso record;
  v_entrada record;
BEGIN
  -- La sesión está abierta y es de esa sucursal (también cuando la salida es por un medio que no es efectivo: ahí es lo que obliga a tener caja
  -- abierta). La espera contra un cierre en vuelo la hacen los movimientos de caja que acompañan al acto (su disparador toma la sesión).
  SELECT s.estado, s.caja_id INTO v_estado, v_caja
    FROM public.sesion_caja s WHERE s.id = NEW.sesion_id AND s.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_estado <> 'ABIERTA' THEN
    RAISE EXCEPTION 'la sesión de caja no está abierta'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_sesion_no_abierta';
  END IF;
  SELECT c.sucursal_id INTO v_sucursal FROM public.caja c WHERE c.id = v_caja AND c.empresa_id = NEW.empresa_id;
  IF v_sucursal IS DISTINCT FROM NEW.sucursal_id THEN
    RAISE EXCEPTION 'la sesión de caja es de otra sucursal'
      USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_sucursal_invalida';
  END IF;

  IF NEW.sentido = 'SALIDA' THEN
    -- Su egreso: un EGRESO_MANUAL de esa sesión (la clave foránea compuesta ya la fija), con cualquier medio y por el mismo importe.
    SELECT m.clase, m.importe INTO v_egreso
      FROM public.movimiento_caja m
     WHERE m.id = NEW.movimiento_id AND m.empresa_id = NEW.empresa_id AND m.sesion_id = NEW.sesion_id;
    IF NOT FOUND OR v_egreso.clase <> 'EGRESO_MANUAL' OR v_egreso.importe <> -NEW.importe THEN
      RAISE EXCEPTION 'la salida tiene que apuntar a un egreso manual de la sesión por el mismo importe'
        USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_egreso_invalido';
    END IF;

    IF NEW.categoria = 'DEVOLUCION_DE_UN_COBRO' THEN
      SELECT d.sentido, d.sucursal_id INTO v_entrada
        FROM public.movimiento_de_dinero d WHERE d.id = NEW.devuelve_a AND d.empresa_id = NEW.empresa_id;
      IF NOT FOUND OR v_entrada.sentido <> 'ENTRADA' OR v_entrada.sucursal_id <> NEW.sucursal_id THEN
        RAISE EXCEPTION 'la devolución tiene que ser de una entrada de la misma empresa y sucursal'
          USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_devuelve_a_invalida';
      END IF;
      -- Tope: se bloquea la entrada y, con el bloqueo tomado, se mide lo devolvible (bajo READ COMMITTED la medición ve lo que confirmó quien
      -- esperaba; bajo SERIALIZABLE, el detector de anomalías aborta con 40001 a uno de los dos y el reintento ve el tope).
      PERFORM public.movimiento_de_dinero_bloquear_entrada(NEW.empresa_id, NEW.devuelve_a);
      IF public.movimiento_de_dinero_devolvible(NEW.empresa_id, NEW.devuelve_a) < NEW.importe THEN
        RAISE EXCEPTION 'la devolución supera lo cobrado de la entrada'
          USING ERRCODE = '23514', CONSTRAINT = 'devolucion_supera_lo_cobrado';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION movimiento_de_dinero_devolvible(p_empresa uuid, p_entrada uuid) RETURNS numeric LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT coalesce((SELECT sum(m.importe)
                     FROM public.cobro c
                     JOIN public.movimiento_caja m ON m.id = c.movimiento_id AND m.empresa_id = c.empresa_id
                    WHERE c.empresa_id = p_empresa AND c.origen_tipo = 'caja.movimiento_de_dinero' AND c.origen_id = p_entrada), 0)
       + coalesce((SELECT sum(a.importe)       -- las anulaciones llevan el importe con signo contrario
                     FROM public.cobro c
                     JOIN public.movimiento_caja a ON a.anula_a = c.movimiento_id AND a.empresa_id = c.empresa_id AND a.clase = 'ANULACION'
                    WHERE c.empresa_id = p_empresa AND c.origen_tipo = 'caja.movimiento_de_dinero' AND c.origen_id = p_entrada), 0)
       - coalesce((SELECT sum(d.importe)
                     FROM public.movimiento_de_dinero d
                    WHERE d.empresa_id = p_empresa AND d.devuelve_a = p_entrada
                      AND NOT EXISTS (SELECT 1 FROM public.movimiento_caja a
                                       WHERE a.empresa_id = d.empresa_id AND a.anula_a = d.movimiento_id AND a.clase = 'ANULACION')), 0)
$$;

DROP FUNCTION IF EXISTS public.movimiento_de_dinero_devolvible_de_origen(uuid, text, uuid);
ALTER TABLE IF EXISTS public.movimiento_de_dinero DROP CONSTRAINT IF EXISTS movimiento_de_dinero_devolucion_ck;
ALTER TABLE IF EXISTS public.movimiento_de_dinero
  DROP CONSTRAINT IF EXISTS movimiento_de_dinero_origen_par_ck,
  DROP CONSTRAINT IF EXISTS movimiento_de_dinero_origen_tipo_ck,
  DROP CONSTRAINT IF EXISTS movimiento_de_dinero_devolucion_id_ck,
  DROP CONSTRAINT IF EXISTS movimiento_de_dinero_entrada_sin_origen_ck;
DROP INDEX IF EXISTS public.movimiento_de_dinero_devuelve_origen_ix;
DROP INDEX IF EXISTS public.movimiento_de_dinero_devolucion_ix;
ALTER TABLE IF EXISTS public.movimiento_de_dinero
  DROP COLUMN IF EXISTS devuelve_origen_tipo,
  DROP COLUMN IF EXISTS devuelve_origen_id,
  DROP COLUMN IF EXISTS devolucion_id;
ALTER TABLE IF EXISTS public.movimiento_de_dinero ADD CONSTRAINT movimiento_de_dinero_devolucion_ck CHECK (
  (devuelve_a IS NOT NULL) = coalesce(categoria = 'DEVOLUCION_DE_UN_COBRO', false)
);
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0114_devolucion_de_un_cobro_de_ticket.sql';
  END IF;
END
$$;
