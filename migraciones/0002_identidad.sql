-- 0002_identidad: membresías, asignaciones a sucursal e invitaciones (H3; ADR-011, ADR-012).
--
-- Reglas de esta migración (las mismas de 0001):
--  * Es compatible hacia atrás: crea tablas, funciones y políticas nuevas. Lo único que toca de
--    0001 son dos claves únicas de apoyo (empresa y persona), que no cambian ningún dato.
--  * No agrega NINGUNA función SECURITY DEFINER: la única del esquema sigue siendo
--    `contexto_firmado()` (un meta-test lo exige). Todo lo que acá corre, corre con los permisos de
--    quien consulta y sujeto a RLS.
--  * Toda función nueva fija `search_path = pg_catalog, public, pg_temp`, califica sus tablas con
--    `public.` y nace sin EXECUTE para PUBLIC; solo se otorga al rol que la necesita.
--  * Nadie recibe DELETE ni TRUNCATE: nada se borra. INSERT y UPDATE van por columna.
--  * Sin contraseñas, claves ni cadenas de conexión.
--
-- Decisiones de diseño (las que no estaban cerradas en el encargo; todas probadas por tests):
--
--  D1. Contextos que comparten un rol. El rol `pedernal_app` sirve a dos contextos firmados: el
--      OPERATIVO (con empresa) y el de INVITACION (con el hash del token y nada más). Cada política
--      nombra el contexto en su nombre (`*_app_*` operativo, `*_invitado_*` invitación) y ambas se
--      suman (OR) como en cualquier política permisiva: con el contexto equivocado, la otra mira un
--      valor NULL y no deja pasar nada. Ninguna política puede dar TRUE ante un NULL.
--  D2. Sin ciclos de políticas. Postgres rechaza ("infinite recursion detected in policy") cualquier
--      ciclo entre tablas, aunque el contexto de la consulta nunca lo recorra. El grafo es:
--      persona -> membresia -> invitacion -> invitacion_empresa;  empresa -> invitacion_empresa;
--      tenant -> empresa e invitacion. `invitacion` NUNCA mira `persona`: que quien acepta sea la
--      persona del email de la invitación lo impone una FK compuesta (invitacion_aceptada_por_fkey
--      contra persona_id_email_uk), no una política.
--  D3. `invitacion_empresa` copia email, token_hash, tipo y estado de la cabecera para que las
--      políticas del invitado y los índices únicos parciales trabajen sobre columnas propias. Las
--      copias NO pueden mentir: dos FK compuestas las atan a la cabecera. `estado` sigue a la
--      invitación por `ON UPDATE CASCADE` (las acciones referenciales las ejecuta el motor con los
--      permisos del dueño y sin pasar por RLS, y nadie tiene UPDATE sobre esta tabla). Revocar o
--      aceptar la invitación libera solo el índice de "una pendiente por empresa y email".
--  D4. Después de resolverse (ACEPTADA o REVOCADA) la invitación queda congelada: un disparador
--      impide cambiar nada, salvo completar `reemplazada_por` en una REVOCADA que aún no lo tenga.
--  D5. Una aceptación no puede fecharse después del vencimiento (`invitacion_aceptada_a_tiempo_ck`):
--      `aceptada_en` es el `ahora` de la aplicación, igual que `emitida_en`; la base no mira su reloj.
--  D6. El OPERATIVO solo puede apagar (activo/activa = false) y nunca al GERENTE (se traspasa, no se
--      apaga). Reactivar solo lo hace el flujo de invitación, y exige que la invitación incluya la
--      empresa y el MISMO rol que ya tiene la membresía: `rol` no es actualizable por nadie.
--  D7. No hay política que deje a un OPERATIVO insertar membresías ni asignaciones: nacen con
--      una aceptación. Insertar una invitación con RETURNING exige poder LEERLA, y recién se puede
--      leer cuando existe su fila en `invitacion_empresa`: el alta de la cabecera NO lleva RETURNING
--      (el id lo genera la aplicación, no hace falta).
--  D8. El WITH CHECK de las políticas permisivas se suma (OR) entre TODAS las de la tabla, sin
--      importar cuál dejó pasar la fila en el USING. Por eso el WITH CHECK de cada política nombra
--      su propio contexto (un test del catálogo lo exige): sin eso, el invitado podía dejar su
--      invitación REVOCADA con el WITH CHECK de la política de revocación de la empresa.
--  D9. Que el alta del gerente invite a una sola empresa lo impone el dominio, no la base: un índice
--      único por `invitacion_id` no incluiría `empresa_id` y dejaría detectar datos de otro cliente
--      (un test del catálogo lo prohíbe).
--  D10. El invitado puede leer sus membresías y asignaciones recién después de que la invitación
--      figure ACEPTADA por esa persona (la política solo mira `aceptada_por`, para no tocar
--      `persona`; ver D2).

