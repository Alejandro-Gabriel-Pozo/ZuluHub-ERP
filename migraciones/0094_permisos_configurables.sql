-- 0094_permisos_configurables: el modelo de datos de los permisos configurables (roles propios de la empresa, plantillas y pisos), tramo T1 de H4b.
-- Diseño aceptado: Pedernal-docs/11-especificaciones/h4b-permisos-configurables.md §3 (modelo), §4 (dónde se evalúa y disparadores), §5 (invariantes), §6.1 (migración sin
-- romper nada) y §8 (tramos). Decisión del dueño del 14/11/2026 (decisiones-del-dueno-2026-11.md, fila del 2026-11-14): el gerente crea roles propios dentro del marco de
-- plan y pisos, los pisos los fija solo la plataforma, los tres roles base quedan como plantillas; Q1 a Q4 = la opción recomendada, Q5 = B (la cantidad de roles propios es una
-- perilla del plan comercial, base 0).
--
-- NO SE LEE TODAVÍA: el guard, el adaptador y las 173 acciones siguen usando la constante `PERMISOS_DE_EMPRESA` (tramo T3). Esta migración solo agrega tablas, su semilla (la
-- tabla de hoy, generada desde la constante por `npm run semilla:plantillas`) y la defensa en profundidad de la base. El comportamiento de hoy queda idéntico.
--
-- Qué guarda (la fuente de verdad del CATÁLOGO de acciones sigue en el código; acá solo quién tiene cada acción):
--   plantilla_de_rol      las 3 plantillas base (GERENTE no tiene lista: su conjunto es «todo lo que el plan habilita»; el gerente nunca es editable, S2)
--   version_de_plantilla  versiones inmutables de las listas de ADMINISTRADOR y OPERADOR (vale la de mayor `numero`)
--   piso_de_plataforma    por acción: SOLO_GERENTE o TODOS_LOS_ROLES (sin piso = libre dentro del plan); los fija solo la plataforma
--   accion_introducida    las acciones que ya pasaron por el sistema de plantillas (para la sincronización aditiva de acciones nuevas, §6.3)
--   rol_de_empresa        un rol PROPIO de una empresa (no se borra: se archiva)
--   version_de_rol        versiones inmutables de la lista de acciones de un rol propio (vale la de mayor `numero`)
--
-- Reglas que la base hace cumplir aunque el código se olvide (la regla de negocio vive en el servidor y en el dominio del tramo T2; esto es la segunda línea):
--  * Una clave de acción guardada tiene la FORMA `recurso.accion` (lista de permitidos); que exista en el catálogo lo valida el servidor, y una que ya no existe no otorga nada.
--  * Una lista de acciones (de una plantilla o de un rol propio) respeta los pisos: ninguna acción SOLO_GERENTE y todas las TODOS_LOS_ROLES (I5). Si no se pueden leer los
--    pisos (la tabla está vacía para quien escribe), se RECHAZA: ante la duda, cierra.
--  * Las versiones son inmutables (ni UPDATE ni DELETE ni TRUNCATE, ni para el dueño) y su número es el siguiente al mayor: dos ediciones del mismo rol a la vez no se pisan, la
--    segunda recibe el conflicto (23505) y relee (I9).
--  * Un rol propio no cambia de empresa ni de plantilla de origen y no se borra.
--  * Aislamiento: rol_de_empresa y version_de_rol llevan `empresa_id`, RLS activa y forzada con la política de siempre (`empresa_id = app_empresa_id()`) y clave foránea
--    compuesta. Ninguna política mira `membresia`: no hay ciclos (H4 §B.4).
--
-- Reglas de esta migración (las mismas de 0025 y 0045): sin funciones SECURITY DEFINER (todas fijan `search_path` y califican con `public.`); nadie recibe DELETE ni TRUNCATE;
-- INSERT y UPDATE por columna; las tablas de solo inserción no reciben UPDATE; toda única de una tabla de empresa incluye `empresa_id`. Solo reciben algo `pedernal_app` y
-- `pedernal_plataforma`. Los privilegios se dan por lo que el diseño declara para T4 y T5: ninguna pantalla ni caso de uso los usa todavía.
--
-- Fuera de esta migración, a propósito (DEC-0631): `membresia.rol_propio_id`, el valor `PROPIO` de los CHECK de rol y el disparador de cambio de rol entre roles no gerente
-- (§3.2 y §4 (2)) van en T4, junto con el tipo `RolDeEmpresa`, los CHECK de rol que una prueba compara con `ROLES_DE_EMPRESA` y la política que hoy solo deja cambiar el rol
-- por traspaso: hacerlo ahora cambiaría el comportamiento de hoy (§6.1) y rompería esa prueba.
--
-- Reversión: `migraciones/reversiones/0094_revertir_permisos_configurables.sql` (FRENA si ya hay roles propios o si la plataforma cambió plantillas o pisos). El ejecutor no la aplica.
-- DEPENDE de 0001 (auditoría, solo_insercion, fijar_version_y_fecha, contexto), 0004 (actor de plataforma), 0007 (sin_borrado) y 0025 (texto_de_catalogo_valido).

