-- 0025_revertir_busqueda_por_documento: deshace la migración 0025_busqueda_por_documento (borra el índice
-- `comprobante_receptor_doc_pref_ix`).
--
-- NO es destructiva para los datos: un índice se puede volver a armar y no guarda nada que no esté en la tabla. El código sigue
-- funcionando sin el índice (la búsqueda por documento queda más lenta, no incorrecta), así que no hace falta bajar el código antes.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la carpeta `migraciones/`): se
-- corre a mano, revisado, con el rol dueño de la base. Borrar un índice toma un bloqueo corto sobre la tabla; en una tabla en uso conviene
-- la forma sin bloqueo, que no puede ir dentro de una transacción:
--
--     DROP INDEX CONCURRENTLY IF EXISTS public.comprobante_receptor_doc_pref_ix;
--     DELETE FROM migracion WHERE nombre = '0025_busqueda_por_documento.sql';
--
-- (o, en una base chica, dentro de una transacción con el `DROP INDEX` de abajo en lugar del `CONCURRENTLY`.) Borrar la fila de
-- `migracion` permite volver a aplicar la migración. Se puede repetir sin que cambie nada.

DROP INDEX IF EXISTS public.comprobante_receptor_doc_pref_ix;
DELETE FROM migracion WHERE nombre = '0025_busqueda_por_documento.sql';
