-- 0025_busqueda_por_documento: un índice para buscar comprobantes por el comienzo del número de documento del receptor, dentro de una
-- sucursal. Decisión del dueño, 2026-11-07 (sesión «Rendimiento B», informe `rendimiento-medicion-2026-11.md` §5 índice A y §6 punto 3).
--
-- Qué cambia, en lenguaje de negocio: buscar «4688…» en el listado de comprobantes dejaba de ser instantáneo con muchos comprobantes (con
-- 1.000.000 en una empresa recorría todos los de la sucursal). Con este índice la búsqueda por el comienzo del documento va directo a lo
-- que coincide. El código lo usa pidiendo un RANGO explícito (`>= '4688' y < '4689'`): con `LIKE` el planificador no usa el índice bajo
-- RLS, porque `textlike` no es «leakproof» y `~>=~`/`~<~` sí.
--
-- Reglas de esta migración (las mismas de 0001 a 0024):
--  * Es ADITIVA: solo agrega un índice. No toca columnas, filas, RLS ni permisos: el aislamiento por empresa sigue siendo el de siempre y
--    el índice lo respeta porque EMPIEZA por `empresa_id` (toda consulta del listado filtra por empresa y sucursal).
--  * Su reversión es un script aparte, revisado (`migraciones/reversiones/0025_revertir_busqueda_por_documento.sql`): borra solo este
--    índice. El código sigue funcionando sin él (la búsqueda queda más lenta, no incorrecta), así que no hace falta bajar el código antes.
--    El ejecutor no la aplica.
--  * Se aplica una sola vez (el ejecutor lleva el registro). Sin SECURITY DEFINER ni nada que pida superusuario.
--  * DEPENDE de 0009 (la tabla `comprobante`) y de 0016 (`sucursal_id`); se comprueba al empezar.
--  * `MIGRACION_REQUERIDA` sube a 0025 en el mismo cambio, por la convención del repositorio. Ojo: el código funciona igual sin el índice
--    (solo más lento); la guarda lo exige para que lo que se probó sea lo que corre.
--
-- BLOQUEO (leer antes de aplicar en una base con muchos comprobantes): el ejecutor corre cada archivo dentro de una transacción, y
-- `CREATE INDEX CONCURRENTLY` no puede correr dentro de una transacción; por eso este archivo usa `CREATE INDEX` común, que toma un
-- bloqueo que IMPIDE ESCRIBIR en `comprobante` (no leer) mientras se arma. `lock_timeout` del ejecutor (10 s) solo acota la espera por el
-- bloqueo, y `statement_timeout` (5 min) corta un armado demasiado largo. Con la base de hoy (sin comprobantes) es instantáneo. Con una
-- tabla grande, el armado se hace ANTES, a mano y sin bloquear las escrituras, con el rol dueño y fuera de una transacción:
--
--     CREATE INDEX CONCURRENTLY IF NOT EXISTS comprobante_receptor_doc_pref_ix
--       ON public.comprobante (empresa_id, sucursal_id, receptor_documento_numero text_pattern_ops)
--       WHERE receptor_documento_numero IS NOT NULL;
--
-- y recién después se aplica esta migración, que con `IF NOT EXISTS` no hace nada más. (Si el armado concurrente falla deja un índice
-- «inválido»: borrarlo con `DROP INDEX CONCURRENTLY` y repetir.)

DO $$
BEGIN
  IF to_regclass('public.comprobante') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = to_regclass('public.comprobante') AND attname = 'sucursal_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'la búsqueda por documento requiere 0009_facturacion y 0016_comprobante_con_sucursal aplicadas antes'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- `text_pattern_ops`: comparación por bytes, sin depender del locale de la base (el rango `~>=~`/`~<~` es de prefijo). Parcial: la gran
-- mayoría de las facturas a consumidor final no tiene documento y no hace falta indexarlas.
CREATE INDEX IF NOT EXISTS comprobante_receptor_doc_pref_ix
  ON public.comprobante (empresa_id, sucursal_id, receptor_documento_numero text_pattern_ops)
  WHERE receptor_documento_numero IS NOT NULL;
