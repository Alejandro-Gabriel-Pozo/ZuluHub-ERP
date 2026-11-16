-- migraciones/reversiones/0077_revertir_identidad_de_la_carta.sql   (misma forma de uso)
DO $$
DECLARE
  v_filas bigint := 0;
  v_n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.portal_de_empresa') IS NOT NULL THEN
    RAISE EXCEPTION 'revertir 0078_portal_de_la_empresa antes (usa las funciones de 0077)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'carta_publica' AND column_name = 'cara') THEN
    SELECT count(*) INTO v_n FROM public.carta_publica
      WHERE modelo <> 'LISTA' OR cara IS NOT NULL OR color_propio IS NOT NULL OR logo_proveedor IS NOT NULL;
    v_filas := v_filas + v_n;
  END IF;
  IF to_regclass('public.identidad_de_carta_empresa') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.identidad_de_carta_empresa;
    v_filas := v_filas + v_n;
  END IF;
  IF v_filas > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % cartas o empresas con identidad cargada (modelo, cara, color o logo; no se recuperan): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_filas
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TABLE IF EXISTS identidad_de_carta_empresa;
DROP FUNCTION IF EXISTS identidad_de_carta_empresa_validar();
ALTER TABLE carta_publica
  DROP CONSTRAINT IF EXISTS carta_publica_logo_ck,
  DROP COLUMN IF EXISTS logo_extension, DROP COLUMN IF EXISTS logo_version, DROP COLUMN IF EXISTS logo_id_publico,
  DROP COLUMN IF EXISTS logo_cuenta, DROP COLUMN IF EXISTS logo_proveedor,
  DROP COLUMN IF EXISTS color_propio, DROP COLUMN IF EXISTS cara, DROP COLUMN IF EXISTS modelo;
DROP FUNCTION IF EXISTS imagen_externa_valida(text, text, text, text, text);
DROP FUNCTION IF EXISTS color_de_carta_valido(text);
-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla. El registro guarda el nombre del archivo CON «.sql» (corrección aprobada
-- por el orquestador por delegación; el SQL original borraba '0077_identidad_de_la_carta' y no encontraba la fila).
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0077_identidad_de_la_carta.sql';
  END IF;
END
$$;
