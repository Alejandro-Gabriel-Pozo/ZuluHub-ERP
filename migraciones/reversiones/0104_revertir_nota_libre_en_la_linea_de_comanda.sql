-- 0104_revertir_nota_libre_en_la_linea_de_comanda: deshace 0104: quita las columnas `nota` de `linea_de_comanda` y `renglon_de_envio` y devuelve las tres funciones de disparador a las de 0038.
-- DESTRUCTIVA si hay notas: PIERDE el texto cargado (en la línea y en la foto de lo que vio la cocina). FRENA (55000) si existe alguna; hay que AVISAR AL DUEÑO y resolverlo a mano antes.
-- Se corre a mano, revisada, en una sola transacción y con el rol dueño de la base (que evade RLS, o el conteo no vería nada). No usa CASCADE. Se puede repetir sin que cambie nada.

DO $$
DECLARE
  v_notas bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  -- Dinámico: sin la columna (segunda corrida) la consulta no se puede ni planificar.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'linea_de_comanda' AND column_name = 'nota') THEN
    EXECUTE 'SELECT count(*) FROM public.linea_de_comanda WHERE nota IS NOT NULL' INTO v_notas;
  END IF;
  IF v_notas > 0 THEN
    RAISE EXCEPTION 'hay % líneas con nota: no se revierte (perdería su texto); resolverlas a mano antes', v_notas USING ERRCODE = '55000';
  END IF;
END
$$;

-- Primero las funciones (dejan de leer la columna), después las columnas (el permiso por columna se va con ellas).
CREATE OR REPLACE FUNCTION renglon_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_envio public.envio_de_comanda%ROWTYPE;
  v_linea public.linea_cuenta%ROWTYPE;
BEGIN
  SELECT * INTO v_envio FROM public.envio_de_comanda e WHERE e.id = NEW.envio_id AND e.empresa_id = NEW.empresa_id AND e.xmin = pg_current_xact_id()::xid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'los renglones de un envío entran con el envío, en la misma transacción'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_solo_con_el_envio';
  END IF;
  SELECT * INTO v_linea FROM public.linea_cuenta l WHERE l.id = NEW.linea_id AND l.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_linea.cuenta_id <> v_envio.cuenta_id OR NEW.cantidad > v_linea.cantidad THEN
    RAISE EXCEPTION 'un renglón es de una línea de la cuenta del envío y no excede su cantidad'
      USING ERRCODE = '23514', CONSTRAINT = 'renglon_linea_ajena';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION linea_de_comanda_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_linea public.linea_cuenta%ROWTYPE;
  v_origen uuid;
  v_envio_origen uuid;
  v_envio public.envio_de_comanda%ROWTYPE;
BEGIN
  SELECT * INTO v_linea FROM public.linea_cuenta l WHERE l.id = NEW.linea_id AND l.empresa_id = NEW.empresa_id;
  IF NOT FOUND OR v_linea.cuenta_id <> NEW.cuenta_id OR v_linea.estado <> 'VIGENTE' THEN
    RAISE EXCEPTION 'el estado de comanda es de una línea vigente de su cuenta'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_linea_invalida';
  END IF;
  IF NEW.envio_id IS NOT NULL THEN
    -- Una línea nace ya enviada solo si es la copia de una ya enviada (unir, dividir, anular una parte): conserva su envío.
    SELECT c.linea_origen_id INTO v_origen FROM public.linea_copiada c WHERE c.linea_nueva_id = NEW.linea_id AND c.empresa_id = NEW.empresa_id;
    SELECT d.envio_id INTO v_envio_origen FROM public.linea_de_comanda d WHERE d.linea_id = v_origen AND d.empresa_id = NEW.empresa_id;
    IF v_origen IS NULL OR v_envio_origen IS DISTINCT FROM NEW.envio_id THEN
      RAISE EXCEPTION 'una línea nace sin enviar, salvo la copia de una ya enviada'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_alta_invalida';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION linea_de_comanda_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_envio public.envio_de_comanda%ROWTYPE;
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.linea_id IS DISTINCT FROM OLD.linea_id OR NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'la identidad del estado de comanda no se puede cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_inmutable';
  END IF;
  -- S4: el envío se fija una sola vez, y la salida solo cambia mientras la línea no se envió.
  IF OLD.envio_id IS NOT NULL THEN
    RAISE EXCEPTION 'una línea ya enviada no cambia su envío ni su salida'
      USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_ya_enviada';
  END IF;
  IF NEW.envio_id IS NOT NULL THEN
    SELECT * INTO v_envio FROM public.envio_de_comanda e WHERE e.id = NEW.envio_id AND e.empresa_id = NEW.empresa_id AND e.xmin = pg_current_xact_id()::xid;
    IF NOT FOUND OR v_envio.cuenta_id <> OLD.cuenta_id THEN
      RAISE EXCEPTION 'la línea se envía en un envío de su cuenta, creado en esta transacción'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_envio_invalido';
    END IF;
    IF NEW.salida IS DISTINCT FROM OLD.salida THEN
      RAISE EXCEPTION 'al enviar una línea no se cambia su salida'
        USING ERRCODE = '23514', CONSTRAINT = 'linea_de_comanda_ya_enviada';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE linea_de_comanda DROP COLUMN IF EXISTS nota;
ALTER TABLE renglon_de_envio DROP COLUMN IF EXISTS nota;
