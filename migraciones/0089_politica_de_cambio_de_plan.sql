-- 0089_politica_de_cambio_de_plan (número provisorio): política de cambio de plan configurable (H-14a, dueño 18/11/2026).
-- QUÉ HACE: crea TRES tablas nuevas, todas de solo inserción, y carga la política versión 1 = 1, 1, 0 (anticipación de suba 1 día, de baja 1 día, arrepentimiento 0 días).
--   · politica_de_cambio_de_plan: una política para toda la plataforma, con historial (versión consecutiva, la última rige).
--   · condiciones_de_cambio_de_plan: con qué política nació cada cambio de plan (suba o baja) y hasta qué día se puede arrepentir; una fila por cambio.
--   · arrepentimiento_de_plan: qué cambio se arrepintió y cuál es el cambio nuevo que lo deshizo; único por cambio arrepentido.
-- NO TOCA `plan_de_tenant` ni ninguna tabla existente: es ADITIVA y no cambia datos. Los cambios anteriores a esta migración no tienen fila de condiciones (se tratan como «sin arrepentimiento»).
-- Reversión: `migraciones/reversiones/0089_revertir_politica_de_cambio_de_plan.sql` (borra SOLO las tres tablas nuevas y sus funciones; pierde lo que se haya registrado en ellas).
-- DEPENDE de 0001 (`solo_insercion`) y de 0004 y 0007 (`plan_de_tenant`, roles y políticas de plataforma). Probada por `test/integracion/politica-de-cambio-migracion.test.ts`.
-- El tope de días (365) es `MAXIMO_DE_DIAS_DE_LA_POLITICA_DE_PLAN` en `src/primitivas/tiempo/dias-de-la-politica-de-plan.ts`: una prueba falla si difieren.