-- ---------------------------------------------------------------------------------------------
-- Claves únicas de apoyo en tablas de 0001 (para las FK compuestas de abajo)
-- ---------------------------------------------------------------------------------------------
-- Todas las empresas de una invitación son del mismo tenant que la invitación.
ALTER TABLE empresa ADD CONSTRAINT empresa_id_tenant_uk UNIQUE (id, tenant_id);
-- Quien acepta una invitación tiene el mismo email que ella. El email de una persona no se puede
-- cambiar (ningún rol tiene UPDATE sobre `persona.email`).
ALTER TABLE persona ADD CONSTRAINT persona_id_email_uk UNIQUE (id, email);

-- ---------------------------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------------------------

-- La invitación. El id lo genera la aplicación (SIN valor por defecto): el token se deriva del id,
-- y la base guarda solo el hash del token. "Vencida" no se guarda: se calcula con `vence_en`.
CREATE TABLE invitacion (
  id                uuid NOT NULL,
  tenant_id         uuid NOT NULL,
  tipo              text NOT NULL,
  email             text NOT NULL,
  token_hash        text NOT NULL,
  estado            text NOT NULL DEFAULT 'PENDIENTE',
  emitida_en        timestamptz NOT NULL,  -- el `ahora` de la aplicación, no now()
  vence_en          timestamptz NOT NULL,
  emitida_por       uuid,                  -- NULL: la emitió la plataforma
  aceptada_por      uuid,
  aceptada_en       timestamptz,
  revocada_en       timestamptz,
  motivo_revocacion text,
  reemplazada_por   uuid,                  -- reenvío: la invitación nueva que la reemplaza
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT invitacion_pkey PRIMARY KEY (id),
  CONSTRAINT invitacion_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant (id),
  CONSTRAINT invitacion_emitida_por_fkey FOREIGN KEY (emitida_por) REFERENCES persona (id),
  -- Con aceptada_por NULL la FK no se evalúa (MATCH SIMPLE). Con aceptada_por, la persona tiene que
  -- ser la del email de la invitación (D2).
  CONSTRAINT invitacion_aceptada_por_fkey FOREIGN KEY (aceptada_por, email) REFERENCES persona (id, email),
  CONSTRAINT invitacion_reemplazada_por_fkey FOREIGN KEY (reemplazada_por) REFERENCES invitacion (id),
  CONSTRAINT invitacion_token_hash_uk UNIQUE (token_hash),
  -- Clave natural de idempotencia del reenvío: una invitación se reemplaza una sola vez.
  CONSTRAINT invitacion_reemplazada_por_uk UNIQUE (reemplazada_por),
  -- Apoyo de las FK compuestas de invitacion_empresa (D3).
  CONSTRAINT invitacion_copias_uk UNIQUE (id, tenant_id, email, token_hash, tipo),
  CONSTRAINT invitacion_id_estado_uk UNIQUE (id, estado),
  CONSTRAINT invitacion_tipo_ck CHECK (tipo IN ('ALTA_GERENTE', 'USUARIO')),
  CONSTRAINT invitacion_estado_ck CHECK (estado IN ('PENDIENTE', 'ACEPTADA', 'REVOCADA')),
  -- La misma regla que persona_email_ck (un test compara ambas con la regla de TypeScript).
  CONSTRAINT invitacion_email_ck CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  CONSTRAINT invitacion_token_hash_ck CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT invitacion_vence_ck CHECK (vence_en > emitida_en),
  CONSTRAINT invitacion_aceptacion_ck CHECK (
    (aceptada_por IS NULL) = (aceptada_en IS NULL)
    AND (estado = 'ACEPTADA') = (aceptada_por IS NOT NULL)
  ),
  CONSTRAINT invitacion_aceptada_a_tiempo_ck CHECK (aceptada_en IS NULL OR aceptada_en < vence_en),
  CONSTRAINT invitacion_revocacion_ck CHECK (
    (revocada_en IS NULL) = (motivo_revocacion IS NULL)
    AND (estado = 'REVOCADA') = (revocada_en IS NOT NULL)
    AND (motivo_revocacion IS NULL OR btrim(motivo_revocacion) <> '')
  ),
  CONSTRAINT invitacion_reemplazo_ck CHECK (
    reemplazada_por IS NULL OR (estado = 'REVOCADA' AND reemplazada_por <> id)
  )
);

