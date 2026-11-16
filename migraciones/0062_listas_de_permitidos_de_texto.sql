-- 0062_listas_de_permitidos_de_texto: la base deja de validar estos textos por lista de PROHIBIDOS («sin caracteres de control») y pasa a la lista de PERMITIDOS que ya
-- usa el dominio (Deuda 1, 16/11/2026; decisión del dueño 2026-11-05: «una sola lista de caracteres para lo que se imprime»; DEC-0047).
-- Previene: que la base acepte lo que el dominio rechaza (un invisible, `<>`, un emoji o un alfabeto que el PDF no dibuja, escritos por una vía que no pase por el dominio) y que
-- los dos lados se desfasen (los CHECK de 0005, 0006, 0009 y 0022 solo rechazaban controles). Una prueba de integración compara cada función con la lista del dominio.
--
-- Qué cambia, columna por columna (una función por regla del dominio; el nombre del CHECK no cambia):
--   texto_de_una_linea_valido(t, max)   `texto-de-una-linea.ts` (lista base): sucursal.nombre (100), domicilio.calle y .localidad (100), datos_fiscales.razon_social (200) y, en el
--                                        comprobante, la foto de lo mismo: sucursal_nombre (100), emisor_razon_social (200), emisor_domicilio_fiscal y punto_de_venta_domicilio (500),
--                                        receptor_nombre (200) y receptor_domicilio (300).
--   piso_o_departamento_valido(t, max)  `domicilio.ts`: domicilio.piso y .departamento (20).
--   numero_de_iibb_valido(t)            `datos-fiscales.ts`: datos_fiscales.iibb_numero y comprobante.emisor_iibb_numero (30).
-- NO toca (decisiones aparte): los motivos, la descripción del renglón y los identificadores de clave de 0009 (siguen con `texto_fiscal_valido`), todo lo de marcas y planes (0007) y
-- el contacto de la sucursal (0019: teléfono, correo y web van en 0062b junto con sus primitivas, porque una prueba compara el patrón letra por letra).
--
-- SEGURA sobre datos reales: ANTES de cambiar nada, un pre-chequeo cuenta por columna las filas que NO cumplen la regla nueva y, si hay alguna, ABORTA con tabla, columna y
-- cantidad (nada queda a medias: el ejecutor corre cada migración en una transacción). Importa porque el comprobante se actualiza (estado, CAE) y cada UPDATE vuelve a evaluar todos
-- sus CHECK: una fila vieja que no cumpliera bloquearía la autorización. Si abortara, hay que AVISAR AL DUEÑO y corregir esas filas a mano antes de reintentar; esta migración no toca datos.
-- Compatible hacia atrás: lo que cumple la regla nueva cumple la vieja. No agrega SECURITY DEFINER ni cambia roles (solo EXECUTE de las funciones nuevas, a quienes escriben esas tablas).
-- Reversión: `migraciones/reversiones/0062_revertir_listas_de_permitidos_de_texto.sql` (vuelve a los CHECK anteriores; no pierde datos). El ejecutor no la aplica.
-- DEPENDE de 0005, 0006, 0009 y 0022; se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.comprobante') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.comprobante'::regclass AND attname = 'sucursal_nombre' AND NOT attisdropped) THEN
    RAISE EXCEPTION '0062 necesita 0005, 0006, 0009 y 0022 (comprobante.sucursal_nombre)';
  END IF;
  -- El pre-chequeo cuenta filas de tablas con RLS forzado: con un rol que no la evade vería cero y dejaría pasar lo que no cumple.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION '0062 necesita que el rol que la corre evada RLS (superusuario o BYPASSRLS): si no, el pre-chequeo de datos no ve nada'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Las tres funciones: copia exacta de las listas del dominio (`texto-de-una-linea.ts`, `domicilio.ts`, `datos-fiscales.ts`).