DO $$
BEGIN
  IF to_regprocedure('public.solo_insercion()') IS NULL OR to_regprocedure('public.sin_borrado()') IS NULL
     OR to_regprocedure('public.fijar_version_y_fecha()') IS NULL OR to_regprocedure('public.empresa_operable(uuid)') IS NULL
     OR to_regprocedure('public.app_empresa_id()') IS NULL OR to_regprocedure('public.contexto_firmado()') IS NULL
     OR to_regprocedure('public.app_actor_plataforma()') IS NULL OR to_regprocedure('public.admin_plataforma_con_rol(text[])') IS NULL
     OR to_regprocedure('public.plataforma_actor_vigente()') IS NULL OR to_regprocedure('public.texto_de_catalogo_valido(text, integer)') IS NULL THEN
    RAISE EXCEPTION 'los permisos configurables requieren 0001, 0004, 0007 y 0025 aplicadas antes (faltan sus funciones base)' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('public.plantilla_de_rol') IS NOT NULL OR to_regclass('public.version_de_plantilla') IS NOT NULL
     OR to_regclass('public.piso_de_plataforma') IS NOT NULL OR to_regclass('public.accion_introducida') IS NOT NULL
     OR to_regclass('public.rol_de_empresa') IS NOT NULL OR to_regclass('public.version_de_rol') IS NOT NULL THEN
    RAISE EXCEPTION 'los permisos configurables nacen en 0094: alguna de sus tablas ya existe (alguien la creó a mano); hay que revisarla antes de migrar'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Validadores de forma (lista de permitidos). Una sola definición: las usan los CHECK de las seis tablas y los disparadores.
-- ---------------------------------------------------------------------------------------------
-- `recurso.accion`: minúsculas, dígitos y guion bajo, cada parte de 1 a 40 caracteres (la más larga del catálogo de hoy tiene 37 en total).
CREATE FUNCTION clave_de_accion_valida(p_accion text) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT coalesce(p_accion ~ '^[a-z][a-z0-9_]{0,39}\.[a-z][a-z0-9_]{0,39}$', false) $$;

-- Un conjunto de acciones: vacío o de claves válidas, sin repetidas ni nulas, una sola dimensión y a lo sumo 1000 (DEC-0630: tope de forma, no de negocio; hoy hay 173).
CREATE FUNCTION claves_de_accion_validas(p_acciones text[]) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN p_acciones IS NULL THEN false
    WHEN cardinality(p_acciones) = 0 THEN true
    ELSE array_ndims(p_acciones) = 1
         AND cardinality(p_acciones) <= 1000
         AND NOT EXISTS (SELECT 1 FROM unnest(p_acciones) AS x WHERE NOT public.clave_de_accion_valida(x))
         AND cardinality(p_acciones) = (SELECT count(DISTINCT x) FROM unnest(p_acciones) AS x)
  END
