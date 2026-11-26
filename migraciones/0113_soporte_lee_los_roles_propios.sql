-- 0113_soporte_lee_los_roles_propios: la plataforma (soporte) puede LEER el rol propio de una persona y las acciones de ese rol, tramo T5 de H4b (PR-A).
-- Diseño: Pedernal-docs/11-especificaciones/h4b-permisos-configurables.md §8 (T5). Para qué: `soporte.explicar` tiene que responder con el conjunto efectivo REAL de la persona
-- (rol propio incluido), no con la matriz del código; sin esta lectura no puede distinguir «rol propio sin la acción», «rol propio archivado» o «acción fuera del plan».
--
-- QUÉ CAMBIA (solo privilegios y políticas de LECTURA; ninguna fila, columna ni restricción cambia: compatible hacia atrás, el código de antes sigue funcionando):
--   1. `pedernal_plataforma` puede leer `membresia.rol_propio_id` (a las 4 columnas que ya leía suma la quinta).
--   2. `pedernal_plataforma` puede leer `rol_de_empresa (id, empresa_id, activo)` y `version_de_rol (empresa_id, rol_id, numero, acciones)`: solo lo que el cálculo necesita. NO el nombre
--      que el gerente le puso al rol, ni quién lo creó ni cuándo, ni la versión de control optimista.
--   3. Las políticas de esas dos tablas para la plataforma, con el mismo molde que 0004 y 0094: una permisiva abierta de lectura y una RESTRICTIVA que exige un actor de plataforma vigente
--      y firmado (sin actor, 0 filas). La plataforma NO recibe ningún privilegio de escritura sobre estas tablas: los roles propios son del gerente de cada empresa.
--
-- QUÉ NO CAMBIA, a propósito:
--   * El aislamiento de `pedernal_app` (cada empresa ve solo lo suyo) ni ninguna política de `membresia`, `rol_de_empresa` o `version_de_rol` de la aplicación.
--   * Los privilegios de escritura de la plataforma (siguen siendo solo pisos y versiones de plantilla de 0094).
--
-- Reversión: `migraciones/reversiones/0113_revertir_soporte_lee_los_roles_propios.sql` (no pierde datos: solo quita privilegios y políticas). El ejecutor no la aplica.
-- DEPENDE de 0004 (plataforma_actor_vigente, políticas de membresía), 0094 (rol_de_empresa, version_de_rol) y 0097 (membresia.rol_propio_id).

DO $$
BEGIN
  IF to_regclass('public.rol_de_empresa') IS NULL OR to_regclass('public.version_de_rol') IS NULL
     OR to_regprocedure('public.plataforma_actor_vigente()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'membresia' AND column_name = 'rol_propio_id') THEN
    RAISE EXCEPTION 'la lectura de roles propios por la plataforma requiere 0004, 0094 y 0097 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rol_de_empresa' AND policyname = 'rol_de_empresa_plataforma_leer') THEN
    RAISE EXCEPTION '0113 ya está aplicada (rol_de_empresa_plataforma_leer existe)' USING ERRCODE = '55000';
  END IF;
END
$$;

-- 1. membresia: la quinta columna legible (la política permisiva `membresia_plataforma_leer` y la restrictiva `membresia_plataforma_con_actor` de 0004 ya cubren las filas).
GRANT SELECT (rol_propio_id) ON membresia TO pedernal_plataforma;

-- 2. Solo las columnas que el cálculo del conjunto efectivo necesita.
GRANT SELECT (id, empresa_id, activo) ON rol_de_empresa TO pedernal_plataforma;
GRANT SELECT (empresa_id, rol_id, numero, acciones) ON version_de_rol TO pedernal_plataforma;

-- 3. Políticas (RLS ya está activa y forzada en ambas desde 0094).
CREATE POLICY rol_de_empresa_plataforma_leer ON rol_de_empresa FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY version_de_rol_plataforma_leer ON version_de_rol FOR SELECT TO pedernal_plataforma USING (true);
-- Sin un actor vigente firmado, 0 filas (el mismo texto que las demás tablas legibles por la plataforma).
CREATE POLICY rol_de_empresa_plataforma_con_actor ON rol_de_empresa AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY version_de_rol_plataforma_con_actor ON version_de_rol AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
