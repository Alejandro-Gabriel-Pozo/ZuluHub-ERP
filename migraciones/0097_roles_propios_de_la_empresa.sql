-- 0097_roles_propios_de_la_empresa: asignar un rol propio a una persona de la empresa, tramo T4 de H4b.
-- Diseño aceptado: Pedernal-docs/11-especificaciones/h4b-permisos-configurables.md §3.2 y §4 (2) (membresía y disparador de cambio de rol), §5 (invariantes I1, I9, I10, I12) y
-- §8 (tramos). Decisiones del dueño (14/11/2026 y 25/11/2026): el gerente crea roles propios y es el único que los asigna (`usuarios.asignar_rol` nace SOLO_GERENTE); los
-- roles propios y la asignación quedan fijados por la plataforma con pisos; la cantidad de roles propios no tiene límite comercial (perilla sin límite, sin migración).
--
-- QUÉ CAMBIA (todo aditivo y compatible hacia atrás: ninguna fila existente cambia de valor y el código de antes de T4 sigue funcionando):
--   1. `membresia.rol_propio_id` (nulo) + el valor `PROPIO` en `membresia_rol_ck` + `membresia_rol_propio_ck` (rol = 'PROPIO' <=> hay rol propio) + clave foránea compuesta
--      (rol_propio_id, empresa_id) -> rol_de_empresa: el rol propio es de la MISMA empresa.
--   2. El disparador `membresia_validar_cambio` (de 0005) sigue impidiendo todo cambio de rol salvo el traspaso de gerencia, suma la guarda «reactivar solo con invitación» (la nueva
--      política, combinada con la de apagar, abriría la reactivación directa) y suma la ÚNICA otra salida: el gerente activo de la
--      empresa reasigna entre ADMINISTRADOR, OPERADOR y un rol propio ACTIVO, sin cambiar `activo` y sin tocar nunca al gerente. Nadie asciende a gerente por acá. Una persona
--      APAGADA también se reasigna (a un rol base o a un rol propio activo): así no queda con un puntero a un rol propio archivado sin salida, y después se la reinvita.
--   3. La política `membresia_app_asignar_rol` y el privilegio de columna `rol_propio_id` (la política y el privilegio de `rol` ya existían por el traspaso).
--   4. Un rol propio no se archiva mientras tenga personas activas (S5), con el bloqueo que evita la carrera con una asignación simultánea.
--   5. Los pisos SOLO_GERENTE de las cinco acciones nuevas (`roles.ver`, `roles.crear`, `roles.editar`, `roles.archivar`, `usuarios.asignar_rol`): hasta que la plataforma
--      decida otra cosa, ninguna plantilla ni rol propio puede llevarlas, así que solo las tiene el gerente (que tiene todo el catálogo por definición).
--
-- QUÉ NO CAMBIA, a propósito:
--   * `invitacion_empresa` y su CHECK de rol: nadie se invita directamente a un rol propio. Se invita como ADMINISTRADOR u OPERADOR y el gerente le asigna el rol propio después
--     (así el flujo de aceptación de invitaciones queda intacto). Sumarlo después es aditivo.
--   * La perilla `roles_propios_por_empresa` vive en el catálogo de código, sin límite (`ILIMITADO`): no hay columna ni CHECK para ella.
--
-- Cambio de rol de un entrante de traspaso: si el entrante tenía un rol propio, al aceptar el traspaso pasa a GERENTE y el disparador le limpia `rol_propio_id` (sin eso el CHECK
-- lo rechazaría y el traspaso no se podría aceptar).
--
-- Reversión: `migraciones/reversiones/0097_revertir_roles_propios_de_la_empresa.sql` (FRENA si hay membresías con rol propio). El ejecutor no la aplica.
-- DEPENDE de 0002 (membresia), 0005 (disparador y políticas de membresía, traspaso_gerencia) y 0094 (rol_de_empresa, version_de_rol, piso_de_plataforma).

DO $$
BEGIN
  IF to_regclass('public.rol_de_empresa') IS NULL OR to_regclass('public.version_de_rol') IS NULL OR to_regclass('public.piso_de_plataforma') IS NULL
     OR to_regclass('public.traspaso_gerencia') IS NULL
     OR to_regprocedure('public.membresia_validar_cambio()') IS NULL OR to_regprocedure('public.app_persona_id()') IS NULL
     OR to_regprocedure('public.app_empresa_id()') IS NULL OR to_regprocedure('public.empresa_operable(uuid)') IS NULL THEN
    RAISE EXCEPTION 'los roles propios de la empresa requieren 0002, 0005 y 0094 aplicadas antes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'membresia' AND column_name = 'rol_propio_id') THEN
    RAISE EXCEPTION '0097 ya está aplicada (membresia.rol_propio_id existe)' USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. membresia: el rol propio