$$;
REVOKE ALL ON FUNCTION clave_de_accion_valida(text), claves_de_accion_validas(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clave_de_accion_valida(text), claves_de_accion_validas(text[]) TO pedernal_app, pedernal_plataforma;

-- ---------------------------------------------------------------------------------------------
-- Tablas de plataforma (globales, sin empresa_id)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE plantilla_de_rol (
  clave     text PRIMARY KEY CONSTRAINT plantilla_de_rol_clave_ck CHECK (clave IN ('GERENTE', 'ADMINISTRADOR', 'OPERADOR')),
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE version_de_plantilla (
  clave     text NOT NULL REFERENCES plantilla_de_rol (clave)
              CONSTRAINT version_de_plantilla_sin_gerente_ck CHECK (clave IN ('ADMINISTRADOR', 'OPERADOR')),  -- el gerente no tiene lista (S2)
  numero    integer NOT NULL CONSTRAINT version_de_plantilla_numero_ck CHECK (numero > 0),
  acciones  text[] NOT NULL CONSTRAINT version_de_plantilla_acciones_ck CHECK (claves_de_accion_validas(acciones)),
  autor     text NOT NULL CONSTRAINT version_de_plantilla_autor_ck CHECK (autor <> '' AND char_length(autor) <= 100),
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clave, numero)
);

CREATE TABLE piso_de_plataforma (
  accion         text PRIMARY KEY CONSTRAINT piso_de_plataforma_accion_ck CHECK (clave_de_accion_valida(accion)),
  tipo           text NOT NULL CONSTRAINT piso_de_plataforma_tipo_ck CHECK (tipo IN ('SOLO_GERENTE', 'TODOS_LOS_ROLES')),
  autor          text NOT NULL CONSTRAINT piso_de_plataforma_autor_ck CHECK (autor <> '' AND char_length(autor) <= 100),
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1
);

CREATE TABLE accion_introducida (
  accion    text PRIMARY KEY CONSTRAINT accion_introducida_accion_ck CHECK (clave_de_accion_valida(accion)),
  creado_en timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- Tablas de empresa
-- ---------------------------------------------------------------------------------------------
CREATE TABLE rol_de_empresa (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- lo manda la app: es la idempotencia del alta
  empresa_id       uuid NOT NULL REFERENCES empresa (id),
  nombre           text NOT NULL CONSTRAINT rol_de_empresa_nombre_ck CHECK (texto_de_catalogo_valido(nombre, 80)),   -- DEC-0632
  nombre_clave     text NOT NULL CONSTRAINT rol_de_empresa_nombre_clave_ck CHECK (char_length(nombre_clave) BETWEEN 1 AND 240),
  plantilla_origen text REFERENCES plantilla_de_rol (clave),     -- de cuál se copió (o nulo: nació vacío); desde ahí es independiente (S9)
  activo           boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,                   -- control optimista (el mismo disparador de siempre)
  CONSTRAINT rol_de_empresa_id_empresa_uk UNIQUE (id, empresa_id),
  CONSTRAINT rol_de_empresa_nombre_uk UNIQUE (empresa_id, nombre_clave)
);

CREATE TABLE version_de_rol (
  empresa_id  uuid NOT NULL REFERENCES empresa (id),
  rol_id      uuid NOT NULL,
  numero      integer NOT NULL CONSTRAINT version_de_rol_numero_ck CHECK (numero > 0),
  acciones    text[] NOT NULL CONSTRAINT version_de_rol_acciones_ck CHECK (claves_de_accion_validas(acciones)),
  creado_por  uuid NOT NULL REFERENCES persona (id),
  creado_en   timestamptz NOT NULL,                              -- `ahora` del contexto
  PRIMARY KEY (empresa_id, rol_id, numero),
  CONSTRAINT version_de_rol_rol_fkey FOREIGN KEY (rol_id, empresa_id) REFERENCES rol_de_empresa (id, empresa_id)
);

-- ---------------------------------------------------------------------------------------------
-- Disparadores
-- ---------------------------------------------------------------------------------------------
-- Los pisos que una lista de acciones incumple (texto vacío si cumple). Una sola definición para plantillas y roles propios. Si no hay ningún piso visible
-- para quien escribe, la lista NO se acepta: no poder mirar los pisos no puede abrir la puerta (todo nace cerrado).
CREATE FUNCTION incumplimiento_de_pisos(p_acciones text[]) RETURNS text LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_acciones text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.piso_de_plataforma) THEN
    RETURN 'no se pueden leer los pisos de la plataforma';
  END IF;
  SELECT string_agg(p.accion, ', ' ORDER BY p.accion) INTO v_acciones
    FROM public.piso_de_plataforma p WHERE p.tipo = 'SOLO_GERENTE' AND p.accion = ANY (p_acciones);
  IF v_acciones IS NOT NULL THEN
    RETURN 'acciones que solo tiene el gerente: ' || v_acciones;
  END IF;
  SELECT string_agg(p.accion, ', ' ORDER BY p.accion) INTO v_acciones
    FROM public.piso_de_plataforma p WHERE p.tipo = 'TODOS_LOS_ROLES' AND NOT (p.accion = ANY (p_acciones));
  IF v_acciones IS NOT NULL THEN
    RETURN 'acciones que tienen que tener todos los roles: ' || v_acciones;
  END IF;
  RETURN '';
END
$$;
REVOKE ALL ON FUNCTION incumplimiento_de_pisos(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION incumplimiento_de_pisos(text[]) TO pedernal_app, pedernal_plataforma;

-- Una versión de plantilla: su número es el siguiente al mayor de su plantilla y la lista respeta los pisos.
CREATE FUNCTION version_de_plantilla_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_siguiente integer;
  v_incumple text;
BEGIN
  SELECT coalesce(max(v.numero), 0) + 1 INTO v_siguiente FROM public.version_de_plantilla v WHERE v.clave = NEW.clave;
  IF NEW.numero IS DISTINCT FROM v_siguiente THEN
    RAISE EXCEPTION 'la versión de la plantilla % tiene que ser la %', NEW.clave, v_siguiente
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_plantilla_numero_invalido';
  END IF;
  v_incumple := public.incumplimiento_de_pisos(NEW.acciones);
  IF v_incumple <> '' THEN
    RAISE EXCEPTION 'la plantilla % no respeta los pisos: %', NEW.clave, v_incumple
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_plantilla_pisos';
  END IF;
  RETURN NEW;
END
$$;

-- Una versión de rol propio: su número es el siguiente al mayor del rol (dos ediciones a la vez: la segunda choca con la clave primaria y relee) y respeta los pisos.
CREATE FUNCTION version_de_rol_validar() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
DECLARE
  v_siguiente integer;
  v_incumple text;
BEGIN
  SELECT coalesce(max(v.numero), 0) + 1 INTO v_siguiente
    FROM public.version_de_rol v WHERE v.empresa_id = NEW.empresa_id AND v.rol_id = NEW.rol_id;
  IF NEW.numero IS DISTINCT FROM v_siguiente THEN
    RAISE EXCEPTION 'la versión del rol tiene que ser la %', v_siguiente
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_rol_numero_invalido';
  END IF;
  v_incumple := public.incumplimiento_de_pisos(NEW.acciones);
  IF v_incumple <> '' THEN
    RAISE EXCEPTION 'el rol no respeta los pisos de la plataforma: %', v_incumple
      USING ERRCODE = '23514', CONSTRAINT = 'version_de_rol_pisos';
  END IF;
  RETURN NEW;
END
$$;

-- Un rol propio no cambia de empresa ni de plantilla de origen (y la base no deja que lo haga el dueño tampoco).
CREATE FUNCTION rol_de_empresa_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.plantilla_origen IS DISTINCT FROM OLD.plantilla_origen THEN
    RAISE EXCEPTION 'un rol propio no cambia de empresa ni de plantilla de origen'
      USING ERRCODE = '23514', CONSTRAINT = 'rol_de_empresa_inmutable';
  END IF;
  RETURN NEW;
END
$$;

-- Un piso cambia de tipo, no de acción.
CREATE FUNCTION piso_de_plataforma_validar_cambio() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW.accion IS DISTINCT FROM OLD.accion THEN
    RAISE EXCEPTION 'un piso no cambia de acción'
      USING ERRCODE = '23514', CONSTRAINT = 'piso_de_plataforma_inmutable';
  END IF;
  RETURN NEW;
END
$$;

-- Plantillas y accion_introducida: nunca se editan ni se borran. (Las plantillas base son tres filas fijas; lo que cambia es la versión.)
CREATE TRIGGER plantilla_de_rol_solo_insercion BEFORE UPDATE OR DELETE ON plantilla_de_rol
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER plantilla_de_rol_sin_truncate BEFORE TRUNCATE ON plantilla_de_rol
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER version_de_plantilla_alta BEFORE INSERT ON version_de_plantilla
  FOR EACH ROW EXECUTE FUNCTION version_de_plantilla_validar();
CREATE TRIGGER version_de_plantilla_solo_insercion BEFORE UPDATE OR DELETE ON version_de_plantilla
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER version_de_plantilla_sin_truncate BEFORE TRUNCATE ON version_de_plantilla
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER accion_introducida_solo_insercion BEFORE UPDATE OR DELETE ON accion_introducida
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER accion_introducida_sin_truncate BEFORE TRUNCATE ON accion_introducida
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER version_de_rol_alta BEFORE INSERT ON version_de_rol
  FOR EACH ROW EXECUTE FUNCTION version_de_rol_validar();
CREATE TRIGGER version_de_rol_solo_insercion BEFORE UPDATE OR DELETE ON version_de_rol
  FOR EACH ROW EXECUTE FUNCTION solo_insercion();
CREATE TRIGGER version_de_rol_sin_truncate BEFORE TRUNCATE ON version_de_rol
  FOR EACH STATEMENT EXECUTE FUNCTION solo_insercion();

-- Pisos y roles propios: se cambian (con auditoría en la misma transacción), no se borran ni se vacían. El nombre ordena el disparador de cambio antes del de versión.
CREATE TRIGGER piso_de_plataforma_cambio BEFORE UPDATE ON piso_de_plataforma
  FOR EACH ROW EXECUTE FUNCTION piso_de_plataforma_validar_cambio();
CREATE TRIGGER piso_de_plataforma_version BEFORE UPDATE ON piso_de_plataforma
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER piso_de_plataforma_sin_borrado BEFORE DELETE ON piso_de_plataforma
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER piso_de_plataforma_sin_truncate BEFORE TRUNCATE ON piso_de_plataforma
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER rol_de_empresa_cambio BEFORE UPDATE ON rol_de_empresa
  FOR EACH ROW EXECUTE FUNCTION rol_de_empresa_validar_cambio();
CREATE TRIGGER rol_de_empresa_version BEFORE UPDATE ON rol_de_empresa
  FOR EACH ROW EXECUTE FUNCTION fijar_version_y_fecha();
CREATE TRIGGER rol_de_empresa_sin_borrado BEFORE DELETE ON rol_de_empresa
  FOR EACH ROW EXECUTE FUNCTION sin_borrado();
CREATE TRIGGER rol_de_empresa_sin_truncate BEFORE TRUNCATE ON rol_de_empresa
  FOR EACH STATEMENT EXECUTE FUNCTION sin_borrado();

-- ---------------------------------------------------------------------------------------------
-- Semilla: la tabla de hoy, generada desde `PERMISOS_DE_EMPRESA` (no se edita a mano: `npm run semilla:plantillas -- --verificar` y la prueba de paridad la comparan).
-- Corre con el rol dueño de la base (que evade RLS) y pasa por los mismos disparadores que cualquier escritura.
-- ---------------------------------------------------------------------------------------------
-- >>> SEMILLA GENERADA (npm run semilla:plantillas) >>>
INSERT INTO plantilla_de_rol (clave) VALUES ('GERENTE'), ('ADMINISTRADOR'), ('OPERADOR');

INSERT INTO piso_de_plataforma (accion, tipo, autor) VALUES
  ('cajas.crear', 'SOLO_GERENTE', 'migracion:0094'),
  ('cajas.desactivar', 'SOLO_GERENTE', 'migracion:0094'),
  ('cajas.reactivar', 'SOLO_GERENTE', 'migracion:0094'),
  ('certificados.gestionar', 'SOLO_GERENTE', 'migracion:0094'),
  ('compras.configurar', 'SOLO_GERENTE', 'migracion:0094'),
  ('datos_fiscales.confirmar', 'SOLO_GERENTE', 'migracion:0094'),
  ('datos_fiscales.editar', 'SOLO_GERENTE', 'migracion:0094'),
  ('emisores.confirmar_regla', 'SOLO_GERENTE', 'migracion:0094'),
  ('gerencia.cancelar_traspaso', 'SOLO_GERENTE', 'migracion:0094'),
  ('gerencia.proponer_traspaso', 'SOLO_GERENTE', 'migracion:0094'),
  ('partes.anonimizar', 'SOLO_GERENTE', 'migracion:0094'),
  ('puntos_de_venta.activar', 'SOLO_GERENTE', 'migracion:0094'),
  ('puntos_de_venta.cambiar_ambiente', 'SOLO_GERENTE', 'migracion:0094'),
  ('puntos_de_venta.crear', 'SOLO_GERENTE', 'migracion:0094'),
  ('puntos_de_venta.desactivar', 'SOLO_GERENTE', 'migracion:0094'),
  ('puntos_de_venta.editar', 'SOLO_GERENTE', 'migracion:0094'),
  ('roles.archivar', 'SOLO_GERENTE', 'migracion:0094'),
  ('roles.crear', 'SOLO_GERENTE', 'migracion:0094'),
  ('roles.editar', 'SOLO_GERENTE', 'migracion:0094'),
  ('roles.ver', 'SOLO_GERENTE', 'migracion:0094'),
  ('series.resincronizar', 'SOLO_GERENTE', 'migracion:0094'),
  ('stock.verificar_saldos', 'SOLO_GERENTE', 'migracion:0094'),
  ('sucursales.desactivar', 'SOLO_GERENTE', 'migracion:0094'),
  ('sucursales.reactivar', 'SOLO_GERENTE', 'migracion:0094'),
  ('usuarios.asignar_rol', 'SOLO_GERENTE', 'migracion:0094'),
  ('gerencia.aceptar_traspaso', 'TODOS_LOS_ROLES', 'migracion:0094'),
  ('gerencia.rechazar_traspaso', 'TODOS_LOS_ROLES', 'migracion:0094'),
  ('gerencia.ver_traspaso', 'TODOS_LOS_ROLES', 'migracion:0094'),
  ('permisos.ver_propios', 'TODOS_LOS_ROLES', 'migracion:0094');

INSERT INTO version_de_plantilla (clave, numero, acciones, autor) VALUES
  ('ADMINISTRADOR', 1, ARRAY[
    'articulos.controlar',
    'articulos.dejar_de_controlar',
    'cajas.editar',
    'cajas.ver',
    'cobros.corregir_medio',
    'comandas.enviar',
    'comandas.ver',
    'composiciones.editar',
    'compras.corregir',
    'compras.exportar',
    'comprobantes.descartar',
    'comprobantes.emitir',
    'comprobantes.emitir_manual',
    'comprobantes.reintentar',
    'comprobantes.ver',
    'comprobantes_de_proveedor.anular',
    'comprobantes_de_proveedor.anular_pago',
    'comprobantes_de_proveedor.pagar',
    'comprobantes_de_proveedor.reemplazar',
    'comprobantes_de_proveedor.registrar',
    'comprobantes_de_proveedor.ver',
    'conciliaciones.anular',
    'conciliaciones.conciliar',
    'conciliaciones.ver',
    'conteos.abrir',
    'conteos.aplicar',
    'conteos.cancelar',
    'conteos.registrar',
    'costos.ver',
    'cuenta_corriente.administrar',
    'cuenta_corriente.aprobar_exceso',
    'cuenta_corriente.cargar_a_cuenta',
    'cuenta_corriente.consultar_al_vender',
    'cuenta_corriente.ver',
    'cuentas.abrir',
    'cuentas.agregar_linea',
    'cuentas.anular',
    'cuentas.anular_linea',
    'cuentas.cerrar',
    'cuentas_de_cobro.crear',
    'cuentas_de_cobro.desactivar',
    'cuentas_de_cobro.editar',
    'cuentas_de_cobro.reactivar',
    'declaraciones_de_total.registrar',
    'depositos.crear',
    'depositos.desactivar',
    'depositos.editar',
    'depositos.reactivar',
    'devoluciones.registrar',
    'devoluciones_a_proveedor.anular',
    'devoluciones_a_proveedor.registrar',
    'devoluciones_a_proveedor.ver',
    'diferencias_de_compra.resolver',
    'diferencias_de_compra.ver',
    'gerencia.aceptar_traspaso',
    'gerencia.rechazar_traspaso',
    'gerencia.ver_traspaso',
    'impresiones.imprimir',
    'impresiones.reimprimir',
    'impresoras.crear',
    'impresoras.desactivar',
    'impresoras.editar',
    'impresoras.ver',
    'jornadas.cancelar_auditoria',
    'jornadas.cerrar',
    'jornadas.iniciar_auditoria',
    'jornadas.ver',
    'lotes.cambiar_calidad',
    'lotes.controlar',
    'lotes.corregir',
    'lotes.dejar_de_controlar',
    'lotes.reasignar',
    'lotes.ver',
    'medios_de_pago.crear',
    'medios_de_pago.desactivar',
    'medios_de_pago.editar',
    'medios_de_pago.reactivar',
    'mesas.crear',
    'mesas.desactivar',
    'mesas.editar',
    'mesas.reactivar',
    'mesas.ver',
    'modulos.ver',
    'movimientos_caja.ajustar',
    'movimientos_caja.anular',
    'movimientos_caja.anular_de_otros',
    'movimientos_caja.registrar_manual',
    'notas_de_credito.emitir',
    'notas_de_credito_de_proveedor.anular',
    'notas_de_credito_de_proveedor.registrar',
    'notas_de_credito_de_proveedor.ver',
    'notas_de_debito_de_proveedor.anular',
    'notas_de_debito_de_proveedor.registrar',
    'notas_de_debito_de_proveedor.ver',
    'opciones.editar',
    'ordenes_de_compra.anular',
    'ordenes_de_compra.cerrar',
    'ordenes_de_compra.crear',
    'ordenes_de_compra.pedir',
    'ordenes_de_compra.ver',
    'partes.cambiar_roles',
    'partes.crear',
    'partes.desactivar',
    'partes.desvincular_contacto',
    'partes.editar',
    'partes.reactivar',
    'partes.ver',
    'partes.vincular_contacto',
    'permisos.ver_propios',
    'productos.cambiar_precio',
    'productos.crear',
    'productos.desactivar',
    'productos.editar',
    'productos.reactivar',
    'productos.ver',
    'proveedores.editar_ficha',
    'proveedores.pedir_ficha',
    'recepciones.anular',
    'recepciones.confirmar',
    'recepciones.registrar',
    'recepciones.ver',
    'salidas_de_dinero.registrar',
    'salon.cambiar_mesa',
    'salon.dividir',
    'salon.unir',
    'sesiones_caja.abrir',
    'sesiones_caja.cancelar_cierre',
    'sesiones_caja.cerrar',
    'sesiones_caja.iniciar_cierre',
    'stock.ajustar',
    'stock.anular',
    'stock.registrar_entrada',
    'stock.registrar_salida',
    'stock.transferir',
    'stock.ver',
    'sucursales.crear',
    'sucursales.editar',
    'sucursales.ver',
    'tickets.cobrar',
    'tickets.corregir',
    'transformaciones.abrir',
    'transformaciones.anular',
    'transformaciones.cancelar',
    'transformaciones.cerrar',
    'transformaciones.ver',
    'usuarios.apagar',
    'usuarios.asignar_sucursales',
    'usuarios.invitar',
    'usuarios.reenviar_invitacion',
    'usuarios.revocar_invitacion',
    'usuarios.ver',
    'variantes.editar',
    'ventas.ver',
    'vidrieras.administrar_cuentas_de_imagen',
    'vidrieras.administrar_portal',
    'vidrieras.crear',
    'vidrieras.editar',
    'vidrieras.marcar_disponibilidad',
    'vidrieras.ocultar_en_empresa',
    'vidrieras.publicar',
    'vidrieras.publicar_en_linea',
    'vidrieras.renovar_enlace',
    'vidrieras.retirar',
    'vidrieras.retirar_de_linea',
    'vidrieras.ver'
  ]::text[], 'migracion:0094'),
  ('OPERADOR', 1, ARRAY[
    'cajas.ver',
    'cobros.corregir_medio',
    'comandas.enviar',
    'comandas.ver',
    'comprobantes.descartar',
    'comprobantes.emitir',
    'comprobantes.emitir_manual',
    'comprobantes.reintentar',
    'comprobantes.ver',
    'comprobantes_de_proveedor.registrar',
    'comprobantes_de_proveedor.ver',
    'conteos.registrar',
    'cuenta_corriente.cargar_a_cuenta',
    'cuenta_corriente.consultar_al_vender',
    'cuentas.abrir',
    'cuentas.agregar_linea',
    'cuentas.anular',
    'cuentas.anular_linea',
    'cuentas.cerrar',
    'declaraciones_de_total.registrar',
    'devoluciones_a_proveedor.ver',
    'gerencia.aceptar_traspaso',
    'gerencia.rechazar_traspaso',
    'gerencia.ver_traspaso',
    'impresiones.imprimir',
    'impresiones.reimprimir',
    'impresoras.ver',
    'jornadas.cancelar_auditoria',
    'jornadas.cerrar',
    'jornadas.iniciar_auditoria',
    'jornadas.ver',
    'lotes.ver',
    'mesas.ver',
    'movimientos_caja.anular',
    'movimientos_caja.registrar_manual',
    'notas_de_credito.emitir',
    'notas_de_credito_de_proveedor.ver',
    'notas_de_debito_de_proveedor.ver',
    'ordenes_de_compra.ver',
    'partes.cambiar_roles',
    'partes.crear',
    'partes.desvincular_contacto',
    'partes.editar',
    'partes.ver',
    'partes.vincular_contacto',
    'permisos.ver_propios',
    'productos.ver',
    'proveedores.pedir_ficha',
    'recepciones.registrar',
    'recepciones.ver',
    'salon.cambiar_mesa',
    'salon.dividir',
    'salon.unir',
    'sesiones_caja.abrir',
    'sesiones_caja.cancelar_cierre',
    'sesiones_caja.cerrar',
    'sesiones_caja.iniciar_cierre',
    'stock.registrar_entrada',
    'stock.registrar_salida',
    'stock.transferir',
    'stock.ver',
    'tickets.cobrar',
    'tickets.corregir',
    'transformaciones.abrir',
    'transformaciones.ver',
    'ventas.ver',
    'vidrieras.marcar_disponibilidad',
    'vidrieras.ver'
  ]::text[], 'migracion:0094');

INSERT INTO accion_introducida (accion) SELECT unnest(ARRAY[
    'articulos.controlar',
    'articulos.dejar_de_controlar',
    'cajas.crear',
    'cajas.desactivar',
    'cajas.editar',
    'cajas.reactivar',
    'cajas.ver',
    'certificados.gestionar',
    'cobros.corregir_medio',
    'comandas.enviar',
    'comandas.ver',
    'composiciones.editar',
    'compras.configurar',
    'compras.corregir',
    'compras.exportar',
    'comprobantes.descartar',
    'comprobantes.emitir',
    'comprobantes.emitir_manual',
    'comprobantes.reintentar',
    'comprobantes.ver',
    'comprobantes_de_proveedor.anular',
    'comprobantes_de_proveedor.anular_pago',
    'comprobantes_de_proveedor.pagar',
    'comprobantes_de_proveedor.reemplazar',
    'comprobantes_de_proveedor.registrar',
    'comprobantes_de_proveedor.ver',
    'conciliaciones.anular',
    'conciliaciones.conciliar',
    'conciliaciones.ver',
    'conteos.abrir',
    'conteos.aplicar',
    'conteos.cancelar',
    'conteos.registrar',
    'costos.ver',
    'cuenta_corriente.administrar',
    'cuenta_corriente.aprobar_exceso',
    'cuenta_corriente.cargar_a_cuenta',
    'cuenta_corriente.consultar_al_vender',
    'cuenta_corriente.ver',
    'cuentas.abrir',
    'cuentas.agregar_linea',
    'cuentas.anular',
    'cuentas.anular_linea',
    'cuentas.cerrar',
    'cuentas_de_cobro.crear',
    'cuentas_de_cobro.desactivar',
    'cuentas_de_cobro.editar',
    'cuentas_de_cobro.reactivar',
    'datos_fiscales.confirmar',
    'datos_fiscales.editar',
    'declaraciones_de_total.registrar',
    'depositos.crear',
    'depositos.desactivar',
    'depositos.editar',
    'depositos.reactivar',
    'devoluciones.registrar',
    'devoluciones_a_proveedor.anular',
    'devoluciones_a_proveedor.registrar',
    'devoluciones_a_proveedor.ver',
    'diferencias_de_compra.resolver',
    'diferencias_de_compra.ver',
    'emisores.confirmar_regla',
    'gerencia.aceptar_traspaso',
    'gerencia.cancelar_traspaso',
    'gerencia.proponer_traspaso',
    'gerencia.rechazar_traspaso',
    'gerencia.ver_traspaso',
    'impresiones.imprimir',
    'impresiones.reimprimir',
    'impresoras.crear',
    'impresoras.desactivar',
    'impresoras.editar',
    'impresoras.ver',
    'jornadas.cancelar_auditoria',
    'jornadas.cerrar',
    'jornadas.iniciar_auditoria',
    'jornadas.ver',
    'lotes.cambiar_calidad',
    'lotes.controlar',
    'lotes.corregir',
    'lotes.dejar_de_controlar',
    'lotes.reasignar',
    'lotes.ver',
    'medios_de_pago.crear',
    'medios_de_pago.desactivar',
    'medios_de_pago.editar',
    'medios_de_pago.reactivar',
    'mesas.crear',
    'mesas.desactivar',
    'mesas.editar',
    'mesas.reactivar',
    'mesas.ver',
    'modulos.ver',
    'movimientos_caja.ajustar',
    'movimientos_caja.anular',
    'movimientos_caja.anular_de_otros',
    'movimientos_caja.registrar_manual',
    'notas_de_credito.emitir',
    'notas_de_credito_de_proveedor.anular',
    'notas_de_credito_de_proveedor.registrar',
    'notas_de_credito_de_proveedor.ver',
    'notas_de_debito_de_proveedor.anular',
    'notas_de_debito_de_proveedor.registrar',
    'notas_de_debito_de_proveedor.ver',
    'opciones.editar',
    'ordenes_de_compra.anular',
    'ordenes_de_compra.cerrar',
    'ordenes_de_compra.crear',
    'ordenes_de_compra.pedir',
    'ordenes_de_compra.ver',
    'partes.anonimizar',
    'partes.cambiar_roles',
    'partes.crear',
    'partes.desactivar',
    'partes.desvincular_contacto',
    'partes.editar',
    'partes.reactivar',
    'partes.ver',
    'partes.vincular_contacto',
    'permisos.ver_propios',
    'productos.cambiar_precio',
    'productos.crear',
    'productos.desactivar',
    'productos.editar',
    'productos.reactivar',
    'productos.ver',
    'proveedores.editar_ficha',
    'proveedores.pedir_ficha',
    'puntos_de_venta.activar',
    'puntos_de_venta.cambiar_ambiente',
    'puntos_de_venta.crear',
    'puntos_de_venta.desactivar',
    'puntos_de_venta.editar',
    'recepciones.anular',
    'recepciones.confirmar',
    'recepciones.registrar',
    'recepciones.ver',
    'roles.archivar',
    'roles.crear',
    'roles.editar',
    'roles.ver',
    'salidas_de_dinero.registrar',
    'salon.cambiar_mesa',
    'salon.dividir',
    'salon.unir',
    'series.resincronizar',
    'sesiones_caja.abrir',
    'sesiones_caja.cancelar_cierre',
    'sesiones_caja.cerrar',
    'sesiones_caja.iniciar_cierre',
    'stock.ajustar',
    'stock.anular',
    'stock.registrar_entrada',
    'stock.registrar_salida',
    'stock.transferir',
    'stock.ver',
    'stock.verificar_saldos',
    'sucursales.crear',
    'sucursales.desactivar',
    'sucursales.editar',
    'sucursales.reactivar',
    'sucursales.ver',
    'tickets.cobrar',
    'tickets.corregir',
    'transformaciones.abrir',
    'transformaciones.anular',
    'transformaciones.cancelar',
    'transformaciones.cerrar',
    'transformaciones.ver',
    'usuarios.apagar',
    'usuarios.asignar_rol',
    'usuarios.asignar_sucursales',
    'usuarios.invitar',
    'usuarios.reenviar_invitacion',
    'usuarios.revocar_invitacion',
    'usuarios.ver',
    'variantes.editar',
    'ventas.ver',
    'vidrieras.administrar_cuentas_de_imagen',
    'vidrieras.administrar_portal',
    'vidrieras.crear',
    'vidrieras.editar',
    'vidrieras.marcar_disponibilidad',
    'vidrieras.ocultar_en_empresa',
    'vidrieras.publicar',
    'vidrieras.publicar_en_linea',
    'vidrieras.renovar_enlace',
    'vidrieras.retirar',
    'vidrieras.retirar_de_linea',
    'vidrieras.ver'
  ]::text[]);
-- <<< SEMILLA GENERADA <<<

-- ---------------------------------------------------------------------------------------------
-- Privilegios por columna (nadie recibe DELETE ni TRUNCATE; lo auditado es de solo inserción) y RLS activa y forzada, una política por comando.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON plantilla_de_rol, version_de_plantilla, piso_de_plataforma, accion_introducida, rol_de_empresa, version_de_rol FROM PUBLIC;

-- app: lee lo que necesita para resolver el conjunto efectivo (T3) y escribe sus roles propios (T4).
GRANT SELECT ON plantilla_de_rol, version_de_plantilla, piso_de_plataforma, rol_de_empresa, version_de_rol TO pedernal_app;
GRANT INSERT (id, empresa_id, nombre, nombre_clave, plantilla_origen) ON rol_de_empresa TO pedernal_app;
GRANT UPDATE (nombre, nombre_clave, activo) ON rol_de_empresa TO pedernal_app;
GRANT INSERT (empresa_id, rol_id, numero, acciones, creado_por, creado_en) ON version_de_rol TO pedernal_app;

-- plataforma: lee lo suyo; fija pisos y publica versiones de plantilla (T5). Las acciones introducidas las carga el ejecutor de migraciones (T8), no ella.
GRANT SELECT ON plantilla_de_rol, version_de_plantilla, piso_de_plataforma, accion_introducida TO pedernal_plataforma;
GRANT INSERT (clave, numero, acciones, autor) ON version_de_plantilla TO pedernal_plataforma;
GRANT INSERT (accion, tipo, autor) ON piso_de_plataforma TO pedernal_plataforma;
GRANT UPDATE (tipo, autor) ON piso_de_plataforma TO pedernal_plataforma;

ALTER TABLE plantilla_de_rol ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantilla_de_rol FORCE ROW LEVEL SECURITY;
ALTER TABLE version_de_plantilla ENABLE ROW LEVEL SECURITY;
ALTER TABLE version_de_plantilla FORCE ROW LEVEL SECURITY;
ALTER TABLE piso_de_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE piso_de_plataforma FORCE ROW LEVEL SECURITY;
ALTER TABLE accion_introducida ENABLE ROW LEVEL SECURITY;
ALTER TABLE accion_introducida FORCE ROW LEVEL SECURITY;
ALTER TABLE rol_de_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE rol_de_empresa FORCE ROW LEVEL SECURITY;
ALTER TABLE version_de_rol ENABLE ROW LEVEL SECURITY;
ALTER TABLE version_de_rol FORCE ROW LEVEL SECURITY;

-- app, tablas globales: con un contexto firmado válido (sin contexto no hay filas, como en el resto del esquema).
CREATE POLICY plantilla_de_rol_app_leer ON plantilla_de_rol FOR SELECT TO pedernal_app
  USING ((SELECT contexto_firmado()) IS NOT NULL);
CREATE POLICY version_de_plantilla_app_leer ON version_de_plantilla FOR SELECT TO pedernal_app
  USING ((SELECT contexto_firmado()) IS NOT NULL);
CREATE POLICY piso_de_plataforma_app_leer ON piso_de_plataforma FOR SELECT TO pedernal_app
  USING ((SELECT contexto_firmado()) IS NOT NULL);

-- app, tablas de empresa: solo las de su empresa, y para escribir la empresa tiene que estar operable.
CREATE POLICY rol_de_empresa_app_leer ON rol_de_empresa FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY rol_de_empresa_app_alta ON rol_de_empresa FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY rol_de_empresa_app_cambiar ON rol_de_empresa FOR UPDATE TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id))
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));
CREATE POLICY version_de_rol_app_leer ON version_de_rol FOR SELECT TO pedernal_app
  USING (empresa_id = (SELECT app_empresa_id()));
