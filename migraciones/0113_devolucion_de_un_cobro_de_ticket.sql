-- 0113_devolucion_de_un_cobro_de_ticket: DM-1, la base de la devolución con medio de un cobro de ticket (PR-DM-1).
-- QUÉ HACE:
--   1. Tres columnas NULL en `movimiento_de_dinero` (`devuelve_origen_tipo`, `devuelve_origen_id`, `devolucion_id`) con su privilegio de inserción por columna:
--      una devolución puede citar la COBRANZA de un ticket (además de la entrada de dinero de 0091) y varias líneas (una por medio) comparten un `devolucion_id`.
--   2. Restricciones con nombre propio; la de 0091 `movimiento_de_dinero_devolucion_ck` se reemplaza (la categoría es la devolución si y solo si cita
--      exactamente UNA cosa: una entrada o una cobranza). Dos índices parciales.
--   3. UNA sola regla del tope: `movimiento_de_dinero_devolvible_de_origen(empresa, tipo, id)`; `movimiento_de_dinero_devolvible(empresa, entrada)` pasa a ser su envoltorio
--      con `caja.movimiento_de_dinero` (el tope de las entradas no cambia ni un centavo).
--   4. NO ADITIVO (AVISO, como el AVISO 3 de 0091): reemplaza, con DOS `CREATE OR REPLACE`, `movimiento_de_dinero_devolvible` (envoltorio) y
--      `movimiento_de_dinero_validar_alta` (el cuerpo vigente de 0091, el único que lo define, más la rama «DM-1» para la cobranza; el resto, igual).
-- NO TOCA datos: nadie escribe todavía las columnas nuevas (DM-2). No edita 0091.
-- Reversión: `migraciones/reversiones/0113_revertir_devolucion_de_un_cobro_de_ticket.sql` — FRENA si hay devoluciones de cobranza (no revertir con datos; AVISAR AL DUEÑO).
-- DEPENDE de 0027 (caja, cobro) y 0091. Solo corre contra el Postgres local de las pruebas; nunca contra Neon.

ALTER TABLE movimiento_de_dinero
  ADD COLUMN devuelve_origen_tipo text,
  ADD COLUMN devuelve_origen_id   uuid,
  ADD COLUMN devolucion_id        uuid;

ALTER TABLE movimiento_de_dinero
  ADD CONSTRAINT movimiento_de_dinero_origen_par_ck CHECK ((devuelve_origen_tipo IS NULL) = (devuelve_origen_id IS NULL)),
  -- Lista cerrada: otro origen devolvible se agrega con otra migración chica.
  ADD CONSTRAINT movimiento_de_dinero_origen_tipo_ck CHECK (devuelve_origen_tipo IS NULL OR devuelve_origen_tipo = 'ventas.cobranza_de_ticket'),
  ADD CONSTRAINT movimiento_de_dinero_devolucion_id_ck CHECK ((devolucion_id IS NOT NULL) = (devuelve_origen_id IS NOT NULL)),
  -- La entrada no lleva las columnas nuevas (`movimiento_de_dinero_forma_ck` no se toca).
  ADD CONSTRAINT movimiento_de_dinero_entrada_sin_origen_ck CHECK (sentido = 'SALIDA' OR (devuelve_origen_id IS NULL AND devolucion_id IS NULL));

-- Reemplaza la de 0091: la categoría es la devolución si y solo si cita exactamente uno de `devuelve_a` (una entrada) y `devuelve_origen_id` (una cobranza).
-- Con `coalesce`, una fila sin categoría (la entrada) se juzga como «no es devolución» y no pasa por un NULL.
ALTER TABLE movimiento_de_dinero DROP CONSTRAINT movimiento_de_dinero_devolucion_ck;
ALTER TABLE movimiento_de_dinero ADD CONSTRAINT movimiento_de_dinero_devolucion_ck CHECK (
  coalesce(categoria = 'DEVOLUCION_DE_UN_COBRO', false) = ((devuelve_a IS NOT NULL) <> (devuelve_origen_id IS NOT NULL))
);

CREATE INDEX movimiento_de_dinero_devuelve_origen_ix ON movimiento_de_dinero (empresa_id, devuelve_origen_tipo, devuelve_origen_id)
  WHERE devuelve_origen_id IS NOT NULL;
CREATE INDEX movimiento_de_dinero_devolucion_ix ON movimiento_de_dinero (empresa_id, devolucion_id) WHERE devolucion_id IS NOT NULL;

GRANT INSERT (devuelve_origen_tipo, devuelve_origen_id, devolucion_id) ON movimiento_de_dinero TO pedernal_app;