-- Las empresas a las que invita una invitación, con el rol de cada una. Las columnas `email`,
-- `token_hash`, `tipo` y `estado` son COPIAS de la cabecera (D3): la base las ata con FK compuestas.
CREATE TABLE invitacion_empresa (
  invitacion_id uuid NOT NULL,
  empresa_id    uuid NOT NULL,
  tenant_id     uuid NOT NULL,
  rol           text NOT NULL,
  email         text NOT NULL,
  token_hash    text NOT NULL,
  estado        text NOT NULL DEFAULT 'PENDIENTE',
  tipo          text NOT NULL,
  CONSTRAINT invitacion_empresa_pkey PRIMARY KEY (invitacion_id, empresa_id),
  -- Las copias inmutables coinciden con la cabecera...
  CONSTRAINT invitacion_empresa_copias_fkey FOREIGN KEY (invitacion_id, tenant_id, email, token_hash, tipo)
    REFERENCES invitacion (id, tenant_id, email, token_hash, tipo),
  -- ...y el estado la sigue solo cuando cambia (la acción la ejecuta el motor, no el cliente).
  CONSTRAINT invitacion_empresa_estado_fkey FOREIGN KEY (invitacion_id, estado)
    REFERENCES invitacion (id, estado) ON UPDATE CASCADE,
  -- Todas las empresas de una invitación son del tenant de la invitación. Además de la integridad,
  -- hace las veces de la FK a `empresa(id)` que el catálogo exige en toda tabla con empresa_id.
  CONSTRAINT invitacion_empresa_empresa_tenant_fkey FOREIGN KEY (empresa_id, tenant_id)
    REFERENCES empresa (id, tenant_id),
  CONSTRAINT invitacion_empresa_rol_ck CHECK (rol IN ('GERENTE', 'ADMINISTRADOR', 'OPERADOR')),
  -- El gerente solo entra por el alta, y el alta invita solo al gerente.
  CONSTRAINT invitacion_gerente_solo_en_alta CHECK (rol <> 'GERENTE' OR tipo = 'ALTA_GERENTE'),
  CONSTRAINT invitacion_alta_solo_gerente CHECK (tipo <> 'ALTA_GERENTE' OR rol = 'GERENTE')
);
-- Una sola invitación pendiente por empresa y email.
CREATE UNIQUE INDEX invitacion_empresa_pendiente_uk ON invitacion_empresa (empresa_id, email)
  WHERE estado = 'PENDIENTE';
-- Nunca dos altas vigentes para la misma empresa, aunque cambie el email.
CREATE UNIQUE INDEX invitacion_empresa_gerente_uk ON invitacion_empresa (empresa_id)
  WHERE estado = 'PENDIENTE' AND rol = 'GERENTE';
CREATE INDEX invitacion_empresa_empresa_ix ON invitacion_empresa (empresa_id);
CREATE INDEX invitacion_empresa_token_ix ON invitacion_empresa (token_hash);

-- Las sucursales a las que invita, por empresa de la invitación. La clave incluye `empresa_id`:
-- una única sin él dejaría detectar datos de otro cliente (un test del catálogo lo exige).
CREATE TABLE invitacion_sucursal (
  invitacion_id uuid NOT NULL,
  empresa_id    uuid NOT NULL,
  sucursal_id   uuid NOT NULL,
  CONSTRAINT invitacion_sucursal_pkey PRIMARY KEY (invitacion_id, empresa_id, sucursal_id),
  CONSTRAINT invitacion_sucursal_invitacion_empresa_fkey FOREIGN KEY (invitacion_id, empresa_id)
    REFERENCES invitacion_empresa (invitacion_id, empresa_id),
  CONSTRAINT invitacion_sucursal_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id)
    REFERENCES sucursal (id, empresa_id),
  CONSTRAINT invitacion_sucursal_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id)
);

