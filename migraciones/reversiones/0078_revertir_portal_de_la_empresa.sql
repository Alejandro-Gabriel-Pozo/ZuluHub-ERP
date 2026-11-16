-- migraciones/reversiones/0078_revertir_portal_de_la_empresa.sql
--   BEGIN;
--   SET LOCAL pedernal.confirmar_reversion = 'SI';   -- solo si hay algún portal cargado (el dueño tiene que saberlo: el código de su QR se pierde)
--   \i migraciones/reversiones/0078_revertir_portal_de_la_empresa.sql
--   COMMIT;
DO $$
DECLARE
  v_tabla text;
  v_filas bigint;
  v_total bigint := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'la reversión necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS)' USING ERRCODE = '55000';
  END IF;
  FOREACH v_tabla IN ARRAY ARRAY['portal_zona', 'portal_tarjeta', 'portal_de_empresa'] LOOP
    IF to_regclass('public.' || v_tabla) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_filas;
      v_total := v_total + v_filas;
    END IF;
  END LOOP;
  IF v_total > 0 AND coalesce(current_setting('pedernal.confirmar_reversion', true), '') <> 'SI' THEN
    RAISE EXCEPTION 'hay % filas del portal (no se recuperan, y su QR impreso dejaría de andar): avisar al dueño y repetir con SET LOCAL pedernal.confirmar_reversion = ''SI''', v_total
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP POLICY IF EXISTS sucursal_publico_de_portal ON sucursal;
DROP POLICY IF EXISTS carta_publica_publico_de_portal ON carta_publica;
DROP POLICY IF EXISTS portal_de_empresa_publico_de_carta ON portal_de_empresa;
DROP TABLE IF EXISTS portal_zona;
DROP TABLE IF EXISTS portal_tarjeta;
DROP TABLE IF EXISTS portal_de_empresa;
DROP FUNCTION IF EXISTS portal_tarjeta_validar();
DROP FUNCTION IF EXISTS portal_hijo_validar();
DROP FUNCTION IF EXISTS portal_de_empresa_validar();
DELETE FROM migracion WHERE nombre = '0078_portal_de_la_empresa.sql';   -- † nombre exacto de la tabla y columna del registro: verificar contra 0043_revertir (mismo patrón)
