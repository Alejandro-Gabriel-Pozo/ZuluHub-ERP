-- 0011_lectura_publica_de_marca: le concede a la puerta pública (`zuluhub_publico`) la lectura de UNA
-- columna más, `dominio.es_canonico`, para que la página por host sepa cuál es el host canónico de la
-- aplicación de la marca (marcas y planes, §B.2.3 y §B.2.5; tramo M4b).
-- EL NÚMERO 0011 ES PROVISORIO: se renumera al integrar si otra migración entra antes (0009 es facturación
-- y 0010 autenticación). El nombre `*_lectura_publica_de_marca.sql` y las pruebas no dependen del número.
--
-- Por qué hace falta tocar la base (se probó que NO alcanza con el host consultado): la configuración
-- pública necesita «el host canónico de la aplicación de la marca». El host consultado puede ser un alias
-- del canónico (`www.`, un dominio viejo) o de otra superficie (la landing o la carta, que enlazan a la
-- aplicación), y ninguna columna que el rol público ya lee distingue al canónico del resto. La vista
-- `resolucion_de_host` tampoco lo trae. La concesión por columna es lo más chico que lo resuelve.
--
-- Reglas de esta migración (las mismas de 0001 a 0010):
--  * Es ADITIVA: una sola concesión de `SELECT` por columna. No crea objetos, no modifica ni borra ninguna
--    fila, política, función ni privilegio existente. Su reversión es un script aparte, revisado, que NO
--    pierde datos: `migraciones/reversiones/0011_revertir_lectura_publica_de_marca.sql`. El ejecutor no lo
--    aplica.
--  * No agrega NINGUNA función SECURITY DEFINER ni política: lo que el rol público ve de `dominio` lo sigue
--    decidiendo `dominio_publico_leer` (solo dominios ACTIVOS), que no cambia.
--  * Nadie recibe INSERT, UPDATE, DELETE ni TRUNCATE. El rol sigue siendo de solo lectura.
--  * DEPENDE de 0007 (`dominio`, el rol `zuluhub_publico` y su política); se comprueba al empezar.
--  * No crea roles ni da LOGIN ni contraseñas. Sin claves ni cadenas de conexión en este archivo.
--
-- Decisión de diseño (probada por tests):
--
--  P1. `es_canonico` es información pública por naturaleza (es el host al que apuntan los enlaces de los
--      mails y de la página) y no es un secreto: se ve únicamente en dominios ACTIVOS, por la misma política
--      de siempre. Sigue SIN ver el titular, el motivo, quién lo registró, cuándo se verificó ni el `id`.

DO $$
BEGIN
  IF to_regclass('public.dominio') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuluhub_publico')
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'dominio' AND policyname = 'dominio_publico_leer'
     ) THEN
    RAISE EXCEPTION '0011 requiere 0007_marcas_y_planes aplicada antes (falta la tabla dominio, el rol público o su política)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

GRANT SELECT (es_canonico) ON dominio TO zuluhub_publico;