-- Persona <-> empresa con rol. Una persona tiene a lo sumo una membresía por empresa.
CREATE TABLE membresia (
  empresa_id     uuid NOT NULL,
  persona_id     uuid NOT NULL,
  rol            text NOT NULL,
  activo         boolean NOT NULL DEFAULT true,
  invitacion_id  uuid,  -- la invitación con la que entró (la primera; reactivar no la cambia)
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT membresia_pkey PRIMARY KEY (empresa_id, persona_id),
  CONSTRAINT membresia_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id),
  CONSTRAINT membresia_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES persona (id),
  CONSTRAINT membresia_invitacion_id_fkey FOREIGN KEY (invitacion_id) REFERENCES invitacion (id),
  CONSTRAINT membresia_rol_ck CHECK (rol IN ('GERENTE', 'ADMINISTRADOR', 'OPERADOR'))
);
-- Un solo gerente activo por empresa.
CREATE UNIQUE INDEX membresia_gerente_uk ON membresia (empresa_id) WHERE rol = 'GERENTE' AND activo;
CREATE INDEX membresia_persona_ix ON membresia (persona_id);

-- A qué sucursales de una empresa puede entrar un miembro. Solo se asigna a quien ya es miembro de
-- esa empresa (FK compuesta a membresía) y a sucursales de esa misma empresa.
CREATE TABLE asignacion_sucursal (
  empresa_id     uuid NOT NULL,
  persona_id     uuid NOT NULL,
  sucursal_id    uuid NOT NULL,
  activa         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT asignacion_sucursal_pkey PRIMARY KEY (empresa_id, persona_id, sucursal_id),
  CONSTRAINT asignacion_sucursal_membresia_fkey FOREIGN KEY (empresa_id, persona_id)
    REFERENCES membresia (empresa_id, persona_id),
  CONSTRAINT asignacion_sucursal_sucursal_fkey FOREIGN KEY (sucursal_id, empresa_id)
    REFERENCES sucursal (id, empresa_id),
  CONSTRAINT asignacion_sucursal_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES empresa (id)
);

-- ---------------------------------------------------------------------------------------------
-- Disparadores
-- ---------------------------------------------------------------------------------------------

-- Máquina de estados de la invitación (D4). Un test exige que la base permita exactamente las
-- transiciones de `TRANSICIONES_DE_INVITACION` del dominio.
CREATE FUNCTION invitacion_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.emitida_en IS DISTINCT FROM OLD.emitida_en
     OR NEW.vence_en IS DISTINCT FROM OLD.vence_en
     OR NEW.emitida_por IS DISTINCT FROM OLD.emitida_por
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en
  THEN
    RAISE EXCEPTION 'los datos de emisión de una invitación no se pueden cambiar'
      USING ERRCODE = '23514', CONSTRAINT = 'invitacion_inmutable';
  END IF;

  IF NEW.estado <> OLD.estado THEN
    IF NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('PENDIENTE', 'ACEPTADA'),
        ('PENDIENTE', 'REVOCADA')
      ) AS permitida (desde, hasta)
      WHERE permitida.desde = OLD.estado AND permitida.hasta = NEW.estado
    ) THEN
      RAISE EXCEPTION 'transición de estado no permitida: % -> %', OLD.estado, NEW.estado
        USING ERRCODE = '23514', CONSTRAINT = 'invitacion_transicion_invalida';
    END IF;
  ELSIF OLD.estado <> 'PENDIENTE' THEN
    -- Ya resuelta: queda congelada. Lo único que se completa es el reemplazo de una revocada.
    IF NEW.aceptada_por IS DISTINCT FROM OLD.aceptada_por
       OR NEW.aceptada_en IS DISTINCT FROM OLD.aceptada_en
       OR NEW.revocada_en IS DISTINCT FROM OLD.revocada_en
       OR NEW.motivo_revocacion IS DISTINCT FROM OLD.motivo_revocacion
       OR (NEW.reemplazada_por IS DISTINCT FROM OLD.reemplazada_por AND OLD.reemplazada_por IS NOT NULL)
    THEN
      RAISE EXCEPTION 'una invitación resuelta no se puede modificar'
        USING ERRCODE = '23514', CONSTRAINT = 'invitacion_resuelta_inmutable';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Los nombres ordenan los disparadores: `_cambio` valida con OLD/NEW antes de que `_version` los toque.
CREATE TRIGGER invitacion_cambio BEFORE UPDATE ON invitacion
  FOR EACH ROW EXECUTE FUNCTION invitacion_validar_cambio();
CREATE TRIGGER invitacion_version BEFORE UPDATE ON invitacion
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER membresia_version BEFORE UPDATE ON membresia
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER asignacion_sucursal_version BEFORE UPDATE ON asignacion_sucursal
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();

