-- 0011_revertir_lectura_publica_de_marca: deshace la migración 0011_lectura_publica_de_marca (le quita al rol
-- público la lectura de `dominio.es_canonico`).
-- EL NÚMERO ES PROVISORIO, como el de la migración: se renumera junto con ella.
--
-- NO es destructiva: no toca ninguna fila ni ningún objeto, solo una concesión de lectura. Deja el catálogo
-- como estaba después de 0010. Ojo: la puerta web que ya use la configuración pública de la marca dejaría
-- de poder leer el host canónico (la consulta falla cerrada, con `42501`, y la página responde la neutra o
-- el error 503); conviene bajar primero ese código.
--
-- Este script NO lo aplica el ejecutor de migraciones (que solo toma los archivos `NNNN_nombre.sql` de la
-- carpeta `migraciones/`): se corre a mano, revisado, en una sola transacción y con el rol dueño de la base:
--
--     BEGIN;
--     \i migraciones/reversiones/0011_revertir_lectura_publica_de_marca.sql
--     COMMIT;

REVOKE SELECT (es_canonico) ON dominio FROM pedernal_publico;

-- Sin esta fila, la migración figuraría aplicada y el ejecutor no volvería a correrla.
DO $$
BEGIN
  IF to_regclass('public.migracion') IS NOT NULL THEN
    DELETE FROM public.migracion WHERE nombre LIKE '%\_lectura_publica_de_marca.sql' ESCAPE '\';
  END IF;
END
$$;
