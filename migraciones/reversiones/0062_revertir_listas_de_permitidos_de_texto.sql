-- 0062_revertir_listas_de_permitidos_de_texto: deshace 0062: cada CHECK vuelve a su definición anterior («sin caracteres de control») y se borran las tres funciones.
--
-- NO borra ni cambia datos y NO frena: lo que cumplía la lista de permitidos cumple la regla anterior (es compatible hacia atrás). Se corre a mano, revisada, en una transacción
-- y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0062_revertir_listas_de_permitidos_de_texto.sql
--     COMMIT;
--
-- Las definiciones de abajo son las de 0005, 0006, 0009 y 0022 (con `texto_fiscal_valido` donde 0009 la usaba). Solo borra su propia fila del registro `migracion`, para poder
-- volver a aplicarla. Se puede repetir sin que cambie nada.

ALTER TABLE sucursal DROP CONSTRAINT IF EXISTS sucursal_nombre_control_ck;
ALTER TABLE sucursal ADD CONSTRAINT sucursal_nombre_control_ck CHECK (nombre !~ '[\x01-\x1F\x7F-\x9F]');

ALTER TABLE domicilio DROP CONSTRAINT IF EXISTS domicilio_calle_ck;
ALTER TABLE domicilio ADD CONSTRAINT domicilio_calle_ck CHECK (
  calle !~ '^\s|\s$' AND calle !~ '[\x01-\x1F\x7F-\x9F]' AND char_length(calle) BETWEEN 1 AND 100);
ALTER TABLE domicilio DROP CONSTRAINT IF EXISTS domicilio_localidad_ck;
ALTER TABLE domicilio ADD CONSTRAINT domicilio_localidad_ck CHECK (
  localidad !~ '^\s|\s$' AND localidad !~ '[\x01-\x1F\x7F-\x9F]' AND char_length(localidad) BETWEEN 1 AND 100);
ALTER TABLE domicilio DROP CONSTRAINT IF EXISTS domicilio_piso_ck;
ALTER TABLE domicilio ADD CONSTRAINT domicilio_piso_ck CHECK (
  piso IS NULL OR (piso !~ '^\s|\s$' AND piso !~ '[\x01-\x1F\x7F-\x9F]' AND char_length(piso) BETWEEN 1 AND 20));
ALTER TABLE domicilio DROP CONSTRAINT IF EXISTS domicilio_departamento_ck;
ALTER TABLE domicilio ADD CONSTRAINT domicilio_departamento_ck CHECK (
  departamento IS NULL OR (departamento !~ '^\s|\s$' AND departamento !~ '[\x01-\x1F\x7F-\x9F]' AND char_length(departamento) BETWEEN 1 AND 20));

ALTER TABLE datos_fiscales DROP CONSTRAINT IF EXISTS datos_fiscales_razon_social_ck;
ALTER TABLE datos_fiscales ADD CONSTRAINT datos_fiscales_razon_social_ck CHECK (
  razon_social IS NULL OR (razon_social !~ '^\s|\s$' AND razon_social !~ '[\x01-\x1F\x7F-\x9F]' AND char_length(razon_social) BETWEEN 1 AND 200));
ALTER TABLE datos_fiscales DROP CONSTRAINT IF EXISTS datos_fiscales_iibb_numero_ck;
ALTER TABLE datos_fiscales ADD CONSTRAINT datos_fiscales_iibb_numero_ck CHECK (
  iibb_numero IS NULL OR (iibb_numero !~ '^\s|\s$' AND iibb_numero !~ '[\x01-\x1F\x7F-\x9F]' AND char_length(iibb_numero) BETWEEN 1 AND 30));

ALTER TABLE comprobante DROP CONSTRAINT IF EXISTS comprobante_sucursal_nombre_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_sucursal_nombre_ck CHECK (
  sucursal_nombre !~ '^\s|\s$' AND sucursal_nombre <> '' AND char_length(sucursal_nombre) <= 100 AND sucursal_nombre !~ '[\x01-\x1F\x7F-\x9F]');
ALTER TABLE comprobante DROP CONSTRAINT IF EXISTS comprobante_emisor_razon_social_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_emisor_razon_social_ck CHECK (texto_fiscal_valido(emisor_razon_social, 200));
ALTER TABLE comprobante DROP CONSTRAINT IF EXISTS comprobante_emisor_domicilio_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_emisor_domicilio_ck CHECK (texto_fiscal_valido(emisor_domicilio_fiscal, 500));
ALTER TABLE comprobante DROP CONSTRAINT IF EXISTS comprobante_emisor_iibb_numero_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_emisor_iibb_numero_ck CHECK (emisor_iibb_numero IS NULL OR texto_fiscal_valido(emisor_iibb_numero, 30));
ALTER TABLE comprobante DROP CONSTRAINT IF EXISTS comprobante_pv_domicilio_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_pv_domicilio_ck CHECK (texto_fiscal_valido(punto_de_venta_domicilio, 500));
ALTER TABLE comprobante DROP CONSTRAINT IF EXISTS comprobante_receptor_nombre_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_receptor_nombre_ck CHECK (receptor_nombre IS NULL OR texto_fiscal_valido(receptor_nombre, 200));
ALTER TABLE comprobante DROP CONSTRAINT IF EXISTS comprobante_receptor_domicilio_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_receptor_domicilio_ck CHECK (receptor_domicilio IS NULL OR texto_fiscal_valido(receptor_domicilio, 300));

DROP FUNCTION IF EXISTS texto_de_una_linea_valido(text, integer);
DROP FUNCTION IF EXISTS piso_o_departamento_valido(text, integer);
DROP FUNCTION IF EXISTS numero_de_iibb_valido(text);

DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre = '0062_listas_de_permitidos_de_texto.sql';
  END IF;
END
$$;