-- ---------------------------------------------------------------------------------------------
-- Funciones de apoyo de las políticas del contexto de INVITACION
--
-- Corren con los permisos de quien consulta (el invitado) y sujetas a RLS: solo ven lo que sus
-- políticas de lectura le dejan ver. Reciben el hash del token como parámetro (la política lo pasa
-- como `(SELECT app_token_invitacion())`, que Postgres evalúa una sola vez por sentencia) en vez de
-- verificar la firma del contexto una vez por fila.
-- No consultan ninguna tabla cuyas políticas las llamen (sería recursión).
-- ---------------------------------------------------------------------------------------------

-- ¿La invitación del token fue ACEPTADA por esta persona, e incluye esta empresa (y este rol, si se
-- lo pide)? Es la autoridad para crear o reactivar la membresía, las asignaciones y la auditoría.
CREATE FUNCTION invitacion_aceptada_en(p_token text, p_empresa uuid, p_persona uuid, p_rol text)
  RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.invitacion i
    JOIN public.invitacion_empresa ie ON ie.invitacion_id = i.id
    WHERE i.token_hash = p_token
      AND i.estado = 'ACEPTADA'
      AND i.aceptada_por = p_persona
      AND ie.empresa_id = p_empresa
      AND (p_rol IS NULL OR ie.rol = p_rol)
  )
$$;