-- ---------------------------------------------------------------------------------------------
-- Texto de una línea de la lista base: de 1 a `p_maximo` caracteres, sin blancos en los extremos, con letras latinas, dígitos, espacio y `. , & - ' / ( ) ° + : ; " # º ª ’ “ ” – — « » ® ™`;
-- el primer carácter no es `+` ni `-`. NFC: el dominio lo normaliza, así que una letra de dos piezas no puede entrar por otra vía. (Es la lista de 0025 sin los signos del catálogo de 0043.)
CREATE FUNCTION texto_de_una_linea_valido(t text, p_maximo integer) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN t IS NULL OR p_maximo IS NULL OR char_length(t) NOT BETWEEN 1 AND p_maximo THEN false
    ELSE t = btrim(t)
      AND t IS NFC NORMALIZED
      AND t ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°:;"#ºª’“”–—«»®™''][A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°+:;"#ºª’“”–—«»®™'' -]*$'
  END
$$;

-- Piso o departamento: de 1 a `p_maximo` caracteres, sin blancos en los extremos, con letras latinas, dígitos, espacio y `º ° ª . / -` («-1», «PB», «1°», «B/2», «Único»).
CREATE FUNCTION piso_o_departamento_valido(t text, p_maximo integer) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN t IS NULL OR p_maximo IS NULL OR char_length(t) NOT BETWEEN 1 AND p_maximo THEN false
    ELSE t = btrim(t) AND t ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9º°ª./ -]+$'
  END
$$;

-- Número de Ingresos Brutos: de 1 a 30 caracteres, sin blancos en los extremos, con letras latinas, dígitos, espacio y `. / -`; empieza con letra o dígito («901-123456-7», «en trámite»).
CREATE FUNCTION numero_de_iibb_valido(t text) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN t IS NULL OR char_length(t) NOT BETWEEN 1 AND 30 THEN false
    ELSE t = btrim(t) AND t ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9][A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 ./-]*$'
  END
$$;

-- Los CHECK se evalúan con los permisos de quien escribe: la aplicación escribe en todas estas tablas y la plataforma siembra sucursales (0001).
GRANT EXECUTE ON FUNCTION texto_de_una_linea_valido(text, integer), piso_o_departamento_valido(text, integer), numero_de_iibb_valido(text)
  TO pedernal_app, pedernal_plataforma;

-- ---------------------------------------------------------------------------------------------
-- Pre-chequeo: por columna, cuántas filas no cumplen la regla nueva (sin cambiar nada).
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_regla record;
  v_filas bigint;
  v_malas text := '';
BEGIN
  FOR v_regla IN
    SELECT * FROM (VALUES
      ('sucursal',     'nombre',                  'texto_de_una_linea_valido(nombre, 100)'),
      ('domicilio',    'calle',                   'texto_de_una_linea_valido(calle, 100)'),
      ('domicilio',    'localidad',               'texto_de_una_linea_valido(localidad, 100)'),
      ('domicilio',    'piso',                    'piso_o_departamento_valido(piso, 20)'),
      ('domicilio',    'departamento',            'piso_o_departamento_valido(departamento, 20)'),
      ('datos_fiscales', 'razon_social',          'texto_de_una_linea_valido(razon_social, 200)'),
      ('datos_fiscales', 'iibb_numero',           'numero_de_iibb_valido(iibb_numero)'),
      ('comprobante',  'sucursal_nombre',         'texto_de_una_linea_valido(sucursal_nombre, 100)'),
      ('comprobante',  'emisor_razon_social',     'texto_de_una_linea_valido(emisor_razon_social, 200)'),
      ('comprobante',  'emisor_domicilio_fiscal', 'texto_de_una_linea_valido(emisor_domicilio_fiscal, 500)'),
      ('comprobante',  'emisor_iibb_numero',      'numero_de_iibb_valido(emisor_iibb_numero)'),
      ('comprobante',  'punto_de_venta_domicilio', 'texto_de_una_linea_valido(punto_de_venta_domicilio, 500)'),
      ('comprobante',  'receptor_nombre',         'texto_de_una_linea_valido(receptor_nombre, 200)'),
      ('comprobante',  'receptor_domicilio',      'texto_de_una_linea_valido(receptor_domicilio, 300)')
    ) AS r (tabla, columna, regla)
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I IS NOT NULL AND NOT %s', v_regla.tabla, v_regla.columna, v_regla.regla)
      INTO v_filas;
    IF v_filas > 0 THEN
      v_malas := v_malas || format(E'\n  %s.%s: %s fila(s)', v_regla.tabla, v_regla.columna, v_filas);
    END IF;
  END LOOP;
  IF v_malas <> '' THEN
    RAISE EXCEPTION E'0062: hay datos que no cumplen la lista de permitidos; corregirlos antes de migrar:%', v_malas
      USING ERRCODE = '23514';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- sucursal.nombre (0005): el control de caracteres pasa a la lista de permitidos. El tope (100) y la unicidad no cambian.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE sucursal DROP CONSTRAINT sucursal_nombre_control_ck;
