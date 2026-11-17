-- 0041_tope_de_textos_por_marca: el vocabulario de una marca admite hasta 2000 textos (antes 500, migración 0007). DEC-0200.
--
-- Por qué: el catálogo de textos del código (src/capacidades/vocabulario) ya pasó de 500 claves y el diccionario por defecto tiene que seguir siendo un
-- vocabulario válido para la base (marcas-sql.test.ts); cada etapa suma textos, así que el tope no puede ir dentro de la migración de una etapa.
--
-- `vocabulario_valido` (0007) NO se toca: sigue siendo LA regla de cada clave y de cada texto, con su tope de 500. La función nueva parte el vocabulario
-- en tramos de a 500 claves y le pide a esa misma función que valide cada tramo: la forma de las claves y de los textos vive en un solo lugar.
-- No cambia ninguna fila: quien ya tenga un vocabulario de hasta 500 claves lo sigue teniendo válido. Reversión: migraciones/reversiones/.
CREATE FUNCTION vocabulario_valido_ampliado(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN v IS NULL OR jsonb_typeof(v) <> 'object' THEN false
    ELSE (SELECT count(*) FROM jsonb_object_keys(v)) <= 2000
         AND coalesce((
           SELECT bool_and(public.vocabulario_valido(tramos.tramo))
             FROM (
               SELECT jsonb_object_agg(numeradas.clave, numeradas.texto) AS tramo
                 FROM (
                   SELECT e.key AS clave, e.value AS texto, row_number() OVER (ORDER BY e.key) / 500 AS grupo
                     FROM jsonb_each(v) AS e
                 ) AS numeradas
                GROUP BY numeradas.grupo
             ) AS tramos
         ), true)
  END
$$;

-- Como el resto de las validaciones de marcas (0007): las ejecuta quien escribe la columna.
GRANT EXECUTE ON FUNCTION vocabulario_valido_ampliado(jsonb) TO pedernal_plataforma;

ALTER TABLE version_de_marca DROP CONSTRAINT version_de_marca_vocabulario_ck;
ALTER TABLE version_de_marca ADD CONSTRAINT version_de_marca_vocabulario_ck CHECK (vocabulario_valido_ampliado(vocabulario));