-- ¿La empresa está en condiciones de recibir a quien acepta la invitación del token? Una invitación
-- de usuario exige empresa operable (ella y su tenant ACTIVE). El alta del gerente exige la empresa
-- todavía en PROVISIONING con el tenant ACTIVE: es la que se activa con la aceptación.
CREATE FUNCTION invitacion_opera_en(p_token text, p_empresa uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1
    FROM public.invitacion i
    JOIN public.invitacion_empresa ie ON ie.invitacion_id = i.id
    WHERE i.token_hash = p_token
      AND ie.empresa_id = p_empresa
      AND CASE i.tipo
            WHEN 'USUARIO' THEN public.empresa_operable(p_empresa)
            ELSE EXISTS (
              SELECT 1
              FROM public.empresa e
              JOIN public.tenant t ON t.id = e.tenant_id
              WHERE e.id = p_empresa AND e.estado = 'PROVISIONING' AND t.estado = 'ACTIVE'
            )
          END
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Privilegios: por columna, y nadie recibe DELETE
-- ---------------------------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION invitacion_aceptada_en(text, uuid, uuid, text), invitacion_opera_en(text, uuid)
  TO pedernal_app;

-- app (contextos OPERATIVO e INVITACION)
GRANT SELECT ON membresia, asignacion_sucursal, invitacion, invitacion_empresa, invitacion_sucursal
  TO pedernal_app;
GRANT INSERT (empresa_id, persona_id, rol, invitacion_id) ON membresia TO pedernal_app;
GRANT UPDATE (activo) ON membresia TO pedernal_app;  -- `rol` no es actualizable: nadie asciende
GRANT INSERT (empresa_id, persona_id, sucursal_id) ON asignacion_sucursal TO pedernal_app;
GRANT UPDATE (activa) ON asignacion_sucursal TO pedernal_app;
GRANT INSERT (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en, emitida_por)
  ON invitacion TO pedernal_app;
GRANT UPDATE (estado, aceptada_por, aceptada_en, revocada_en, motivo_revocacion, reemplazada_por)
  ON invitacion TO pedernal_app;
GRANT INSERT (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, estado, tipo)
  ON invitacion_empresa TO pedernal_app;
GRANT INSERT (invitacion_id, empresa_id, sucursal_id) ON invitacion_sucursal TO pedernal_app;
GRANT INSERT (email) ON persona TO pedernal_app;  -- solo el invitado, para su propio email
GRANT UPDATE (estado, motivo_estado) ON empresa TO pedernal_app;  -- solo para activar el alta

-- plataforma: emite y revoca altas; no lee membresías, asignaciones ni sucursales invitadas
GRANT SELECT ON invitacion, invitacion_empresa TO pedernal_plataforma;
GRANT INSERT (id, tenant_id, tipo, email, token_hash, emitida_en, vence_en, emitida_por)
  ON invitacion TO pedernal_plataforma;
GRANT UPDATE (estado, revocada_en, motivo_revocacion, reemplazada_por) ON invitacion TO pedernal_plataforma;
GRANT INSERT (invitacion_id, empresa_id, tenant_id, rol, email, token_hash, estado, tipo)
  ON invitacion_empresa TO pedernal_plataforma;

-- ---------------------------------------------------------------------------------------------
-- RLS: activa y forzada en toda tabla nueva; sin política no hay acceso
-- ---------------------------------------------------------------------------------------------
ALTER TABLE invitacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitacion FORCE ROW LEVEL SECURITY;
ALTER TABLE invitacion_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitacion_empresa FORCE ROW LEVEL SECURITY;
ALTER TABLE invitacion_sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitacion_sucursal FORCE ROW LEVEL SECURITY;
ALTER TABLE membresia ENABLE ROW LEVEL SECURITY;
ALTER TABLE membresia FORCE ROW LEVEL SECURITY;
ALTER TABLE asignacion_sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE asignacion_sucursal FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------------------------

-- invitacion_empresa: copia de email/token/tipo/estado. Sus políticas miran solo columnas propias,
-- para que `invitacion` pueda mirarla sin ciclos (D2).
CREATE POLICY invitacion_empresa_app_leer ON invitacion_empresa FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY invitacion_empresa_app_alta ON invitacion_empresa FOR INSERT TO pedernal_app
  WITH CHECK (
    empresa_id = (SELECT app_empresa_id())
    AND empresa_operable(empresa_id)
    AND tipo = 'USUARIO'
    AND estado = 'PENDIENTE'
  );
CREATE POLICY invitacion_empresa_invitado_leer ON invitacion_empresa FOR SELECT TO pedernal_app
  USING (token_hash = (SELECT app_token_invitacion()));
CREATE POLICY invitacion_empresa_plataforma_leer ON invitacion_empresa FOR SELECT TO pedernal_plataforma
  USING (true);
CREATE POLICY invitacion_empresa_plataforma_alta ON invitacion_empresa FOR INSERT TO pedernal_plataforma
  WITH CHECK (true);

-- invitacion
CREATE POLICY invitacion_app_leer ON invitacion FOR SELECT TO pedernal_app
  USING (
    EXISTS (
      SELECT 1 FROM invitacion_empresa ie
      WHERE ie.invitacion_id = invitacion.id AND ie.empresa_id = (SELECT app_empresa_id())
    )
  );
-- Una empresa solo invita usuarios, de su propio tenant, a nombre de la persona del contexto.
CREATE POLICY invitacion_app_alta ON invitacion FOR INSERT TO pedernal_app
  WITH CHECK (
    tipo = 'USUARIO'
    AND tenant_id = (SELECT tenant_de_empresa((SELECT app_empresa_id())))
    AND empresa_operable((SELECT app_empresa_id()))
    AND emitida_por IS NOT DISTINCT FROM (SELECT app_persona_id())
  );
-- Revocar (también completar el reemplazo de una ya revocada): la invitación tiene que incluir la
-- empresa. Aceptar no está al alcance de la empresa: el CHECK de aceptación lo exige completo.
CREATE POLICY invitacion_app_revocar ON invitacion FOR UPDATE TO pedernal_app
  USING (
    empresa_operable((SELECT app_empresa_id()))
    AND EXISTS (
      SELECT 1 FROM invitacion_empresa ie
      WHERE ie.invitacion_id = invitacion.id AND ie.empresa_id = (SELECT app_empresa_id())
    )
  )
  -- El WITH CHECK de las políticas permisivas se suma (OR) entre TODAS las de la tabla, sin importar
  -- cuál dejó pasar la fila en el USING: si no nombrara el contexto, el invitado podría dejar su
  -- propia invitación REVOCADA. Por eso repite la condición de contexto.
  WITH CHECK (
    estado = 'REVOCADA'
    AND empresa_operable((SELECT app_empresa_id()))
    AND EXISTS (
      SELECT 1 FROM invitacion_empresa ie
      WHERE ie.invitacion_id = invitacion.id AND ie.empresa_id = (SELECT app_empresa_id())
    )
  );
CREATE POLICY invitacion_invitado_leer ON invitacion FOR SELECT TO pedernal_app
  USING (token_hash = (SELECT app_token_invitacion()));
-- Aceptar: solo la propia invitación, y solo desde PENDIENTE. Que `aceptada_por` sea la persona del
-- email de la invitación lo impone la FK compuesta (D2); que sea a tiempo, el CHECK (D5).
CREATE POLICY invitacion_invitado_aceptar ON invitacion FOR UPDATE TO pedernal_app
  USING (token_hash = (SELECT app_token_invitacion()) AND estado = 'PENDIENTE')
  WITH CHECK (token_hash = (SELECT app_token_invitacion()) AND estado = 'ACEPTADA');
CREATE POLICY invitacion_plataforma_leer ON invitacion FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY invitacion_plataforma_alta ON invitacion FOR INSERT TO pedernal_plataforma WITH CHECK (true);
CREATE POLICY invitacion_plataforma_cambiar ON invitacion FOR UPDATE TO pedernal_plataforma
  USING (true) WITH CHECK (true);

-- invitacion_sucursal
CREATE POLICY invitacion_sucursal_app_leer ON invitacion_sucursal FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY invitacion_sucursal_app_alta ON invitacion_sucursal FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY invitacion_sucursal_invitado_leer ON invitacion_sucursal FOR SELECT TO pedernal_app
  USING (
    EXISTS (
      SELECT 1 FROM invitacion_empresa ie
      WHERE ie.invitacion_id = invitacion_sucursal.invitacion_id
        AND ie.empresa_id = invitacion_sucursal.empresa_id
        AND ie.token_hash = (SELECT app_token_invitacion())
    )
  );

-- membresia
CREATE POLICY membresia_app_leer ON membresia FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
-- Apagar, nunca al gerente (D6). Reactivar queda para el flujo de invitación.
CREATE POLICY membresia_app_apagar ON membresia FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND rol <> 'GERENTE')
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND NOT activo);
CREATE POLICY membresia_invitado_leer ON membresia FOR SELECT TO pedernal_app
  USING (invitacion_aceptada_en((SELECT app_token_invitacion()), empresa_id, persona_id, NULL));
