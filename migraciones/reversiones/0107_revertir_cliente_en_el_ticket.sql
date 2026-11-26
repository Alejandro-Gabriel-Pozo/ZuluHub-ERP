-- 0107_revertir_cliente_en_el_ticket: deshace 0107: borra el disparador, la función, el índice y la columna `ticket.cargado_a_parte_id` (con su clave foránea) y quita el permiso de INSERT de esa columna.
-- DESTRUCTIVA si hay tickets con cliente: PIERDE el vínculo cliente-ticket. FRENA (55000) si existe alguno; hay que AVISAR AL DUEÑO y resolverlo a mano antes.
-- Se corre a mano, revisada, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada). No usa CASCADE. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_filas bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  -- Dinámico: sin la columna (segunda corrida) la consulta no se puede ni planificar.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'ticket' AND column_name = 'cargado_a_parte_id') THEN
    EXECUTE 'SELECT count(*) FROM public.ticket WHERE cargado_a_parte_id IS NOT NULL' INTO v_filas;
  END IF;
  IF v_filas > 0 THEN
    RAISE EXCEPTION 'hay % tickets con cliente cargado: no se revierte (perdería el vínculo); resolverlos a mano antes', v_filas USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS ticket_cargado_a_parte_inmutable ON ticket;
DROP FUNCTION IF EXISTS ticket_cargado_a_parte_inmutable();
DROP INDEX IF EXISTS ticket_cargado_a_parte_ix;
-- El permiso de columna y la clave foránea se van con la columna.
ALTER TABLE ticket DROP COLUMN IF EXISTS cargado_a_parte_id;
