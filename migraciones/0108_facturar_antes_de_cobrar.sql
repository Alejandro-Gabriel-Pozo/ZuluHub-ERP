-- 0108_facturar_antes_de_cobrar: el disparador `documento_alta` deja de exigir que el ticket esté COBRADO (R-05, decisión del dueño del 14/11/2026 ratificada el 25/11/2026: «se permite facturar antes de cobrar»).
-- Reemplaza SOLO la función `documento_validar_alta()` de 0029. Antes: el ticket tenía que estar COBRADO. Ahora: tiene que estar EMITIDO o COBRADO (lista de permitidos). Un ticket ANULADO, de CORTESIA,
-- de un estado que hoy no existe o inexistente sigue rechazado con `documento_ticket_no_facturable` (el nombre de la restricción no cambia: `restricciones.ts` lo traduce a TICKET_NO_FACTURABLE).
-- La POLÍTICA (qué empresa puede facturar un ticket sin cobrar) NO vive acá: la decide el caso de uso con la perilla `facturar_antes_de_cobrar`, apagada de base (R-05a). Esta migración solo deja de
-- estorbar a la perilla: la base conserva lo invariante (no se factura un ticket anulado ni de cortesía).
-- Todo lo demás de la función es IDÉNTICO al de 0029: el ticket se toma `FOR SHARE` (se turna con cobrar y anular), el ejemplar facturado es el vigente (`documento_ejemplar_no_vigente`) y un documento nace
-- vigente (`documento_cambio_invalido`). No se tocan el disparador `documento_alta`, `documento_validar_cambio`, `documento_vigente_uk`, `documento_clave_uk`, `documento_intento_uk`, `documento_comprobante_uk`, RLS ni permisos.
-- Reglas de esta migración (las de 0036, 0047, 0093 y 0098):
--  * MÁS PERMISIVA en lo lógico (afloja una restricción de integridad: el dueño la conoce, CLAUDE.md), aditiva en lo estructural: una función reemplazada, ninguna tabla, columna ni dato tocado.
--    No rellena, no cambia ni borra datos existentes: los documentos ya emitidos quedan como están.
--  * Su reversión es `migraciones/reversiones/0108_revertir_facturar_antes_de_cobrar.sql` (FRENA si ya hay facturas vigentes sobre tickets no cobrados). El ejecutor no la aplica.
--  * NINGUNA perilla se enciende hasta que esta migración esté aplicada en producción (con la base de 0029, la perilla encendida daría TICKET_NO_FACTURABLE desde la base).
-- DEPENDE de 0029 (`documento_de_ticket` y su disparador); se comprueba al empezar, incluido que la función sea todavía la de 0029 (si alguien ya la cambió, se frena en vez de pisarla).

DO $$
DECLARE
  v_definicion text;
BEGIN
  IF to_regclass('public.documento_de_ticket') IS NULL OR to_regclass('public.ticket') IS NULL OR to_regclass('public.ticket_ejemplar') IS NULL THEN
    RAISE EXCEPTION '0108 necesita 0028 y 0029 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.documento_validar_alta()') IS NULL THEN
    RAISE EXCEPTION '0108: no existe la función documento_validar_alta() de 0029' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
     WHERE tg.tgrelid = 'public.documento_de_ticket'::regclass AND tg.tgname = 'documento_alta'
       AND tg.tgfoid = 'public.documento_validar_alta()'::regprocedure AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION '0108: el disparador documento_alta de 0029 no está sobre documento_de_ticket o no usa documento_validar_alta()' USING ERRCODE = '55000';
  END IF;
  v_definicion := pg_get_functiondef('public.documento_validar_alta()'::regprocedure);
  IF position('IS DISTINCT FROM ''COBRADO''' IN v_definicion) = 0 THEN
    RAISE EXCEPTION '0108: documento_validar_alta() ya no es la de 0029 (no exige COBRADO): se frena en vez de pisarla' USING ERRCODE = '55000';
  END IF;
END
$$;

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
$$;
