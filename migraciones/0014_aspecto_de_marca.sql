-- 0014_aspecto_de_marca: el aspecto de una marca, además de sus cuatro colores (marcas y planes, §B.3; tramo
-- M7a): cinco datos de LISTA CERRADA en la definición versionada de la marca (`version_de_marca.aspecto`) y
-- su lectura por la puerta pública (`zuluhub_publico`) y por la aplicación.
-- EL NÚMERO 0014 ES PROVISORIO: se renumera al integrar si otra migración entra antes. El nombre
-- `*_aspecto_de_marca.sql` y las pruebas no dependen del número.
--
-- Qué hace:
--  * Crea `aspecto_valido(jsonb)` (IMMUTABLE, como `tema_valido`): un objeto cuyas claves son la lista
--    CERRADA de tokens y cuyo valor es uno de los de SU lista, en MAYÚSCULAS con guion bajo
--    (src/modulos/marcas/dominio/aspecto.ts):
--        estilo     CLARO_CON_BORDES | MODERNO | CLASICO | LUDICO
--        superficie NEUTRA | CALIDA | FRIA
--        esquinas   RECTA | SUAVE | REDONDEADA
--        titulos    SANS | SERIF
--        ingreso    DIVIDIDO | CENTRADO | CON_IMAGEN
--    Un objeto vacío vale: las claves son opcionales (lo que falta hereda de la marca padre o toma el defecto,
--    que decide el dominio y no la base).
--  * Agrega `version_de_marca.aspecto jsonb NOT NULL DEFAULT '{}'` con `CHECK (aspecto_valido(aspecto))`.
--  * Privilegios por columna, ESPEJO EXACTO de los de `tema` (0007): SELECT al rol público y a la aplicación
--    (la plataforma ya lee la tabla entera), INSERT y UPDATE solo a la plataforma, y EXECUTE de la función de
--    validación solo a la plataforma (quien escribe la columna que valida).
--
-- Reglas de esta migración (las mismas de 0001 a 0013):
--  * Es ADITIVA: una función, una columna con valor por defecto constante (no reescribe la tabla) y
--    concesiones. Las versiones que ya existen quedan con `'{}'`, que vale: toman los defectos, así que
--    NINGUNA marca cambia de aspecto sin que el dueño lo decida. No modifica ni borra ninguna fila, política,
--    disparador ni privilegio existente. Su reversión es un script aparte, revisado, que BORRA la columna
--    (y con ella los aspectos que se hayan cargado): `migraciones/reversiones/0014_revertir_aspecto_de_marca.sql`.
--    El ejecutor no lo aplica.
--  * Es REPETIBLE: `CREATE OR REPLACE`, `ADD COLUMN IF NOT EXISTS` y concesiones, que repetidas no cambian
--    nada (el ejecutor además registra lo aplicado y no la corre dos veces). Corre dentro de la transacción
--    del ejecutor, que ya serializa con el bloqueo asesor.
--  * No agrega NINGUNA función SECURITY DEFINER ni política: lo que el rol público ve de `version_de_marca` lo
--    sigue decidiendo `version_de_marca_publico_leer` (solo versiones CONFIRMADAS y ya empezadas), que no
--    cambia; borradores y versiones futuras siguen sin verse. Los disparadores de 0007 ya impiden modificar
--    una versión confirmada, sea cual sea la columna.
--  * La función fija su `search_path`, no lee ninguna tabla y nace sin EXECUTE para PUBLIC.
--  * Nadie recibe DELETE ni TRUNCATE. No crea roles ni da LOGIN ni contraseñas. Sin claves ni cadenas de
--    conexión en este archivo.
--  * DEPENDE de 0007 (`version_de_marca`, sus roles); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.version_de_marca') IS NULL
     OR to_regprocedure('public.tema_valido(jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuluhub_publico')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuluhub_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuluhub_plataforma') THEN
    RAISE EXCEPTION '0014 requiere 0007_marcas_y_planes aplicada antes (falta la tabla version_de_marca, tema_valido o alguno de los roles)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- El aspecto de una versión de marca: claves de la lista CERRADA de tokens, valores de su lista, todos
-- textos. Un valor que no es texto (número, nulo, lista, objeto) no vale, como tampoco una clave ajena.
CREATE OR REPLACE FUNCTION aspecto_valido(a jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN a IS NULL OR jsonb_typeof(a) <> 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_each(a) AS e (token, valor)
       WHERE jsonb_typeof(e.valor) <> 'string'
          OR NOT coalesce(
               CASE e.token
                 WHEN 'estilo' THEN (e.valor #>> '{}') IN ('CLARO_CON_BORDES', 'MODERNO', 'CLASICO', 'LUDICO')
                 WHEN 'superficie' THEN (e.valor #>> '{}') IN ('NEUTRA', 'CALIDA', 'FRIA')
                 WHEN 'esquinas' THEN (e.valor #>> '{}') IN ('RECTA', 'SUAVE', 'REDONDEADA')
                 WHEN 'titulos' THEN (e.valor #>> '{}') IN ('SANS', 'SERIF')
                 WHEN 'ingreso' THEN (e.valor #>> '{}') IN ('DIVIDIDO', 'CENTRADO', 'CON_IMAGEN')
                 ELSE false
               END,
               false)
    )
  END
$$;

REVOKE ALL ON FUNCTION aspecto_valido(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aspecto_valido(jsonb) TO zuluhub_plataforma;

ALTER TABLE version_de_marca
  ADD COLUMN IF NOT EXISTS aspecto jsonb NOT NULL DEFAULT '{}'
  CONSTRAINT version_de_marca_aspecto_ck CHECK (aspecto_valido(aspecto));

-- Lo mismo que `tema` (0007): lo leen la puerta pública y la aplicación; lo escribe solo la plataforma.
GRANT SELECT (aspecto) ON version_de_marca TO zuluhub_publico, zuluhub_app;
GRANT INSERT (aspecto), UPDATE (aspecto) ON version_de_marca TO zuluhub_plataforma;