-- Crear la membresía: la invitación del token está aceptada por esa persona, incluye la empresa con
-- ese mismo rol, es la que queda registrada, y la empresa admite la aceptación.
CREATE POLICY membresia_invitado_alta ON membresia FOR INSERT TO pedernal_app
  WITH CHECK (
    invitacion_id = (SELECT i.id FROM invitacion i WHERE i.token_hash = (SELECT app_token_invitacion()))
    AND invitacion_aceptada_en((SELECT app_token_invitacion()), empresa_id, persona_id, rol)
    AND invitacion_opera_en((SELECT app_token_invitacion()), empresa_id)
  );
-- Reactivar una membresía apagada. `rol` no cambia: si la invitación trae otro rol, el WITH CHECK
-- lo rechaza (error, no "0 filas").
CREATE POLICY membresia_invitado_reactivar ON membresia FOR UPDATE TO pedernal_app
  USING (NOT activo AND invitacion_aceptada_en((SELECT app_token_invitacion()), empresa_id, persona_id, NULL))
  WITH CHECK (
    activo
    AND invitacion_aceptada_en((SELECT app_token_invitacion()), empresa_id, persona_id, rol)
    AND invitacion_opera_en((SELECT app_token_invitacion()), empresa_id)
  );

-- asignacion_sucursal
CREATE POLICY asignacion_sucursal_app_leer ON asignacion_sucursal FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY asignacion_sucursal_app_apagar ON asignacion_sucursal FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id) AND NOT activa);
CREATE POLICY asignacion_sucursal_invitado_leer ON asignacion_sucursal FOR SELECT TO pedernal_app
  USING (invitacion_aceptada_en((SELECT app_token_invitacion()), empresa_id, persona_id, NULL));
-- Solo las sucursales que la invitación del token lista para esa empresa.
CREATE POLICY asignacion_sucursal_invitado_alta ON asignacion_sucursal FOR INSERT TO pedernal_app
  WITH CHECK (
    invitacion_aceptada_en((SELECT app_token_invitacion()), empresa_id, persona_id, NULL)
    AND invitacion_opera_en((SELECT app_token_invitacion()), empresa_id)
    AND EXISTS (
      SELECT 1
      FROM invitacion_sucursal s
      JOIN invitacion_empresa ie ON ie.invitacion_id = s.invitacion_id AND ie.empresa_id = s.empresa_id
      WHERE ie.token_hash = (SELECT app_token_invitacion())
        AND s.empresa_id = asignacion_sucursal.empresa_id
        AND s.sucursal_id = asignacion_sucursal.sucursal_id
    )
  );
CREATE POLICY asignacion_sucursal_invitado_reactivar ON asignacion_sucursal FOR UPDATE TO pedernal_app
  USING (NOT activa AND invitacion_aceptada_en((SELECT app_token_invitacion()), empresa_id, persona_id, NULL))
  WITH CHECK (
    activa
    AND invitacion_aceptada_en((SELECT app_token_invitacion()), empresa_id, persona_id, NULL)
    AND invitacion_opera_en((SELECT app_token_invitacion()), empresa_id)
    AND EXISTS (
      SELECT 1
      FROM invitacion_sucursal s
      JOIN invitacion_empresa ie ON ie.invitacion_id = s.invitacion_id AND ie.empresa_id = s.empresa_id
      WHERE ie.token_hash = (SELECT app_token_invitacion())
        AND s.empresa_id = asignacion_sucursal.empresa_id
        AND s.sucursal_id = asignacion_sucursal.sucursal_id
    )
  );

