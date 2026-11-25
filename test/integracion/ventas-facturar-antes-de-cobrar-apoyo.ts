import type pg from "pg";

/**
 * PUENTE de R-05a (se borra al llegar la migración 0108, R-05b): instala en la base de la prueba el `documento_validar_alta` que traerá 0108, igual
 * al de 0029 salvo que el ticket puede estar EMITIDO o COBRADO (nunca ANULADO, de CORTESIA ni inexistente). Sin esto, la base de 0029 rechaza un
 * EMITIDO y no se podría probar la política (perilla encendida) contra la base real. Solo toca la base descartable de esa prueba, con el rol dueño.
 */
export async function aflojarElDisparadorDeAlta(dueno: pg.Client): Promise<void> {
  await dueno.query(`
CREATE OR REPLACE FUNCTION documento_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_estado text;
  v_vigente integer;
  v_numero integer;
BEGIN
  SELECT t.estado, t.ejemplar_vigente INTO v_estado, v_vigente
    FROM public.ticket t WHERE t.id = NEW.ticket_id AND t.empresa_id = NEW.empresa_id FOR SHARE;
  IF v_estado IS NULL OR v_estado NOT IN ('EMITIDO', 'COBRADO') THEN
    RAISE EXCEPTION 'documento_ticket_no_facturable: el ticket % está en estado %', NEW.ticket_id, coalesce(v_estado, 'inexistente')
      USING ERRCODE = '23514', CONSTRAINT = 'documento_ticket_no_facturable';
  END IF;
  SELECT e.numero_de_ejemplar INTO v_numero
    FROM public.ticket_ejemplar e WHERE e.id = NEW.ejemplar_id AND e.empresa_id = NEW.empresa_id AND e.ticket_id = NEW.ticket_id;
  IF v_numero IS DISTINCT FROM v_vigente THEN
    RAISE EXCEPTION 'documento_ejemplar_no_vigente: el ejemplar % no es el vigente del ticket %', NEW.ejemplar_id, NEW.ticket_id
      USING ERRCODE = '23514', CONSTRAINT = 'documento_ejemplar_no_vigente';
  END IF;
  IF NEW.vigente IS NOT TRUE THEN
    RAISE EXCEPTION 'documento_cambio_invalido: un documento nace vigente'
      USING ERRCODE = '23514', CONSTRAINT = 'documento_cambio_invalido';
  END IF;
  RETURN NEW;
END
$$;`);
}