-- ---------------------------------------------------------------------------------------------
ALTER TABLE membresia ADD COLUMN rol_propio_id uuid;

ALTER TABLE membresia DROP CONSTRAINT membresia_rol_ck;
ALTER TABLE membresia ADD CONSTRAINT membresia_rol_ck CHECK (rol IN ('GERENTE', 'ADMINISTRADOR', 'OPERADOR', 'PROPIO'));
-- PROPIO <=> trae su rol propio. Sobre las filas de hoy (rol de los tres base, rol_propio_id nulo) se cumple sola.
ALTER TABLE membresia ADD CONSTRAINT membresia_rol_propio_ck CHECK ((rol = 'PROPIO') = (rol_propio_id IS NOT NULL));
-- El rol propio es de la misma empresa que la membresía (clave compuesta; con rol_propio_id nulo no se evalúa).
ALTER TABLE membresia ADD CONSTRAINT membresia_rol_propio_fkey
  FOREIGN KEY (rol_propio_id, empresa_id) REFERENCES rol_de_empresa (id, empresa_id);
-- Quién tiene cada rol propio (archivar exige que nadie activo lo tenga; la pantalla cuenta personas).
CREATE INDEX membresia_rol_propio_ix ON membresia (empresa_id, rol_propio_id) WHERE rol_propio_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 2. El disparador de cambio de rol
-- ---------------------------------------------------------------------------------------------
-- Reemplaza al de 0005 con la misma firma. Lo que ya hacía queda igual (el gerente activo no se apaga; el rol cambia solo por un traspaso aceptado en esta transacción);
-- se suma la reasignación entre roles que no son el de gerente y el vínculo al rol propio.
CREATE OR REPLACE FUNCTION membresia_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_traspaso boolean;
BEGIN
  IF OLD.rol = 'GERENTE' AND OLD.activo AND NOT NEW.activo THEN
    RAISE EXCEPTION 'el gerente no se apaga: se traspasa'
      USING ERRCODE = '23514', CONSTRAINT = 'membresia_gerente_no_se_apaga';
  END IF;

  -- Reactivar a una persona apagada es solo del flujo de invitación (0002). Las políticas permisivas se combinan por separado en USING y en WITH CHECK: la fila apagada la deja ver
  -- `membresia_app_apagar` y la fila ya activa la deja pasar `membresia_app_asignar_rol`, así que SIN esta guarda cualquier sesión de la aplicación reactivaría por UPDATE directo
  -- (lo que antes de 0097 ninguna combinación permitía). La guarda repite lo que ya pide `membresia_invitado_reactivar` (la invitación del token aceptada por esa persona) y
  -- vale solo para quien está sujeto a la RLS (la aplicación); el dueño de la base que la evade (migraciones, arreglos a mano) no queda afectado.
  IF NOT OLD.activo AND NEW.activo AND pg_catalog.row_security_active('public.membresia')
     AND NOT public.invitacion_aceptada_en((SELECT public.app_token_invitacion()), OLD.empresa_id, OLD.persona_id, NULL) THEN
    -- El mismo error que daba la RLS antes de 0097 (insufficient_privilege): el código que traduce errores no ve diferencia.
    RAISE EXCEPTION 'una persona apagada solo se reactiva con una invitación aceptada'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.rol IS DISTINCT FROM OLD.rol OR NEW.rol_propio_id IS DISTINCT FROM OLD.rol_propio_id THEN
    -- (a) Traspaso de gerencia: con las dos membresías activas y un traspaso ACEPTADO en ESTA transacción (xmin = el xid en curso: uno viejo no se reutiliza).
    v_traspaso := OLD.activo AND NEW.activo AND EXISTS (
      SELECT 1 FROM public.traspaso_gerencia t
       WHERE t.empresa_id = OLD.empresa_id
         AND t.estado = 'ACEPTADO'
         AND t.xmin = pg_current_xact_id()::xid
         AND (
           (OLD.rol = 'GERENTE' AND NEW.rol = 'ADMINISTRADOR' AND t.saliente_persona_id = OLD.persona_id)
           OR (NEW.rol = 'GERENTE' AND t.entrante_persona_id = OLD.persona_id)
         )
    );
    IF v_traspaso THEN
      -- El entrante que tenía un rol propio lo deja al pasar a gerente (el CHECK exige PROPIO <=> rol propio).
      IF NEW.rol = 'GERENTE' THEN NEW.rol_propio_id := NULL; END IF;
      RETURN NEW;
    END IF;

    -- (b) Asignación del gerente: entre ADMINISTRADOR, OPERADOR y un rol propio ACTIVO de la empresa; sin cambiar `activo` (la persona puede estar apagada: se la reasigna y
    -- después se la reinvita) y sin tocar nunca a un gerente (ni como origen ni como destino); quien la hace es el gerente ACTIVO de la empresa (contexto firmado).
    -- Ahí nadie asciende a gerente y nadie baja al gerente.
    IF NEW.activo = OLD.activo
       AND OLD.rol <> 'GERENTE' AND NEW.rol <> 'GERENTE'
       AND NEW.persona_id = OLD.persona_id AND NEW.empresa_id = OLD.empresa_id
       AND EXISTS (
         SELECT 1 FROM public.membresia g
          WHERE g.empresa_id = OLD.empresa_id AND g.rol = 'GERENTE' AND g.activo
            AND g.persona_id = public.app_persona_id()
       )
       AND (
         NEW.rol_propio_id IS NULL
         -- FOR SHARE: una asignación y el archivado del mismo rol no se cruzan (el que llega segundo espera y relee el estado confirmado).
         OR EXISTS (
           SELECT 1 FROM public.rol_de_empresa r
            WHERE r.id = NEW.rol_propio_id AND r.empresa_id = NEW.empresa_id AND r.activo
              FOR SHARE
         )
       ) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'el rol de una membresía solo cambia al aceptar un traspaso de gerencia o cuando el gerente asigna un rol'
      USING ERRCODE = '23514', CONSTRAINT = 'membresia_rol_sin_traspaso';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Política y privilegio de la asignación