CREATE TABLE politica_de_cambio_de_plan (
  version                       integer PRIMARY KEY CONSTRAINT politica_de_cambio_de_plan_version_ck CHECK (version > 0),
  dias_de_anticipacion_de_suba  integer NOT NULL CONSTRAINT politica_de_cambio_de_plan_suba_ck CHECK (dias_de_anticipacion_de_suba BETWEEN 0 AND 365),
  dias_de_anticipacion_de_baja  integer NOT NULL CONSTRAINT politica_de_cambio_de_plan_baja_ck CHECK (dias_de_anticipacion_de_baja BETWEEN 0 AND 365),
  dias_de_arrepentimiento       integer NOT NULL CONSTRAINT politica_de_cambio_de_plan_arrepentimiento_ck CHECK (dias_de_arrepentimiento BETWEEN 0 AND 365),
  motivo                        text NOT NULL CONSTRAINT politica_de_cambio_de_plan_motivo_ck CHECK (btrim(motivo) <> ''),
  definida_por                  text NOT NULL CONSTRAINT politica_de_cambio_de_plan_definida_por_ck CHECK (definida_por <> ''),
  creado_en                     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE condiciones_de_cambio_de_plan (
  tenant_id             uuid NOT NULL,
  numero                integer NOT NULL,
  sentido               text NOT NULL CONSTRAINT condiciones_de_cambio_de_plan_sentido_ck CHECK (sentido IN ('SUBA', 'BAJA')),
  politica_version      integer NOT NULL CONSTRAINT condiciones_de_cambio_de_plan_politica_fkey REFERENCES politica_de_cambio_de_plan (version),
  arrepentimiento_hasta date,  -- NULL: este cambio no admite arrepentimiento
  creado_en             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT condiciones_de_cambio_de_plan_pkey PRIMARY KEY (tenant_id, numero),
  CONSTRAINT condiciones_de_cambio_de_plan_cambio_fkey FOREIGN KEY (tenant_id, numero) REFERENCES plan_de_tenant (tenant_id, numero)
);

CREATE TABLE arrepentimiento_de_plan (
  tenant_id          uuid NOT NULL,
  numero_arrepentido integer NOT NULL,
  numero_nuevo       integer NOT NULL,
  motivo             text NOT NULL CONSTRAINT arrepentimiento_de_plan_motivo_ck CHECK (btrim(motivo) <> ''),
  registrado_por     text NOT NULL CONSTRAINT arrepentimiento_de_plan_registrado_por_ck CHECK (registrado_por <> ''),
  creado_en          timestamptz NOT NULL DEFAULT now(),
  -- Un cambio se arrepiente UNA vez, aunque dos pedidos lleguen juntos.
  CONSTRAINT arrepentimiento_de_plan_pkey PRIMARY KEY (tenant_id, numero_arrepentido),
  CONSTRAINT arrepentimiento_de_plan_nuevo_uk UNIQUE (tenant_id, numero_nuevo),
  CONSTRAINT arrepentimiento_de_plan_orden_ck CHECK (numero_nuevo > numero_arrepentido),
  CONSTRAINT arrepentimiento_de_plan_arrepentido_fkey FOREIGN KEY (tenant_id, numero_arrepentido) REFERENCES plan_de_tenant (tenant_id, numero),
  CONSTRAINT arrepentimiento_de_plan_nuevo_fkey FOREIGN KEY (tenant_id, numero_nuevo) REFERENCES plan_de_tenant (tenant_id, numero)
);

-- Política: la versión es exactamente la siguiente. Dos administradores a la vez con la misma versión chocan en la clave primaria.
CREATE FUNCTION politica_de_cambio_de_plan_validar_alta() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_siguiente integer;
BEGIN
  SELECT coalesce(max(p.version), 0) + 1 INTO v_siguiente FROM public.politica_de_cambio_de_plan p;
  IF NEW.version IS DISTINCT FROM v_siguiente THEN
    RAISE EXCEPTION 'la versión de la política tiene que ser %', v_siguiente
      USING ERRCODE = '23514', CONSTRAINT = 'politica_de_cambio_de_plan_version_invalida';
  END IF;
  RETURN NEW;
END
$$;

-- Condiciones y arrepentimiento solo existen para cambios de origen CAMBIO (el alta y la migración de versión no pasan por la política).
CREATE FUNCTION cambio_de_plan_validar_origen() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_origen text;
  v_numero integer;
BEGIN
  -- Una sola función para dos tablas: el número del cambio se llama distinto en cada una (`to_jsonb` evita nombrar una columna que la otra no tiene).
  v_numero := coalesce((to_jsonb(NEW) ->> 'numero_arrepentido')::integer, (to_jsonb(NEW) ->> 'numero')::integer);
  SELECT p.origen INTO v_origen FROM public.plan_de_tenant p WHERE p.tenant_id = NEW.tenant_id AND p.numero = v_numero;
  -- Un cambio inexistente lo rechaza la clave foránea.
  IF FOUND AND v_origen <> 'CAMBIO' THEN
    RAISE EXCEPTION 'solo un cambio de origen CAMBIO tiene condiciones o se arrepiente'
      USING ERRCODE = '23514', CONSTRAINT = 'cambio_de_plan_origen_invalido';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER politica_de_cambio_de_plan_alta BEFORE INSERT ON politica_de_cambio_de_plan
  FOR EACH ROW EXECUTE FUNCTION politica_de_cambio_de_plan_validar_alta();
CREATE TRIGGER condiciones_de_cambio_de_plan_alta BEFORE INSERT ON condiciones_de_cambio_de_plan
  FOR EACH ROW EXECUTE FUNCTION cambio_de_plan_validar_origen();
CREATE TRIGGER arrepentimiento_de_plan_alta BEFORE INSERT ON arrepentimiento_de_plan
  FOR EACH ROW EXECUTE FUNCTION cambio_de_plan_validar_origen();

CREATE TRIGGER politica_de_cambio_de_plan_solo_insercion BEFORE UPDATE OR DELETE ON politica_de_cambio_de_plan
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER politica_de_cambio_de_plan_sin_truncate BEFORE TRUNCATE ON politica_de_cambio_de_plan
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER condiciones_de_cambio_de_plan_solo_insercion BEFORE UPDATE OR DELETE ON condiciones_de_cambio_de_plan
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER condiciones_de_cambio_de_plan_sin_truncate BEFORE TRUNCATE ON condiciones_de_cambio_de_plan
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER arrepentimiento_de_plan_solo_insercion BEFORE UPDATE OR DELETE ON arrepentimiento_de_plan
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER arrepentimiento_de_plan_sin_truncate BEFORE TRUNCATE ON arrepentimiento_de_plan
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- La política inicial reproduce lo que el dueño decidió (1, 1, 0): `definida_por` del sistema, antes de activar la seguridad por fila.
INSERT INTO politica_de_cambio_de_plan (version, dias_de_anticipacion_de_suba, dias_de_anticipacion_de_baja, dias_de_arrepentimiento, motivo, definida_por)
  VALUES (1, 1, 1, 0, 'Política inicial', 'sistema');

-- Privilegios: solo la plataforma (la app no los ve hasta el aviso H-14c); nadie recibe UPDATE ni DELETE.
REVOKE ALL ON politica_de_cambio_de_plan, condiciones_de_cambio_de_plan, arrepentimiento_de_plan FROM PUBLIC;
GRANT SELECT ON politica_de_cambio_de_plan, condiciones_de_cambio_de_plan, arrepentimiento_de_plan TO pedernal_plataforma;
GRANT INSERT (version, dias_de_anticipacion_de_suba, dias_de_anticipacion_de_baja, dias_de_arrepentimiento, motivo, definida_por)
  ON politica_de_cambio_de_plan TO pedernal_plataforma;
GRANT INSERT (tenant_id, numero, sentido, politica_version, arrepentimiento_hasta) ON condiciones_de_cambio_de_plan TO pedernal_plataforma;
GRANT INSERT (tenant_id, numero_arrepentido, numero_nuevo, motivo, registrado_por) ON arrepentimiento_de_plan TO pedernal_plataforma;

ALTER TABLE politica_de_cambio_de_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE politica_de_cambio_de_plan FORCE ROW LEVEL SECURITY;
ALTER TABLE condiciones_de_cambio_de_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE condiciones_de_cambio_de_plan FORCE ROW LEVEL SECURITY;
ALTER TABLE arrepentimiento_de_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrepentimiento_de_plan FORCE ROW LEVEL SECURITY;

CREATE POLICY politica_de_cambio_de_plan_plataforma_leer ON politica_de_cambio_de_plan FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY politica_de_cambio_de_plan_plataforma_alta ON politica_de_cambio_de_plan FOR INSERT TO pedernal_plataforma
  WITH CHECK (definida_por = (SELECT app_actor_plataforma()));
CREATE POLICY condiciones_de_cambio_de_plan_plataforma_leer ON condiciones_de_cambio_de_plan FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY condiciones_de_cambio_de_plan_plataforma_alta ON condiciones_de_cambio_de_plan FOR INSERT TO pedernal_plataforma
  WITH CHECK (true);
CREATE POLICY arrepentimiento_de_plan_plataforma_leer ON arrepentimiento_de_plan FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY arrepentimiento_de_plan_plataforma_alta ON arrepentimiento_de_plan FOR INSERT TO pedernal_plataforma
  WITH CHECK (registrado_por = (SELECT app_actor_plataforma()));

-- Restrictivas (como las de 0007): sin un actor vigente no ve nada, y solo un ADMIN escribe.
CREATE POLICY politica_de_cambio_de_plan_plataforma_con_actor ON politica_de_cambio_de_plan AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY condiciones_de_cambio_de_plan_plataforma_con_actor ON condiciones_de_cambio_de_plan AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY arrepentimiento_de_plan_plataforma_con_actor ON arrepentimiento_de_plan AS RESTRICTIVE FOR SELECT
  TO pedernal_plataforma USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY politica_de_cambio_de_plan_plataforma_admin_alta ON politica_de_cambio_de_plan AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY condiciones_de_cambio_de_plan_plataforma_admin_alta ON condiciones_de_cambio_de_plan AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY arrepentimiento_de_plan_plataforma_admin_alta ON arrepentimiento_de_plan AS RESTRICTIVE FOR INSERT
  TO pedernal_plataforma WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
