-- 0105_anonimizacion_de_partes: anonimizar una parte del directorio (derecho de supresión de datos personales). Decisión del dueño, 25/11/2026: se construye el caso de uso
-- `anonimizarParte` (solo servidor, solo el gerente) y una parte con saldo distinto de cero no se anonimiza. Reemplaza a DEC-0305 («sin acción de anonimizar»).
--
-- QUÉ CAMBIA (todo aditivo y compatible hacia atrás: ninguna fila existente cambia de valor; el código anterior sigue funcionando porque nadie anonimizaba):
--   1. El disparador diferido `parte_anonimizada_sin_relaciones` (de 0034, que corre al confirmar una transición a ANONIMIZADA) suma una segunda exigencia: ningún vínculo de la
--      parte, activo o no, puede conservar el `cargo` (el cargo de una persona en una empresa es un dato personal que `parte_anonimizada_ck` no mira). Previene: un caso de uso que
--      apaga los vínculos pero olvida vaciar el cargo. Mismo mecanismo y mismo momento que la exigencia de roles y vínculos que ya tenía.
--   2. El piso SOLO_GERENTE de la acción nueva `partes.anonimizar`: sin el piso, la sincronización de plantillas daría la acción por «introducida sin piso» y el gerente podría
--      delegarla en un rol propio. Mismo mecanismo que 0097. Idempotente. (En una base NUEVA el piso ya lo trae la semilla de 0094, que se regenera mientras no esté sellada: acá no hace nada. Esta línea cubre las bases donde 0094 ya corrió sin la acción.)
--
-- QUÉ NO CAMBIA, a propósito: tablas, columnas, políticas y privilegios. El rol de la aplicación ya puede vaciar los datos de `parte` (UPDATE de las columnas personales y de
-- `estado`; la base fija `anonimizada_en` y la versión), apagar `parte_rol` y `parte_vinculo` (activo y cargo) y encolar en `trabajo`. Las partes ya anonimizadas (ninguna
-- hasta hoy) no se vuelven a evaluar: el disparador solo mira la transición.
--
-- Reversión: `migraciones/reversiones/0105_revertir_anonimizacion_de_partes.sql` (deja el disparador como estaba en 0034 y saca el piso que sembró). El ejecutor no la aplica.
-- DEPENDE de 0034 (parte, parte_vinculo, el disparador y su función) y 0094 (piso_de_plataforma).

CREATE OR REPLACE FUNCTION parte_anonimizada_sin_relaciones() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF EXISTS (SELECT 1 FROM public.parte_rol r WHERE r.empresa_id = NEW.empresa_id AND r.parte_id = NEW.id AND r.activo)
     OR EXISTS (SELECT 1 FROM public.parte_vinculo v WHERE v.empresa_id = NEW.empresa_id AND v.activo
                  AND (v.parte_id = NEW.id OR v.de_parte_id = NEW.id)) THEN
    RAISE EXCEPTION 'una parte anonimizada no puede conservar roles ni vínculos activos'
      USING ERRCODE = '23514', CONSTRAINT = 'parte_anonimizada_con_relaciones';
  END IF;
  IF EXISTS (SELECT 1 FROM public.parte_vinculo v WHERE v.empresa_id = NEW.empresa_id AND v.cargo IS NOT NULL
               AND (v.parte_id = NEW.id OR v.de_parte_id = NEW.id)) THEN
    RAISE EXCEPTION 'una parte anonimizada no puede conservar el cargo de sus vínculos'
      USING ERRCODE = '23514', CONSTRAINT = 'parte_anonimizada_con_cargo';
  END IF;
  RETURN NULL;
END
$$;

-- Hasta que la plataforma decida otra cosa, ninguna plantilla ni rol propio puede llevar `partes.anonimizar` (la base lo rechaza): solo la tiene el gerente. Idempotente.
INSERT INTO piso_de_plataforma (accion, tipo, autor) VALUES
  ('partes.anonimizar', 'SOLO_GERENTE', 'migracion:0105')
ON CONFLICT (accion) DO NOTHING;