-- La regla única del tope: lo devolvible de un ORIGEN (una entrada de dinero o una cobranza) = lo cobrado − lo anulado de sus cobros − lo ya devuelto (devoluciones
-- vigentes que lo citan: su egreso no está anulado).
CREATE FUNCTION movimiento_de_dinero_devolvible_de_origen(p_empresa uuid, p_tipo text, p_id uuid) RETURNS numeric LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT coalesce((SELECT sum(m.importe)
                     FROM public.cobro c
                     JOIN public.movimiento_caja m ON m.id = c.movimiento_id AND m.empresa_id = c.empresa_id
                    WHERE c.empresa_id = p_empresa AND c.origen_tipo = p_tipo AND c.origen_id = p_id), 0)
       + coalesce((SELECT sum(a.importe)       -- las anulaciones llevan el importe con signo contrario
                     FROM public.cobro c
                     JOIN public.movimiento_caja a ON a.anula_a = c.movimiento_id AND a.empresa_id = c.empresa_id AND a.clase = 'ANULACION'
                    WHERE c.empresa_id = p_empresa AND c.origen_tipo = p_tipo AND c.origen_id = p_id), 0)
       - coalesce((SELECT sum(d.importe)
                     FROM public.movimiento_de_dinero d
                    WHERE d.empresa_id = p_empresa
                      AND ((d.devuelve_a = p_id AND p_tipo = 'caja.movimiento_de_dinero')
                           OR (d.devuelve_origen_tipo = p_tipo AND d.devuelve_origen_id = p_id))
                      AND NOT EXISTS (SELECT 1 FROM public.movimiento_caja a
                                       WHERE a.empresa_id = d.empresa_id AND a.anula_a = d.movimiento_id AND a.clase = 'ANULACION')), 0)
$$;

-- AVISO no aditivo 1 de 2: el tope de las entradas pasa a ser el envoltorio de la regla única (misma firma, mismo resultado).
CREATE OR REPLACE FUNCTION movimiento_de_dinero_devolvible(p_empresa uuid, p_entrada uuid) RETURNS numeric LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT public.movimiento_de_dinero_devolvible_de_origen(p_empresa, 'caja.movimiento_de_dinero', p_entrada)
$$;

GRANT EXECUTE ON FUNCTION movimiento_de_dinero_devolvible_de_origen(uuid, text, uuid) TO pedernal_app;

-- AVISO no aditivo 2 de 2: el cuerpo vigente de `movimiento_de_dinero_validar_alta` (0091, el único que lo define) con la rama «DM-1» para la cobranza.
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
      IF NEW.devuelve_origen_id IS NOT NULL THEN
        -- DM-1: la devolución cita la COBRANZA de un ticket (no una entrada de dinero): sus cobros existen y son todos de la sucursal del acto.
        IF NOT EXISTS (SELECT 1 FROM public.cobro c
                        WHERE c.empresa_id = NEW.empresa_id AND c.origen_tipo = NEW.devuelve_origen_tipo AND c.origen_id = NEW.devuelve_origen_id) THEN
          RAISE EXCEPTION 'la devolución tiene que citar una cobranza de la misma empresa con cobros'
            USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_devuelve_origen_invalido';
        END IF;
        IF EXISTS (SELECT 1 FROM public.cobro c
                     JOIN public.movimiento_caja mc ON mc.id = c.movimiento_id AND mc.empresa_id = c.empresa_id
                     JOIN public.sesion_caja sc ON sc.id = mc.sesion_id AND sc.empresa_id = mc.empresa_id
                     JOIN public.caja k ON k.id = sc.caja_id AND k.empresa_id = sc.empresa_id
                    WHERE c.empresa_id = NEW.empresa_id AND c.origen_tipo = NEW.devuelve_origen_tipo AND c.origen_id = NEW.devuelve_origen_id
                      AND k.sucursal_id <> NEW.sucursal_id) THEN
          RAISE EXCEPTION 'la devolución tiene que ser de una cobranza de la misma sucursal'
            USING ERRCODE = '23514', CONSTRAINT = 'movimiento_de_dinero_devuelve_origen_invalido';
        END IF;
        -- Tope: el mismo bloqueo por id (el de la cobranza es un uuid) y, con el bloqueo tomado, la MISMA regla del tope que las entradas.
        PERFORM public.movimiento_de_dinero_bloquear_entrada(NEW.empresa_id, NEW.devuelve_origen_id);
        IF public.movimiento_de_dinero_devolvible_de_origen(NEW.empresa_id, NEW.devuelve_origen_tipo, NEW.devuelve_origen_id) < NEW.importe THEN
          RAISE EXCEPTION 'la devolución supera lo cobrado de la cobranza'
            USING ERRCODE = '23514', CONSTRAINT = 'devolucion_supera_lo_cobrado';
        END IF;
      ELSE
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
  END IF;
  RETURN NEW;
END
$$;