-- Tablas de 0001 que el contexto de INVITACION también necesita ------------------------------

-- persona: las de la empresa (los miembros) y, para el invitado, solo la del email de su invitación.
CREATE POLICY persona_miembros_app ON persona FOR SELECT TO pedernal_app
  USING (
    EXISTS (
      SELECT 1 FROM membresia m
      WHERE m.persona_id = persona.id AND m.empresa_id = (SELECT app_empresa_id())
    )
  );
CREATE POLICY persona_invitado_leer ON persona FOR SELECT TO pedernal_app
  USING (
    email = (SELECT i.email FROM invitacion i WHERE i.token_hash = (SELECT app_token_invitacion()))
  );
CREATE POLICY persona_invitado_alta ON persona FOR INSERT TO pedernal_app
  WITH CHECK (
    email = (SELECT i.email FROM invitacion i WHERE i.token_hash = (SELECT app_token_invitacion()))
  );

-- empresa y tenant: el invitado ve las de su invitación (las necesita para que `empresa_operable`
-- funcione con sus permisos).
CREATE POLICY empresa_invitado_leer ON empresa FOR SELECT TO pedernal_app
  USING (
    EXISTS (
      SELECT 1 FROM invitacion_empresa ie
      WHERE ie.empresa_id = empresa.id AND ie.token_hash = (SELECT app_token_invitacion())
    )
  );
CREATE POLICY tenant_invitado_leer ON tenant FOR SELECT TO pedernal_app
  USING (
    EXISTS (
      SELECT 1 FROM invitacion i
      WHERE i.tenant_id = tenant.id AND i.token_hash = (SELECT app_token_invitacion())
    )
  );
-- Activar el alta: PROVISIONING -> ACTIVE de una empresa cuyo alta de gerente fue aceptada y cuyo
-- gerente ya tiene su membresía activa. El disparador de 0001 valida la transición; esta política
-- cierra el resto. Ningún contexto OPERATIVO pasa por acá: su token de invitación es NULL.
CREATE POLICY empresa_invitado_activar ON empresa FOR UPDATE TO pedernal_app
  USING (
    estado = 'PROVISIONING'
    AND tenant_activo(tenant_id)
    AND EXISTS (
      SELECT 1
      FROM invitacion i
      JOIN invitacion_empresa ie ON ie.invitacion_id = i.id
      JOIN membresia m ON m.empresa_id = ie.empresa_id AND m.persona_id = i.aceptada_por
      WHERE i.token_hash = (SELECT app_token_invitacion())
        AND i.tipo = 'ALTA_GERENTE' AND i.estado = 'ACEPTADA'
        AND ie.empresa_id = empresa.id AND ie.rol = 'GERENTE'
        AND m.rol = 'GERENTE' AND m.activo
    )
  )
  WITH CHECK (
    estado = 'ACTIVE'
    AND motivo_estado IS NULL
    AND tenant_activo(tenant_id)
    AND EXISTS (
      SELECT 1
      FROM invitacion i
      JOIN invitacion_empresa ie ON ie.invitacion_id = i.id
      JOIN membresia m ON m.empresa_id = ie.empresa_id AND m.persona_id = i.aceptada_por
      WHERE i.token_hash = (SELECT app_token_invitacion())
        AND i.tipo = 'ALTA_GERENTE' AND i.estado = 'ACEPTADA'
        AND ie.empresa_id = empresa.id AND ie.rol = 'GERENTE'
        AND m.rol = 'GERENTE' AND m.activo
    )
  );

-- auditoria_empresa: quien acepta deja constancia, a su nombre, en las empresas de su invitación
-- (operables o, en el alta del gerente, todavía en PROVISIONING).
CREATE POLICY auditoria_empresa_invitado_alta ON auditoria_empresa FOR INSERT TO pedernal_app
  WITH CHECK (
    invitacion_aceptada_en((SELECT app_token_invitacion()), empresa_id, actor_persona_id, NULL)
    AND (
      invitacion_opera_en((SELECT app_token_invitacion()), empresa_id)
      OR empresa_operable(empresa_id)
    )
  );
