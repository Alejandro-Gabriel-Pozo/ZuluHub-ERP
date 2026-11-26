-- 0107_cliente_en_el_ticket: R2 mínimo (PR-R2a). El ticket guarda, si hay, a qué cliente se le cargó la venta al cerrar la cuenta (dato informativo: no crea deuda; el cargo al libro es de CC-2).
--  * Columna `ticket.cargado_a_parte_id` (uuid, NULL): sin relleno, sin DEFAULT y sin NOT NULL, así que no reescribe la tabla ni toca ninguna fila existente (todas quedan en NULL).
--  * FK compuesta `(cargado_a_parte_id, empresa_id) -> parte (id, empresa_id)`: un cliente de otra empresa no entra por la base. MATCH SIMPLE: con la columna en NULL no se comprueba nada.
--  * Índice parcial por (empresa, cliente) solo de los tickets con cliente: no pesa para quien no lo usa.
--  * Disparador `ticket_cargado_a_parte_inmutable`: una vez emitido el ticket el cliente no cambia (ni de NULL a un valor ni de un valor a otro), tampoco para el dueño de la base.
--    No hay «corregir el cliente del ticket» en v1: se anula y se emite de nuevo.
--  * Permiso: se SUMA la columna al INSERT de `ticket` (0028); no se concede UPDATE.
-- Reglas de esta migración (las de 0036, 0047 y 0093): ADITIVA y compatible hacia atrás; su reversión es `migraciones/reversiones/0107_revertir_cliente_en_el_ticket.sql` (frena si hay tickets con cliente).
-- DEPENDE de 0028 (`ticket`, `ticket_id_empresa_uk`) y 0034 (`parte`, `parte_id_empresa_uk`); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.ticket') IS NULL OR to_regclass('public.parte') IS NULL THEN
    RAISE EXCEPTION '0107 necesita las tablas ticket (0028) y parte (0034)' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parte_id_empresa_uk' AND conrelid = 'public.parte'::regclass) THEN
    RAISE EXCEPTION '0107 necesita parte_id_empresa_uk (0034) como destino de la clave foránea' USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE ticket ADD COLUMN cargado_a_parte_id uuid;
ALTER TABLE ticket ADD CONSTRAINT ticket_cargado_a_parte_fkey
  FOREIGN KEY (cargado_a_parte_id, empresa_id) REFERENCES parte (id, empresa_id);
CREATE INDEX ticket_cargado_a_parte_ix ON ticket (empresa_id, cargado_a_parte_id) WHERE cargado_a_parte_id IS NOT NULL;

CREATE FUNCTION ticket_cargado_a_parte_inmutable() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.cargado_a_parte_id IS DISTINCT FROM OLD.cargado_a_parte_id THEN
    RAISE EXCEPTION 'el cliente cargado al ticket no se cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'ticket_cargado_a_parte_inmutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER ticket_cargado_a_parte_inmutable BEFORE UPDATE OF cargado_a_parte_id ON ticket
  FOR EACH ROW EXECUTE FUNCTION ticket_cargado_a_parte_inmutable();

-- El GRANT de 0028 enumera las columnas del INSERT; un GRANT por columna se suma a los anteriores (no los pisa). UPDATE no se concede: la columna nace con el ticket y no cambia.
GRANT INSERT (cargado_a_parte_id) ON ticket TO pedernal_app;