CREATE POLICY version_de_rol_app_alta ON version_de_rol FOR INSERT TO pedernal_app
  WITH CHECK (empresa_id = (SELECT app_empresa_id()) AND empresa_operable(empresa_id));

-- plataforma: permisivas abiertas, acotadas por las restrictivas de más abajo (actor vigente para leer; ADMIN para escribir), como 0007.
CREATE POLICY plantilla_de_rol_plataforma_leer ON plantilla_de_rol FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY version_de_plantilla_plataforma_leer ON version_de_plantilla FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY version_de_plantilla_plataforma_alta ON version_de_plantilla FOR INSERT TO pedernal_plataforma
  WITH CHECK (autor = (SELECT app_actor_plataforma()));
CREATE POLICY piso_de_plataforma_plataforma_leer ON piso_de_plataforma FOR SELECT TO pedernal_plataforma USING (true);
CREATE POLICY piso_de_plataforma_plataforma_alta ON piso_de_plataforma FOR INSERT TO pedernal_plataforma
  WITH CHECK (autor = (SELECT app_actor_plataforma()));
CREATE POLICY piso_de_plataforma_plataforma_cambiar ON piso_de_plataforma FOR UPDATE TO pedernal_plataforma
  USING (true) WITH CHECK (autor = (SELECT app_actor_plataforma()));
CREATE POLICY accion_introducida_plataforma_leer ON accion_introducida FOR SELECT TO pedernal_plataforma USING (true);

CREATE POLICY plantilla_de_rol_plataforma_con_actor ON plantilla_de_rol AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY version_de_plantilla_plataforma_con_actor ON version_de_plantilla AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY piso_de_plataforma_plataforma_con_actor ON piso_de_plataforma AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY accion_introducida_plataforma_con_actor ON accion_introducida AS RESTRICTIVE FOR SELECT TO pedernal_plataforma
  USING ((SELECT plataforma_actor_vigente()));
CREATE POLICY version_de_plantilla_plataforma_admin_alta ON version_de_plantilla AS RESTRICTIVE FOR INSERT TO pedernal_plataforma
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY piso_de_plataforma_plataforma_admin_alta ON piso_de_plataforma AS RESTRICTIVE FOR INSERT TO pedernal_plataforma
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
CREATE POLICY piso_de_plataforma_plataforma_admin_cambiar ON piso_de_plataforma AS RESTRICTIVE FOR UPDATE TO pedernal_plataforma
  USING ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])))
  WITH CHECK ((SELECT admin_plataforma_con_rol(ARRAY['ADMIN'])));
