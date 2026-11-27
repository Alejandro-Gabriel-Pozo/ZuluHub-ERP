-- 0115_revertir_cierre_de_caja_cobrado_neto_de_devoluciones: deshace 0115. Restituye el cuerpo de `cierre_de_caja_verificar` de 0027 byte a byte (el cobrado de cada origen
-- vuelve a ser la Σ bruta de sus cobros). No cambia datos; se puede repetir sin que cambie nada. Corre en UNA transacción, con el dueño de la base.
CREATE OR REPLACE FUNCTION cierre_de_caja_verificar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_faltan bigint;
  v_difieren bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.jornada_de_sucursal j
     WHERE j.empresa_id = NEW.empresa_id AND j.sucursal_id = NEW.sucursal_id AND j.fecha_negocio = NEW.fecha_negocio
       AND j.estado = 'CERRADA' AND j.xmin = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'la foto de caja se guarda con la jornada pasando a CERRADA en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'cierre_de_caja_solo_al_cerrar';
  END IF;

  WITH sesiones AS (
    SELECT s.id FROM public.sesion_caja s JOIN public.caja c ON c.id = s.caja_id AND c.empresa_id = s.empresa_id
     WHERE s.empresa_id = NEW.empresa_id AND c.sucursal_id = NEW.sucursal_id AND s.fecha_negocio = NEW.fecha_negocio
  ), registrado AS (
    SELECT m.medio_de_pago_id AS medio, m.cuenta_de_cobro_id AS cuenta, sum(m.importe) AS importe
      FROM public.movimiento_caja m JOIN sesiones s ON s.id = m.sesion_id
     WHERE m.empresa_id = NEW.empresa_id GROUP BY 1, 2
  ), efectos AS (
    SELECT k.medio_antes_id AS medio, k.cuenta_antes_id AS cuenta, -m.importe AS importe
      FROM public.correccion_de_medio k JOIN public.movimiento_caja m ON m.id = k.cobro_id AND m.empresa_id = k.empresa_id
     WHERE k.empresa_id = NEW.empresa_id AND k.sucursal_id = NEW.sucursal_id AND k.fecha_negocio = NEW.fecha_negocio
    UNION ALL
    SELECT k.medio_despues_id, k.cuenta_despues_id, m.importe
      FROM public.correccion_de_medio k JOIN public.movimiento_caja m ON m.id = k.cobro_id AND m.empresa_id = k.empresa_id
     WHERE k.empresa_id = NEW.empresa_id AND k.sucursal_id = NEW.sucursal_id AND k.fecha_negocio = NEW.fecha_negocio
  ), correcciones AS (
    SELECT medio, cuenta, sum(importe) AS importe FROM efectos GROUP BY 1, 2
  ), declaraciones AS (
    SELECT DISTINCT ON (d.medio_de_pago_id, d.cuenta_de_cobro_id)
           d.medio_de_pago_id AS medio, d.cuenta_de_cobro_id AS cuenta, d.importe
      FROM public.declaracion_de_total d
     WHERE d.empresa_id = NEW.empresa_id AND d.sucursal_id = NEW.sucursal_id AND d.fecha_negocio = NEW.fecha_negocio
     ORDER BY d.medio_de_pago_id, d.cuenta_de_cobro_id, d.secuencia DESC
  ), conforme_general AS (
    SELECT g.conforme_por, g.conforme_en FROM public.conforme_de_jornada g
     WHERE g.empresa_id = NEW.empresa_id AND g.sucursal_id = NEW.sucursal_id AND g.fecha_negocio = NEW.fecha_negocio
  ), cierres AS (
    SELECT a.medio_de_pago_id AS medio, a.cuenta_de_cobro_id AS cuenta,
           count(*) AS lineas, count(*) FILTER (WHERE a.conforme) AS conformes, sum(a.contado) AS contado,
           (array_agg(a.conforme_por ORDER BY a.conforme_en DESC) FILTER (WHERE a.conforme))[1] AS conforme_por,
           max(a.conforme_en) AS conforme_en
      FROM public.arqueo_caja a JOIN sesiones s ON s.id = a.sesion_id
     WHERE a.empresa_id = NEW.empresa_id GROUP BY 1, 2
  ), pares AS (
    SELECT medio, cuenta FROM registrado UNION SELECT medio, cuenta FROM correcciones UNION SELECT medio, cuenta FROM declaraciones
  ), esperadas AS (
    SELECT p.medio, p.cuenta,
           coalesce(r.importe, 0) AS registrado, coalesce(c.importe, 0) AS correcciones,
           CASE
             WHEN me.tipo = 'EFECTIVO' THEN 'CONTADO'
             WHEN d.medio IS NOT NULL THEN 'DECLARADO'
             WHEN (SELECT count(*) FROM conforme_general) > 0 THEN 'CONFORME'
             WHEN ci.lineas > 0 AND ci.conformes = 0 THEN 'DECLARADO'
             WHEN ci.lineas > 0 AND ci.conformes = ci.lineas THEN 'CONFORME'
             ELSE 'SIN_DATO'
           END AS estado,
           CASE
             WHEN me.tipo = 'EFECTIVO' THEN ci.contado
             WHEN d.medio IS NOT NULL THEN d.importe
             WHEN (SELECT count(*) FROM conforme_general) > 0 THEN NULL
             WHEN ci.lineas > 0 AND ci.conformes = 0 THEN ci.contado
             ELSE NULL
           END AS declarado,
           CASE
             WHEN me.tipo = 'EFECTIVO' OR d.medio IS NOT NULL THEN NULL
             WHEN (SELECT count(*) FROM conforme_general) > 0 THEN (SELECT g.conforme_por FROM conforme_general g)
             WHEN ci.lineas > 0 AND ci.conformes = ci.lineas THEN ci.conforme_por
           END AS conforme_por,
           CASE
             WHEN me.tipo = 'EFECTIVO' OR d.medio IS NOT NULL THEN NULL
             WHEN (SELECT count(*) FROM conforme_general) > 0 THEN (SELECT g.conforme_en FROM conforme_general g)
             WHEN ci.lineas > 0 AND ci.conformes = ci.lineas THEN ci.conforme_en
           END AS conforme_en
      FROM pares p
      JOIN public.medio_de_pago me ON me.id = p.medio AND me.empresa_id = NEW.empresa_id
      LEFT JOIN registrado r ON r.medio = p.medio AND r.cuenta IS NOT DISTINCT FROM p.cuenta
      LEFT JOIN correcciones c ON c.medio = p.medio AND c.cuenta IS NOT DISTINCT FROM p.cuenta
      LEFT JOIN declaraciones d ON d.medio = p.medio AND d.cuenta IS NOT DISTINCT FROM p.cuenta
      LEFT JOIN cierres ci ON ci.medio = p.medio AND ci.cuenta IS NOT DISTINCT FROM p.cuenta
  ), guardadas AS (
    SELECT * FROM public.conciliacion_de_jornada g
     WHERE g.empresa_id = NEW.empresa_id AND g.sucursal_id = NEW.sucursal_id AND g.fecha_negocio = NEW.fecha_negocio
  )
  SELECT count(*) FILTER (WHERE e.medio IS NULL OR g.medio_de_pago_id IS NULL),
         count(*) FILTER (WHERE e.medio IS NOT NULL AND g.medio_de_pago_id IS NOT NULL AND (
                 g.registrado <> e.registrado OR g.correcciones <> e.correcciones
                 OR g.declarado IS DISTINCT FROM e.declarado OR g.estado_de_conteo <> e.estado
                 OR g.conforme_por IS DISTINCT FROM e.conforme_por OR g.conforme_en IS DISTINCT FROM e.conforme_en))
    INTO v_faltan, v_difieren
    FROM esperadas e
    FULL JOIN guardadas g ON g.medio_de_pago_id = e.medio AND g.cuenta_de_cobro_id IS NOT DISTINCT FROM e.cuenta;
  IF v_faltan > 0 THEN
    RAISE EXCEPTION 'la conciliación no tiene exactamente una línea por cada medio y cuenta con movimientos, correcciones o declaración'
      USING ERRCODE = '23514', CONSTRAINT = 'caja_conciliacion_incompleta';
  END IF;
  IF v_difieren > 0 THEN
    RAISE EXCEPTION 'una línea de la conciliación no es lo que resulta de los movimientos, las correcciones y las declaraciones'
      USING ERRCODE = '23514', CONSTRAINT = 'caja_conciliacion_no_cuadra';
  END IF;

  -- Cobrado contra el ticket: `cobrado` de cada origen guardado es la Σ real de sus cobros en las sesiones de la jornada (el total del
  -- ticket es de ventas y no se puede verificar acá).
  IF EXISTS (
    SELECT 1 FROM public.conciliacion_de_cobro_por_origen o
     WHERE o.empresa_id = NEW.empresa_id AND o.sucursal_id = NEW.sucursal_id AND o.fecha_negocio = NEW.fecha_negocio
       AND o.cobrado IS DISTINCT FROM (
         SELECT coalesce(sum(m.importe), 0)
           FROM public.cobro co
           JOIN public.movimiento_caja m ON m.id = co.movimiento_id AND m.empresa_id = co.empresa_id
           JOIN public.sesion_caja s ON s.id = m.sesion_id AND s.empresa_id = m.empresa_id
           JOIN public.caja c ON c.id = s.caja_id AND c.empresa_id = s.empresa_id
          WHERE co.empresa_id = o.empresa_id AND co.origen_tipo = o.origen_tipo AND co.origen_id = o.origen_id
            AND c.sucursal_id = o.sucursal_id AND s.fecha_negocio = o.fecha_negocio
       )
  ) THEN
    RAISE EXCEPTION 'el cobrado de un origen no es la suma real de sus cobros en la jornada'
      USING ERRCODE = '23514', CONSTRAINT = 'caja_conciliacion_no_cuadra';
  END IF;
  RETURN NULL;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0115_cierre_de_caja_cobrado_neto_de_devoluciones.sql';
  END IF;
END
$$;
