-- 0024_pasaporte_con_letras: el pasaporte del receptor se guarda TAL CUAL figura, con letras y números (el argentino son 3 letras y 6
-- números: ABC123456), de 6 a 9 caracteres. Decisión del dueño, 2026-11-06 (Q5 de `catalogo-de-datos-preguntas.md`; plan
-- `emitir-plan-factura-a.md` decisión 9); a ARCA se informa solo la parte numérica (la calcula el código al armar el pedido, no la base).
--
-- Qué cambia, en lenguaje de negocio: hasta hoy la base solo dejaba guardar como documento del receptor un número (1 a 11 dígitos). Desde
-- esta migración, cuando el tipo de documento es PASAPORTE, la base también deja guardar letras mayúsculas y números, de 6 a 9
-- caracteres, con al menos una cifra del 1 al 9 (sin ella no habría número que informar a ARCA). Todo lo que se podía guardar antes se
-- sigue pudiendo guardar, y todo lo que se rechazaba (CUIT con verificador mal, un nombre en el documento, 12 dígitos...) se sigue
-- rechazando.
--
-- Reglas de esta migración (las mismas de 0001 a 0023):
--  * Es ADITIVA: NO agrega columnas ni toca una sola fila. El pasaporte va en la columna de siempre, `receptor_documento_numero`. El
--    CHECK `comprobante_receptor_documento_ck` se REEMPLAZA, con el mismo nombre, por uno más ancho (lo de antes + el pasaporte con
--    letras): toda fila existente lo cumple, así que el alta no puede fallar por datos. Se vuelve a recorrer la tabla (el ejecutor fija
--    `lock_timeout`: si otra sesión no suelta la tabla, falla en vez de hacer cola). Cambiar un CHECK no es un UPDATE: los comprobantes
--    emitidos, que son inmutables, no se tocan ni se vuelven a escribir.
--  * Su reversión es un script aparte, revisado (`migraciones/reversiones/0024_revertir_pasaporte_con_letras.sql`): se NIEGA a correr
--    si ya hay un pasaporte con letras guardado (no se puede convertir sin inventar datos, y un comprobante emitido no se corrige).
--    El ejecutor no la aplica.
--  * El largo (6 a 9) y el conjunto (A-Z y 0-9) de lo NUEVO son copia de las constantes de `src/primitivas/identificacion-fiscal/
--    pasaporte.ts`, y `[1-9]` de `numero-de-documento-para-arca.ts`: `test/integracion/pasaporte-migracion.test.ts` falla si difieren.
--    La base NO exige que el pasaporte de solo dígitos tenga 6 a 9: acepta como antes 1 a 11 (compatibilidad con lo ya guardado); la
--    regla más estricta de las emisiones nuevas vive en el código (orquestador, 2026-11-06, P5).
--  * Se aplica una sola vez, como las anteriores (el ejecutor lleva el registro). Sin SECURITY DEFINER ni nada que pida superusuario.
--  * DEPENDE de 0009 (el comprobante con el documento del receptor y `cuit_valido`); se comprueba al empezar.
--  * `MIGRACION_REQUERIDA` sube a 0024 en el mismo cambio: el código que guarda pasaportes con letras necesita esta migración.

DO $$
BEGIN
  IF to_regprocedure('public.cuit_valido(text)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.comprobante') AND conname = 'comprobante_receptor_documento_ck'
  ) THEN
    RAISE EXCEPTION 'el pasaporte con letras requiere 0009_facturacion aplicada antes (falta el documento del receptor del comprobante)'
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE public.comprobante
  DROP CONSTRAINT comprobante_receptor_documento_ck,
  ADD CONSTRAINT comprobante_receptor_documento_ck CHECK (
    receptor_documento_numero IS NULL
    OR ((receptor_documento_numero ~ '^[0-9]{1,11}$'
         OR (receptor_documento_tipo = 'PASAPORTE'
             AND receptor_documento_numero ~ '^[A-Z0-9]{6,9}$'
             AND receptor_documento_numero ~ '[1-9]'))
        AND (receptor_documento_tipo NOT IN ('CUIT', 'CUIL', 'CDI') OR cuit_valido(receptor_documento_numero))));