-- ---------------------------------------------------------------------------------------------
-- Las políticas permisivas se suman (OR): esta deja tocar la fila de un miembro ACTIVO que no es el gerente; qué columnas, lo limita el privilegio por columna, y qué cambio es
-- válido, el disparador (que además exige que quien actúa sea el gerente). El gerente nunca entra (ni antes ni después). Una persona APAGADA no necesita política nueva: la de apagar
-- (`membresia_app_apagar`, 0002) ya deja pasar su fila (USING rol <> 'GERENTE', WITH CHECK NOT activo), de modo que el gerente la reasigna sin poder reactivarla: reactivar sigue
-- siendo solo del flujo de invitación, como antes de 0097.
CREATE POLICY membresia_app_asignar_rol ON membresia FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND activo AND rol <> 'GERENTE')
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND activo AND rol <> 'GERENTE');
GRANT UPDATE (rol_propio_id) ON membresia TO pedernal_app;

-- ---------------------------------------------------------------------------------------------
-- 4. Archivar un rol propio: solo si nadie activo lo tiene (S5)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION rol_de_empresa_validar_archivado() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  -- Esta fila ya está bloqueada por el UPDATE: una asignación simultánea espera (FOR SHARE) y, al seguir, ve el rol archivado y se rechaza.
  IF OLD.activo AND NOT NEW.activo AND EXISTS (
    SELECT 1 FROM public.membresia m
     WHERE m.empresa_id = OLD.empresa_id AND m.rol_propio_id = OLD.id AND m.activo
  ) THEN
    RAISE EXCEPTION 'el rol propio tiene personas activas: se reasignan antes de archivarlo'
      USING ERRCODE = '23514', CONSTRAINT = 'rol_de_empresa_con_personas';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER rol_de_empresa_archivado BEFORE UPDATE ON rol_de_empresa
  FOR EACH ROW EXECUTE FUNCTION rol_de_empresa_validar_archivado();

-- ---------------------------------------------------------------------------------------------
-- 5. Pisos de las acciones nuevas: solo el gerente
-- ---------------------------------------------------------------------------------------------
-- Estas acciones nacen en el código de T4. Sin el piso, la sincronización de plantillas las daría por «introducidas sin piso» y el gerente las podría delegar a un rol propio:
-- con el piso, ninguna plantilla ni rol propio las lleva (la base lo rechaza). Idempotente: las cuatro `roles.*` ya vienen en la semilla de 0094 (que se regenera desde la matriz mientras no está sellada) y quedan como están; esta migración siembra las que falten (hoy `usuarios.asignar_rol`, que llega a la matriz en T4b-2) y cubre una base donde 0094 ya se aplicó sin ellas.
INSERT INTO piso_de_plataforma (accion, tipo, autor) VALUES
  ('roles.ver', 'SOLO_GERENTE', 'migracion:0097'),
  ('roles.crear', 'SOLO_GERENTE', 'migracion:0097'),
  ('roles.editar', 'SOLO_GERENTE', 'migracion:0097'),
  ('roles.archivar', 'SOLO_GERENTE', 'migracion:0097'),
  ('usuarios.asignar_rol', 'SOLO_GERENTE', 'migracion:0097')
ON CONFLICT (accion) DO NOTHING;
