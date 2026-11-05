-- 0021_ingresos_brutos_no_contribuyente: Ingresos Brutos del emisor es el NÚMERO de inscripción O «No contribuyente» (D-115 y D-116,
-- decisión del dueño, 2026-11-05; RG 1415 Anexo II A.I.a punto 4: el comprobante lleva el número de inscripción en Ingresos Brutos o
-- la condición de no contribuyente). Las condiciones LOCAL, CONVENIO_MULTILATERAL y EXENTO (supuesto del diseño, sin fuente) dejan de
-- pedirse y de imprimirse; esta migración NO las quita de la base: las deja leer (no hay datos reales, pero tiene que ser segura igual).
--
-- Reglas de esta migración (las mismas de 0001 a 0019):
--  * Es ADITIVA: NO agrega columnas. Reutiliza `datos_fiscales.iibb_condicion` y `comprobante.emisor_iibb_condicion` con UN valor
--    nuevo, `NO_CONTRIBUYENTE`, y suma una restricción. No cambia el valor de ninguna fila, ni una `version`, ni una función, un
--    disparador, un privilegio o una política: el disparador de alta del comprobante (0009/0016/0017) ya compara la condición con
--    la versión de datos fiscales, así que congela el valor nuevo sin tocarlo.
--  * Los dos CHECK de condición se REEMPLAZAN con el mismo nombre por uno más ancho (los tres valores de antes + el nuevo): toda fila
--    existente sigue cumpliéndolo, así que el alta de la restricción no puede fallar por datos. Se vuelve a validar la tabla (un
--    recorrido; son tablas chicas). El ejecutor fija `lock_timeout`: si otra sesión no suelta la tabla, falla en vez de hacer cola.
--  * Restricción nueva `datos_fiscales_iibb_eleccion_ck`: número y «No contribuyente» no pueden estar a la vez. Ninguna fila existente
--    puede tener `NO_CONTRIBUYENTE` (el valor no existía), así que es válida sobre los datos de hoy. Que una versión CONFIRMADA
--    traiga uno de los dos lo decide el dominio (`confirmarDatosFiscales`), NO la base: exigirlo acá rompería las versiones ya
--    confirmadas al volver a escribirlas. Reconfirmar sí exige elegir.
--  * Su reversión es un script aparte, revisado (`migraciones/reversiones/0021_revertir_ingresos_brutos_no_contribuyente.sql`): se
--    NEGA a correr si ya hay un `NO_CONTRIBUYENTE` guardado (volver atrás lo perdería o lo dejaría inválido). El ejecutor no lo aplica.
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro). La numeración salta la 0020 a propósito (decisión
--    del orquestador: está reservada).
--  * DEPENDE de 0009 (el comprobante con su foto del emisor); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.datos_fiscales') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = to_regclass('public.comprobante') AND attname = 'emisor_iibb_condicion' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Ingresos Brutos «No contribuyente» requiere 0009_facturacion aplicada antes (falta la foto del emisor en el comprobante)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE public.datos_fiscales
  DROP CONSTRAINT datos_fiscales_iibb_condicion_ck,
  ADD CONSTRAINT datos_fiscales_iibb_condicion_ck CHECK (
    iibb_condicion IN ('LOCAL', 'CONVENIO_MULTILATERAL', 'EXENTO', 'NO_CONTRIBUYENTE')),
  ADD CONSTRAINT datos_fiscales_iibb_eleccion_ck CHECK (
    iibb_numero IS NULL OR iibb_condicion IS DISTINCT FROM 'NO_CONTRIBUYENTE');

ALTER TABLE public.comprobante
  DROP CONSTRAINT comprobante_emisor_iibb_condicion_ck,
  ADD CONSTRAINT comprobante_emisor_iibb_condicion_ck CHECK (
    emisor_iibb_condicion IS NULL
    OR emisor_iibb_condicion IN ('LOCAL', 'CONVENIO_MULTILATERAL', 'EXENTO', 'NO_CONTRIBUYENTE')),
  ADD CONSTRAINT comprobante_emisor_iibb_eleccion_ck CHECK (
    emisor_iibb_numero IS NULL OR emisor_iibb_condicion IS DISTINCT FROM 'NO_CONTRIBUYENTE');
