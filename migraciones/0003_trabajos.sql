-- 0003_trabajos: máquina de estados de la cola de trabajos y tope del error guardado (H5; ADR-007).
--
-- Reglas de esta migración:
--  * NO ensancha ningún privilegio: ni un GRANT, ni una política, ni una función SECURITY DEFINER. El
--    procesador usa los permisos que ya tiene `zuluhub_trabajos` (leer la cola y avanzar `estado`,
--    `intentos`, `proximo_intento`, `tomado_hasta`, `ultimo_error`).
--  * Es compatible hacia atrás y no destructiva: agrega un disparador y una restricción. Las filas que
--    ya existen cumplen ambos (los estados nuevos de las filas viejas no se tocan).
--  * Se ejecuta como el rol dueño de la base.

-- Transiciones del estado de un trabajo. Un test exige que la base permita exactamente las mismas
-- que `TRANSICIONES_DE_TRABAJO` (src/puertos/cola-de-trabajos.ts):
--   PENDIENTE -> EN_CURSO                     (lo toma un procesador)
--   EN_CURSO  -> PENDIENTE | HECHO | FALLIDO (se reprograma, termina o se agotó)
--   FALLIDO   -> PENDIENTE                    (reencolado de plataforma, con auditoría)
-- `HECHO` es definitivo y queda congelado. Quedarse en el mismo estado es válido (`EN_CURSO` retomado
-- con el plazo vencido). `intentos` nunca baja: bajarlo burlaría el tope de reintentos.
CREATE FUNCTION trabajo_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF OLD.estado = 'HECHO' THEN
    RAISE EXCEPTION 'un trabajo HECHO no se puede modificar'
      USING ERRCODE = '23514', CONSTRAINT = 'trabajo_hecho_inmutable';
  END IF;
  IF NEW.intentos < OLD.intentos THEN
    RAISE EXCEPTION 'los intentos de un trabajo no pueden bajar'
      USING ERRCODE = '23514', CONSTRAINT = 'trabajo_intentos_no_bajan';
  END IF;
  IF NEW.estado <> OLD.estado AND NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('PENDIENTE', 'EN_CURSO'),
      ('EN_CURSO', 'PENDIENTE'),
      ('EN_CURSO', 'HECHO'),
      ('EN_CURSO', 'FALLIDO'),
      ('FALLIDO', 'PENDIENTE')
    ) AS permitida (desde, hasta)
    WHERE permitida.desde = OLD.estado AND permitida.hasta = NEW.estado
  ) THEN
    RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'trabajo_transicion_invalida';
  END IF;
  RETURN NEW;
END
$$;

-- El nombre ordena los disparadores: `trabajo_cambio` valida con OLD/NEW antes de `trabajo_fecha`.
CREATE TRIGGER trabajo_cambio BEFORE UPDATE ON trabajo
  FOR EACH ROW EXECUTE FUNCTION trabajo_validar_cambio();

-- El error que se guarda es texto corto y sin secretos (el procesador lo recorta a 500 caracteres):
-- la base no admite más de 1000 aunque alguien con permiso de escritura intente guardar otra cosa.
ALTER TABLE trabajo ADD CONSTRAINT trabajo_ultimo_error_ck
  CHECK (ultimo_error IS NULL OR char_length(ultimo_error) <= 1000);