ALTER TABLE sucursal ADD CONSTRAINT sucursal_nombre_control_ck CHECK (texto_de_una_linea_valido(nombre, 100));

-- ---------------------------------------------------------------------------------------------
-- domicilio y datos_fiscales (0006). Un domicilio es de solo inserción; los datos fiscales confirmados no cambian.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE domicilio DROP CONSTRAINT domicilio_calle_ck;
ALTER TABLE domicilio ADD CONSTRAINT domicilio_calle_ck CHECK (texto_de_una_linea_valido(calle, 100));
ALTER TABLE domicilio DROP CONSTRAINT domicilio_localidad_ck;
ALTER TABLE domicilio ADD CONSTRAINT domicilio_localidad_ck CHECK (texto_de_una_linea_valido(localidad, 100));
ALTER TABLE domicilio DROP CONSTRAINT domicilio_piso_ck;
ALTER TABLE domicilio ADD CONSTRAINT domicilio_piso_ck CHECK (piso IS NULL OR piso_o_departamento_valido(piso, 20));
ALTER TABLE domicilio DROP CONSTRAINT domicilio_departamento_ck;
ALTER TABLE domicilio ADD CONSTRAINT domicilio_departamento_ck CHECK (departamento IS NULL OR piso_o_departamento_valido(departamento, 20));

ALTER TABLE datos_fiscales DROP CONSTRAINT datos_fiscales_razon_social_ck;
ALTER TABLE datos_fiscales ADD CONSTRAINT datos_fiscales_razon_social_ck CHECK (razon_social IS NULL OR texto_de_una_linea_valido(razon_social, 200));
ALTER TABLE datos_fiscales DROP CONSTRAINT datos_fiscales_iibb_numero_ck;
ALTER TABLE datos_fiscales ADD CONSTRAINT datos_fiscales_iibb_numero_ck CHECK (iibb_numero IS NULL OR numero_de_iibb_valido(iibb_numero));

-- ---------------------------------------------------------------------------------------------
-- comprobante (0009 y 0022): la foto del emisor, del punto de venta, del receptor y de la sucursal.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE comprobante DROP CONSTRAINT comprobante_sucursal_nombre_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_sucursal_nombre_ck CHECK (sucursal_nombre IS NULL OR texto_de_una_linea_valido(sucursal_nombre, 100));
ALTER TABLE comprobante DROP CONSTRAINT comprobante_emisor_razon_social_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_emisor_razon_social_ck CHECK (texto_de_una_linea_valido(emisor_razon_social, 200));
ALTER TABLE comprobante DROP CONSTRAINT comprobante_emisor_domicilio_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_emisor_domicilio_ck CHECK (texto_de_una_linea_valido(emisor_domicilio_fiscal, 500));
ALTER TABLE comprobante DROP CONSTRAINT comprobante_emisor_iibb_numero_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_emisor_iibb_numero_ck CHECK (emisor_iibb_numero IS NULL OR numero_de_iibb_valido(emisor_iibb_numero));
ALTER TABLE comprobante DROP CONSTRAINT comprobante_pv_domicilio_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_pv_domicilio_ck CHECK (texto_de_una_linea_valido(punto_de_venta_domicilio, 500));
ALTER TABLE comprobante DROP CONSTRAINT comprobante_receptor_nombre_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_receptor_nombre_ck CHECK (receptor_nombre IS NULL OR texto_de_una_linea_valido(receptor_nombre, 200));
ALTER TABLE comprobante DROP CONSTRAINT comprobante_receptor_domicilio_ck;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_receptor_domicilio_ck CHECK (receptor_domicilio IS NULL OR texto_de_una_linea_valido(receptor_domicilio, 300));
