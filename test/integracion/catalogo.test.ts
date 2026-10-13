import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { firmarCarga } from "../../src/adaptadores/postgres/contexto-firmado";
import { cuitDesdeTexto } from "../../src/primitivas/identificacion-fiscal/cuit";
import type { EstadoDeEmpresa } from "../../src/contexto/estados";
import { crearBaseAparte, cuitAlAzar } from "./entorno";
import {
  COLUMNAS_DE_EMPRESAS,
  ERRORES_DE_EMPRESAS_POR_RESTRICCION,
  TRANSICIONES_DE_EMPRESA,
} from "../../src/modulos/empresas/publico";
import {
  COLUMNAS_DE_TENANT,
  ERRORES_DE_TENANT_POR_RESTRICCION,
} from "../../src/modulos/tenants/publico";

const base = inject("baseDePruebas");

const ROLES = ["zuluhub_app", "zuluhub_grupo", "zuluhub_trabajos", "zuluhub_plataforma"] as const;
const TABLAS_DE_NEGOCIO = [
  "instalacion",
  "tenant",
  "empresa",
  "sucursal",
  "persona",
  "membresia_tenant",
  "auditoria_empresa",
  "auditoria_plataforma",
  "auditoria_acceso_grupo",
  "trabajo",
  // H3 (0002_identidad)
  "membresia",
  "asignacion_sucursal",
  "invitacion",
  "invitacion_empresa",
  "invitacion_sucursal",
  // H5 plataforma (0004_plataforma)
  "admin_plataforma",
  "idempotencia_plataforma",
  "referencia_de_error",
  // H6 administración (0005_administracion)
  "traspaso_gerencia",
  // H7 fiscal (0006_fiscal)
  "provincia",
  "emisor",
  "domicilio",
  "datos_fiscales",
  "regla_emisor",
  "punto_de_venta",
  "serie_comprobante",
  // Marcas y planes (0007_marcas_y_planes)
  "marca",
  "dominio",
  "plan",
  "version_de_plan",
  "version_de_marca",
  "plan_de_tenant",
  "ajuste_de_perilla",
  "modulo_de_empresa",
  "nivel_de_control",
  // Alta por solicitud (migración de captación)
  "solicitud_de_alta",
  "limite_de_captacion",
  // Facturación (0009_facturacion)
  "comprobante",
  "comprobante_linea",
  "comprobante_alicuota",
  "certificado_arca",
  "acceso_arca",
  "intento_arca",
] as const;
const TABLAS_DE_AUDITORIA = ["auditoria_empresa", "auditoria_plataforma", "auditoria_acceso_grupo"];

/** Restricciones que no están en el catálogo porque las lanzan los disparadores con nombre propio. */
const RESTRICCIONES_DE_DISPARADORES = [
  "empresa_tenant_inmutable",
  "empresa_tenant_no_activo",
  "empresa_transicion_invalida",
  "empresa_zona_horaria_ck",
  "tenant_instalacion_single",
  "sucursal_ultima_activa", // 0005
  "tenant_marca_inmutable", // 0007
];

describe.skipIf(base === null)("meta-tests sobre el catálogo de la base", () => {
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  const filas = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  // Tablas ordinarias ('r') y particionadas ('p'): una tabla madre particionada también tiene que
  // pasar por el control de RLS. (Las particiones son 'r' y se revisan como cualquier tabla.)
  const tablasDeNegocio = async (cliente: pg.Client) =>
    (
      await cliente.query<{
        relname: string;
        relkind: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p')
           and c.relname not in ('migracion', 'contexto_clave')`,
      )
    ).rows;

  describe("aislamiento", () => {
    it("toda tabla de negocio tiene RLS activo y forzado", async () => {
      const tablas = await tablasDeNegocio(dueno);
      expect(tablas.map((t) => t.relname).sort()).toEqual([...TABLAS_DE_NEGOCIO].sort());
      for (const tabla of tablas) {
        expect(tabla.relrowsecurity, `${tabla.relname}: RLS activo`).toBe(true);
        expect(tabla.relforcerowsecurity, `${tabla.relname}: RLS forzado`).toBe(true);
      }
    });

    it("contexto_clave tiene RLS activo (sin FORCE ni políticas) y nadie más que el dueño la toca", async () => {
      const tabla = await filas<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `select relrowsecurity, relforcerowsecurity from pg_class
         where oid = 'public.contexto_clave'::regclass`,
      );
      expect(tabla).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
      expect(
        await filas(`select 1 from pg_policies where tablename = 'contexto_clave'`),
        "contexto_clave no tiene políticas",
      ).toEqual([]);
      // Ni privilegios de tabla ni de columna, para los cuatro roles ni para PUBLIC.
      expect(
        await filas(
          `select grantee, privilege_type from information_schema.table_privileges
           where table_schema = 'public' and table_name = 'contexto_clave'
             and (grantee = any($1) or grantee = 'PUBLIC')`,
          [[...ROLES]],
        ),
      ).toEqual([]);
      expect(
        await filas(
          `select grantee, column_name, privilege_type from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'contexto_clave'
             and (grantee = any($1) or grantee = 'PUBLIC')`,
          [[...ROLES]],
        ),
      ).toEqual([]);
      // Y la tabla es del dueño de la migración, no de un rol limitado.
      const duenos = await filas<{ tableowner: string }>(
        `select tableowner from pg_tables where schemaname = 'public' and tablename = 'contexto_clave'`,
      );
      expect(ROLES).not.toContain(duenos[0]?.tableowner);
    });

    it("toda tabla con empresa_id tiene una clave foránea a empresa(id)", async () => {
      const sinClave = await filas<{ tabla: string }>(
        `select c.table_name as tabla
         from information_schema.columns c
         where c.table_schema = 'public' and c.column_name = 'empresa_id'
           and not exists (
             select 1 from pg_constraint k
             where k.conrelid = format('public.%I', c.table_name)::regclass
               and k.contype = 'f' and k.confrelid = 'public.empresa'::regclass
           )`,
      );
      expect(sinClave).toEqual([]);
    });

    it("toda tabla de negocio tiene al menos una política por rol que puede tocarla", async () => {
      const sinPoliticas = await filas<{ tabla: string; rol: string }>(
        `select p.table_name as tabla, p.grantee as rol
         from information_schema.table_privileges p
         where p.table_schema = 'public' and p.grantee = any($1)
           and p.privilege_type in ('SELECT', 'INSERT', 'UPDATE')
           and not exists (
             select 1 from pg_policies pol
             where pol.schemaname = 'public' and pol.tablename = p.table_name and p.grantee = any(pol.roles::text[])
           )
         group by 1, 2`,
        [[...ROLES]],
      );
      expect(sinPoliticas).toEqual([]);
    });
  });

  describe("roles de base", () => {
    it("los cuatro roles existen y ninguno es superusuario, dueño ni evade RLS", async () => {
      const roles = await filas<Record<string, unknown>>(
        `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
         from pg_roles where rolname = any($1) order by rolname`,
        [[...ROLES]],
      );
      expect(roles.map((r) => r["rolname"])).toEqual([...ROLES].sort());
      for (const rol of roles) {
        expect(rol, String(rol["rolname"])).toMatchObject({
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
          rolinherit: false,
        });
      }
      const duenos = await filas<{ tablename: string; tableowner: string }>(
        `select tablename, tableowner from pg_tables where schemaname = 'public' and tableowner = any($1)`,
        [[...ROLES]],
      );
      expect(duenos).toEqual([]);
      const pertenencias = await filas(
        `select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = any($1)`,
        [[...ROLES]],
      );
      expect(pertenencias).toEqual([]);
    });

    it("ningún rol puede borrar, truncar, referenciar ni crear disparadores en ninguna tabla", async () => {
      const prohibidos = await filas<{
        grantee: string;
        table_name: string;
        privilege_type: string;
      }>(
        `select grantee, table_name, privilege_type from information_schema.table_privileges
         where table_schema = 'public' and grantee = any($1)
           and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`,
        [[...ROLES]],
      );
      expect(prohibidos).toEqual([]);
    });

    it("las tablas de auditoría no tienen UPDATE para nadie", async () => {
      const permitidos = await filas(
        `select grantee, table_name from information_schema.table_privileges
         where table_schema = 'public' and table_name = any($1) and grantee = any($2)
           and privilege_type = 'UPDATE'`,
        [TABLAS_DE_AUDITORIA, [...ROLES]],
      );
      expect(permitidos).toEqual([]);
    });

    it("los privilegios de tabla por rol son exactamente los esperados (INSERT y UPDATE van por columna, en los tests siguientes)", async () => {
      const privilegios = await filas<{
        grantee: string;
        table_name: string;
        privilege_type: string;
      }>(
        `select grantee, table_name, privilege_type from information_schema.table_privileges
         where table_schema = 'public' and grantee = any($1) order by 1, 2, 3`,
        [[...ROLES]],
      );
      const porRol = (rol: string) =>
        privilegios
          .filter((p) => p.grantee === rol)
          .map((p) => `${p.table_name}:${p.privilege_type}`);
      expect(porRol("zuluhub_app")).toEqual(
        [
          "acceso_arca:SELECT", // 0009
          "asignacion_sucursal:SELECT",
          "auditoria_empresa:SELECT",
          "certificado_arca:SELECT", // 0009
          "comprobante:SELECT", // 0009
          "comprobante_alicuota:SELECT", // 0009
          "comprobante_linea:SELECT", // 0009
          "datos_fiscales:SELECT", // 0006
          "domicilio:SELECT", // 0006
          "emisor:SELECT", // 0006
          "empresa:SELECT",
          "intento_arca:SELECT", // 0009
          "invitacion:SELECT",
          "invitacion_empresa:SELECT",
          "invitacion_sucursal:SELECT",
          "marca:SELECT", // 0007
          "membresia:SELECT",
          "membresia_tenant:SELECT",
          "modulo_de_empresa:SELECT", // 0007
          "nivel_de_control:SELECT", // 0007
          "persona:SELECT",
          "provincia:SELECT", // 0006
          "punto_de_venta:SELECT", // 0006
          "regla_emisor:SELECT", // 0006
          "serie_comprobante:SELECT", // 0006
          "sucursal:SELECT",
          "tenant:SELECT",
          "trabajo:SELECT",
          "traspaso_gerencia:SELECT",
        ].sort(),
      );
      expect(porRol("zuluhub_grupo")).toEqual(
        [
          "empresa:SELECT",
          "membresia_tenant:SELECT",
          "persona:SELECT",
          "sucursal:SELECT",
          "tenant:SELECT",
        ].sort(),
      );
      expect(porRol("zuluhub_trabajos")).toEqual(["trabajo:SELECT"]);
      expect(porRol("zuluhub_plataforma")).toEqual(
        [
          "admin_plataforma:SELECT",
          "ajuste_de_perilla:SELECT", // 0007
          "auditoria_plataforma:SELECT",
          "dominio:SELECT", // 0007
          "emisor:SELECT", // 0006
          "empresa:SELECT",
          "idempotencia_plataforma:SELECT",
          "instalacion:SELECT",
          "invitacion:SELECT",
          "invitacion_empresa:SELECT",
          "marca:SELECT", // 0007
          "membresia_tenant:SELECT",
          "modulo_de_empresa:SELECT", // 0007
          "persona:SELECT",
          "plan:SELECT", // 0007
          "plan_de_tenant:SELECT", // 0007
          "referencia_de_error:SELECT",
          "serie_comprobante:SELECT", // 0006
          "solicitud_de_alta:SELECT", // captación
          "tenant:SELECT",
          "trabajo:SELECT",
          "traspaso_gerencia:SELECT",
          "version_de_marca:SELECT", // 0007
          "version_de_plan:SELECT", // 0007
        ].sort(),
      );
    });

    it("los UPDATE son por columna: nadie puede cambiar tenant_id, empresa_id, id ni los contadores", async () => {
      const columnas = await filas<{ grantee: string; table_name: string; column_name: string }>(
        `select grantee, table_name, column_name from information_schema.column_privileges
         where table_schema = 'public' and grantee = any($1) and privilege_type = 'UPDATE'
         order by 1, 2, 3`,
        [[...ROLES]],
      );
      const permitidas = columnas.map((c) => `${c.grantee}:${c.table_name}.${c.column_name}`);
      expect(permitidas).toEqual(
        [
          // 0009: el acceso a ARCA guarda el ticket cifrado; el certificado se carga, se reemplaza y se descarta;
          // el comprobante solo mueve su estado; el ambiente del punto de venta (QF2).
          ...[
            "credencial_cifrada",
            "credencial_nonce",
            "credencial_etiqueta",
            "credencial_kid",
            "generado_en",
            "expira_en",
            "renovando_hasta",
          ].map((c) => `zuluhub_app:acceso_arca.${c}`),
          ...["estado", "certificado_pem", "huella_sha256", "vence_en", "autorizacion_verificada_en"].map(
            (c) => `zuluhub_app:certificado_arca.${c}`,
          ),
          ...[
            "estado",
            "envios",
            "numero_reservado",
            "fecha_emision",
            "numero",
            "cae",
            "cae_vence",
            "autorizado_en",
            "resuelto_por",
            "motivo_descarte",
          ].map((c) => `zuluhub_app:comprobante.${c}`),
          "zuluhub_app:punto_de_venta.ambiente",
          "zuluhub_app:asignacion_sucursal.activa",
          // 0006: los datos fiscales y la regla del emisor se editan en borrador y se confirman
          ...[
            "razon_social",
            "condicion_iva",
            "domicilio_fiscal_id",
            "inicio_actividades",
            "iibb_numero",
            "iibb_condicion",
            "estado",
            "numero",
            "vigente_desde",
            "confirmada_en",
            "confirmada_por",
            "motivo",
          ].map((c) => `zuluhub_app:datos_fiscales.${c}`),
          "zuluhub_app:empresa.estado", // solo para activar el alta del gerente (política acotada)
          "zuluhub_app:empresa.motivo_estado",
          "zuluhub_app:invitacion.aceptada_en",
          "zuluhub_app:invitacion.aceptada_por",
          "zuluhub_app:invitacion.estado",
          "zuluhub_app:invitacion.motivo_revocacion",
          "zuluhub_app:invitacion.reemplazada_por",
          "zuluhub_app:invitacion.revocada_en",
          "zuluhub_app:membresia.activo",
          // `rol` desde 0005: solo cambia al aceptar un traspaso (política + disparador `membresia_cambio`)
          "zuluhub_app:membresia.rol",
          ...["numero", "sucursal_id", "domicilio_id", "estado"].map(
            (c) => `zuluhub_app:punto_de_venta.${c}`,
          ),
          ...[
            "permitir_eleccion_manual",
            "estado",
            "numero",
            "vigente_desde",
            "confirmada_en",
            "confirmada_por",
            "motivo",
          ].map((c) => `zuluhub_app:regla_emisor.${c}`),
          ...[
            "ultimo_numero",
            "estado",
            "numero_en_curso",
            "solicitud_en_curso",
            "en_curso_hasta",
            "motivo_bloqueo",
          ].map((c) => `zuluhub_app:serie_comprobante.${c}`),
          "zuluhub_app:nivel_de_control.nivel", // 0007
          "zuluhub_app:sucursal.activa",
          "zuluhub_app:sucursal.hora_de_corte", // 0007
          "zuluhub_app:sucursal.nombre",
          "zuluhub_app:traspaso_gerencia.estado",
          "zuluhub_app:traspaso_gerencia.motivo",
          "zuluhub_app:traspaso_gerencia.resuelto_en",
          "zuluhub_app:traspaso_gerencia.saliente_persona_id",
          // 0007: la plataforma (solo un ADMIN, por las restrictivas) escribe marcas, dominios, planes y módulos
          "zuluhub_plataforma:dominio.estado",
          "zuluhub_plataforma:dominio.motivo",
          "zuluhub_plataforma:dominio.verificado_en",
          "zuluhub_plataforma:emisor.activo", // 0006
          "zuluhub_plataforma:emisor.cuit", // 0006
          "zuluhub_plataforma:empresa.cuit",
          "zuluhub_plataforma:empresa.estado",
          "zuluhub_plataforma:empresa.motivo_estado",
          "zuluhub_plataforma:empresa.razon_social",
          "zuluhub_plataforma:empresa.zona_horaria",
          "zuluhub_plataforma:invitacion.estado",
          "zuluhub_plataforma:invitacion.motivo_revocacion",
          "zuluhub_plataforma:invitacion.reemplazada_por",
          "zuluhub_plataforma:invitacion.revocada_en",
          "zuluhub_plataforma:marca.estado", // 0007
          "zuluhub_plataforma:membresia_tenant.activo",
          "zuluhub_plataforma:modulo_de_empresa.activo", // 0007
          "zuluhub_plataforma:persona.activo_global",
          "zuluhub_plataforma:plan.estado", // 0007
          // captación: un ADMIN decide, `sistema` vence y anonimiza (los datos personales se anonimizan)
          ...[
            "estado",
            "decidida_por",
            "decidida_en",
            "motivo_de_rechazo",
            "nota_interna",
            "empresa_creada_id",
            "anonimizada_en",
            "email",
            "nombre_contacto",
            "nombre_negocio",
            "telefono",
            "cuit",
            "id_de_medicion",
            "atribucion",
          ].map((c) => `zuluhub_plataforma:solicitud_de_alta.${c}`),
          "zuluhub_plataforma:tenant.estado",
          "zuluhub_plataforma:tenant.motivo_estado",
          "zuluhub_plataforma:tenant.nombre",
          "zuluhub_plataforma:traspaso_gerencia.estado",
          "zuluhub_plataforma:traspaso_gerencia.motivo",
          "zuluhub_plataforma:traspaso_gerencia.resuelto_en",
          ...[
            "nombre_comercial",
            "modulos",
            "perillas",
            "estado",
            "numero",
            "motivo",
            "publicada_en",
            "publicada_por",
          ].map((c) => `zuluhub_plataforma:version_de_plan.${c}`), // 0007
          ...[
            "nombre_visible",
            "tema",
            "logo",
            "vocabulario",
            "modulos_iniciales",
            "plan_por_defecto_id",
            "estado",
            "numero",
            "vigente_desde",
            "reemplaza_programada",
            "motivo",
            "confirmada_en",
            "confirmada_por",
          ].map((c) => `zuluhub_plataforma:version_de_marca.${c}`), // 0007
          "zuluhub_trabajos:trabajo.estado",
          "zuluhub_trabajos:trabajo.intentos",
          "zuluhub_trabajos:trabajo.proximo_intento",
          "zuluhub_trabajos:trabajo.tomado_hasta",
          "zuluhub_trabajos:trabajo.ultimo_error",
        ].sort(),
      );
    });

    it("los INSERT son por columna, con la lista exacta por rol: nadie da de alta una fila con creado_en, version, estado ni intentos a mano", async () => {
      const columnas = await filas<{ grantee: string; table_name: string; column_name: string }>(
        `select grantee, table_name, column_name from information_schema.column_privileges
         where table_schema = 'public' and grantee = any($1) and privilege_type = 'INSERT'
         order by 1, 2, 3`,
        [[...ROLES]],
      );
      const porRol = (rol: string) =>
        columnas
          .filter((c) => c.grantee === rol)
          .map((c) => `${c.table_name}.${c.column_name}`)
          .sort();
      const auditoriaDeEmpresa = [
        "empresa_id",
        "actor_persona_id",
        "accion",
        "entidad",
        "entidad_id",
        "antes",
        "despues",
      ].map((c) => `auditoria_empresa.${c}`);
      const invitacionEmitida = [
        "id",
        "tenant_id",
        "tipo",
        "email",
        "token_hash",
        "emitida_en",
        "vence_en",
        "emitida_por",
      ].map((c) => `invitacion.${c}`);
      const referenciaDeError = ["referencia", "accion", "motivo", "empresa_id", "persona_id"].map(
        (c) => `referencia_de_error.${c}`,
      );
      const traspasoDeLaEmpresa = [
        "empresa_id",
        "origen",
        "propuesto_por",
        "saliente_persona_id",
        "entrante_persona_id",
        "propuesto_en",
        "vence_en",
      ].map((c) => `traspaso_gerencia.${c}`);
      const traspasoDePlataforma = [
        "empresa_id",
        "origen",
        "entrante_persona_id",
        "propuesto_en",
        "vence_en",
      ].map((c) => `traspaso_gerencia.${c}`);
      const invitacionEmpresa = [
        "invitacion_id",
        "empresa_id",
        "tenant_id",
        "rol",
        "email",
        "token_hash",
        "estado",
        "tipo",
      ].map((c) => `invitacion_empresa.${c}`);
      // 0006 (H7 fiscal): ninguna toma `creado_en`, `version`, `estado` inicial ni los datos de la confirmación.
      const fiscalDeLaEmpresa = [
        ...[
          "id",
          "empresa_id",
          "calle",
          "numero",
          "piso",
          "departamento",
          "localidad",
          "provincia",
          "codigo_postal",
        ].map((c) => `domicilio.${c}`),
        ...[
          "id",
          "empresa_id",
          "emisor_id",
          "razon_social",
          "condicion_iva",
          "domicilio_fiscal_id",
          "inicio_actividades",
          "iibb_numero",
          "iibb_condicion",
          "creado_por",
        ].map((c) => `datos_fiscales.${c}`),
        ...["id", "empresa_id", "permitir_eleccion_manual", "creado_por"].map(
          (c) => `regla_emisor.${c}`,
        ),
        ...["id", "empresa_id", "emisor_id", "sucursal_id", "numero", "domicilio_id"].map(
          (c) => `punto_de_venta.${c}`,
        ),
        ...[
          "empresa_id",
          "punto_de_venta_id",
          "emisor_id",
          "tipo_comprobante",
          "ultimo_numero",
        ].map((c) => `serie_comprobante.${c}`),
      ];
      // 0009 (facturación): el comprobante nace completo (sin estado, envíos, número ni CAE); los renglones, el
      // desglose y los intentos son de solo inserción; el certificado y el ticket de acceso.
      const facturacion = [
        ...[
          "id",
          "empresa_id",
          "emisor_id",
          "punto_de_venta_id",
          "ambiente",
          "origen_tipo",
          "origen_id",
          "clase",
          "tipo_comprobante",
          "concepto",
          "servicio_desde",
          "servicio_hasta",
          "vencimiento_pago",
          "moneda",
          "modo_de_precio",
          "total",
          "neto_gravado",
          "iva",
          "exento",
          "no_gravado",
          "datos_fiscales_id",
          "emisor_cuit",
          "emisor_razon_social",
          "emisor_condicion_iva",
          "emisor_domicilio_fiscal",
          "emisor_inicio_actividades",
          "emisor_iibb_numero",
          "emisor_iibb_condicion",
          "punto_de_venta_numero",
          "punto_de_venta_domicilio",
          "receptor_parte_id",
          "receptor_nombre",
          "receptor_documento_tipo",
          "receptor_documento_numero",
          "receptor_condicion_iva",
          "receptor_domicilio",
          "comprobante_asociado_id",
          "motivo",
          "huella",
          "version_de_representacion",
          "creado_por",
        ].map((c) => `comprobante.${c}`),
        ...[
          "empresa_id",
          "comprobante_id",
          "posicion",
          "descripcion",
          "cantidad",
          "precio_unitario",
          "descuento",
          "alicuota",
          "importe",
        ].map((c) => `comprobante_linea.${c}`),
        ...["empresa_id", "comprobante_id", "alicuota", "total", "neto", "iva"].map(
          (c) => `comprobante_alicuota.${c}`,
        ),
        ...[
          "id",
          "empresa_id",
          "comprobante_id",
          "operacion",
          "numero",
          "desenlace",
          "mensajes",
          "respuesta",
          "huella_pedido",
          "iniciado_en",
          "duracion_ms",
        ].map((c) => `intento_arca.${c}`),
        ...[
          "id",
          "empresa_id",
          "emisor_id",
          "ambiente",
          "alias",
          "cuit_titular",
          "pedido_pem",
          "clave_cifrada",
          "clave_nonce",
          "clave_etiqueta",
          "clave_kid",
          "creado_por",
        ].map((c) => `certificado_arca.${c}`),
        ...["empresa_id", "certificado_id", "servicio"].map((c) => `acceso_arca.${c}`),
        "serie_comprobante.ambiente",
      ];
      // 0007: la empresa fija el nivel de sus controles; la plataforma escribe lo de marcas y planes.
      const nivelDeControl = ["empresa_id", "sucursal_id", "control", "nivel"].map(
        (c) => `nivel_de_control.${c}`,
      );
      const marcasYPlanes = [
        ...["codigo", "marca_padre_id"].map((c) => `marca.${c}`),
        ...[
          "host",
          "superficie",
          "duenio_marca_id",
          "duenio_empresa_id",
          "titular",
          "es_canonico",
          "registrado_por",
        ].map((c) => `dominio.${c}`),
        "plan.codigo",
        ...["plan_id", "nombre_comercial", "modulos", "perillas"].map(
          (c) => `version_de_plan.${c}`,
        ),
        ...[
          "marca_id",
          "nombre_visible",
          "tema",
          "logo",
          "vocabulario",
          "modulos_iniciales",
          "plan_por_defecto_id",
        ].map((c) => `version_de_marca.${c}`),
        ...[
          "tenant_id",
          "numero",
          "version_de_plan_id",
          "vigente_desde",
          "origen",
          "reemplaza_programada",
          "motivo",
          "asignado_por",
        ].map((c) => `plan_de_tenant.${c}`),
        ...[
          "tenant_id",
          "empresa_id",
          "perilla",
          "numero",
          "valor",
          "vigente_desde",
          "reemplaza_programada",
          "motivo",
          "asignado_por",
        ].map((c) => `ajuste_de_perilla.${c}`),
        ...["empresa_id", "modulo"].map((c) => `modulo_de_empresa.${c}`),
        "tenant.marca_id",
      ];
      expect(porRol("zuluhub_app")).toEqual(
        [
          ...auditoriaDeEmpresa,
          ...nivelDeControl,
          ...["empresa_id", "persona_id", "sucursal_id"].map((c) => `asignacion_sucursal.${c}`),
          ...invitacionEmitida,
          ...invitacionEmpresa,
          ...["invitacion_id", "empresa_id", "sucursal_id"].map((c) => `invitacion_sucursal.${c}`),
          ...["empresa_id", "persona_id", "rol", "invitacion_id"].map((c) => `membresia.${c}`),
          ...referenciaDeError,
          "persona.email",
          "sucursal.empresa_id",
          "sucursal.nombre",
          "trabajo.empresa_id",
          "trabajo.tipo",
          "trabajo.datos",
          "trabajo.clave_idempotencia",
          ...traspasoDeLaEmpresa,
          ...fiscalDeLaEmpresa,
          ...facturacion,
        ].sort(),
      );
      expect(porRol("zuluhub_grupo")).toEqual(
        [
          // `resultado` desde 0007: PERMITIDO (propietario) o DENEGADO (intento de quien no lo es)
          ...["tenant_id", "persona_id", "empresa_id", "resultado"].map(
            (c) => `auditoria_acceso_grupo.${c}`,
          ),
          ...referenciaDeError,
        ].sort(),
      );
      expect(porRol("zuluhub_trabajos")).toEqual([]);
      expect(porRol("zuluhub_plataforma")).toEqual(
        [
          ...auditoriaDeEmpresa,
          ...["actor", "accion", "entidad", "entidad_id", "antes", "despues"].map(
            (c) => `auditoria_plataforma.${c}`,
          ),
          ...["admin_id", "clave", "operacion", "huella", "resultado"].map(
            (c) => `idempotencia_plataforma.${c}`,
          ),
          ...referenciaDeError,
          ...["tenant_id", "cuit", "razon_social", "zona_horaria"].map((c) => `empresa.${c}`),
          ...["empresa_id", "es_principal", "cuit"].map((c) => `emisor.${c}`), // 0006
          ...invitacionEmitida,
          ...invitacionEmpresa,
          ...["persona_id", "tenant_id", "rol", "activo"].map((c) => `membresia_tenant.${c}`),
          "persona.email",
          "sucursal.empresa_id",
          "sucursal.nombre",
          "tenant.nombre",
          "trabajo.empresa_id",
          "trabajo.tipo",
          "trabajo.datos",
          "trabajo.clave_idempotencia",
          ...traspasoDePlataforma,
          ...marcasYPlanes,
        ].sort(),
      );
    });

    it("PUBLIC no tiene privilegios sobre las tablas", async () => {
      const publicos = await filas(
        `select 1 from information_schema.table_privileges where table_schema = 'public' and grantee = 'PUBLIC'`,
      );
      expect(publicos).toEqual([]);
    });
  });

  describe("endurecimiento del esquema", () => {
    const MIGRACION = readFileSync(
      join(import.meta.dirname, "../../migraciones/0001_base.sql"),
      "utf8",
    );
    const SEARCH_PATH_FIJO = "search_path=pg_catalog, public, pg_temp";

    it("toda función del esquema public fija su search_path (con pg_temp al final)", async () => {
      const funciones = await filas<{ firma: string; proconfig: string[] | null }>(
        `select p.oid::regprocedure::text as firma, p.proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
         order by 1`,
      );
      expect(funciones.length, "hay funciones que revisar").toBeGreaterThan(10);
      const sinFijar = funciones
        .filter((f) => !(f.proconfig ?? []).includes(SEARCH_PATH_FIJO))
        .map((f) => f.firma);
      expect(sinFijar, "funciones sin search_path fijo").toEqual([]);
    });

    it("la ÚNICA función SECURITY DEFINER del esquema public es contexto_firmado, con search_path fijo y dueña ajena a los roles limitados", async () => {
      const definer = await filas<{
        proname: string;
        proconfig: string[] | null;
        dueno: string;
      }>(
        `select p.proname, p.proconfig, r.rolname as dueno
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_roles r on r.oid = p.proowner
         where n.nspname = 'public' and p.prosecdef
         order by 1`,
      );
      expect(definer.map((f) => f.proname)).toEqual(["contexto_firmado"]);
      expect(definer[0]?.proconfig).toContain(SEARCH_PATH_FIJO);
      expect(ROLES).not.toContain(definer[0]?.dueno);
    });

    it("los cuatro roles pueden ejecutar contexto_firmado y las app_*, y PUBLIC no", async () => {
      for (const funcion of [
        "contexto_firmado()",
        "app_empresa_id()",
        "app_tenant_id()",
        "app_persona_id()",
        "app_token_invitacion()",
      ]) {
        for (const rol of ROLES) {
          const { rows } = await dueno.query<{ puede: boolean }>(
            `select has_function_privilege($1, $2::regprocedure, 'EXECUTE') as puede`,
            [rol, `public.${funcion}`],
          );
          expect(rows[0]?.puede, `${rol} ejecuta ${funcion}`).toBe(true);
        }
      }
    });

    it("ninguna función del esquema public es ejecutable por PUBLIC", async () => {
      const abiertas = await filas<{ firma: string }>(
        `select p.oid::regprocedure::text as firma
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and (
             p.proacl is null
             or exists (
               select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
             )
           )
         order by 1`,
      );
      expect(abiertas, "funciones con EXECUTE para PUBLIC").toEqual([]);
    });

    it("las funciones que se creen después también nacen cerradas (privilegios por defecto)", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base);
      const cliente = new pg.Client({ connectionString: aparte.base.dueno });
      await cliente.connect();
      try {
        await cliente.query(
          "create function funcion_futura() returns int language sql as 'select 1'",
        );
        const { rows } = await cliente.query<{ abierta: boolean }>(
          `select (p.proacl is null or exists (
                     select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
                   )) as abierta
           from pg_proc p where p.proname = 'funcion_futura'`,
        );
        expect(rows).toEqual([{ abierta: false }]);
      } finally {
        await cliente.end();
        await aparte.destruir();
      }
    });

    // `security_invoker` solo existe en las vistas comunes ('v'): Postgres lo rechaza en las vistas
    // materializadas ("unrecognized parameter") y en las tablas particionadas ("cannot specify
    // storage parameters"). Por eso cada clase tiene su propia regla.
    const vistasSinSecurityInvoker = async (cliente: pg.Client) =>
      (
        await cliente.query<{ relname: string; relkind: string }>(
          `select c.relname, c.relkind
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v'
             and not ('security_invoker=true' = any (coalesce(c.reloptions, '{}')))
           order by 1`,
        )
      ).rows;

    // Una vista materializada no admite RLS y se llena con los permisos de su dueño (en Neon, un rol
    // que evade RLS): mezclaría clientes. Las alternativas son una tabla de resumen común, con RLS.
    const vistasMaterializadas = async (cliente: pg.Client) =>
      (
        await cliente.query<{ relname: string; relkind: string }>(
          `select c.relname, c.relkind
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'm'
           order by 1`,
        )
      ).rows;

    it("no hay vistas comunes sin security_invoker", async () => {
      expect(await vistasSinSecurityInvoker(dueno)).toEqual([]);
    });

    it("no hay vistas materializadas (no admiten RLS: se usa una tabla de resumen con RLS)", async () => {
      expect(await vistasMaterializadas(dueno)).toEqual([]);
    });

    it("los chequeos de vistas y de tablas particionadas muerden", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base);
      const cliente = new pg.Client({ connectionString: aparte.base.dueno });
      await cliente.connect();
      try {
        await cliente.query("create view vista_abierta as select id from tenant");
        await cliente.query(
          "create view vista_cerrada with (security_invoker = true) as select id from tenant",
        );
        await cliente.query(
          "create materialized view vista_materializada as select id from tenant",
        );
        await cliente.query("create table madre (id int not null, v int) partition by range (id)");
        expect(await vistasSinSecurityInvoker(cliente)).toEqual([
          { relname: "vista_abierta", relkind: "v" },
        ]);
        expect(await vistasMaterializadas(cliente)).toEqual([
          { relname: "vista_materializada", relkind: "m" },
        ]);
        // La tabla madre particionada aparece en el control de RLS, sin RLS: ese test fallaría.
        const madre = (await tablasDeNegocio(cliente)).find((t) => t.relname === "madre");
        expect(madre).toMatchObject({
          relkind: "p",
          relrowsecurity: false,
          relforcerowsecurity: false,
        });
      } finally {
        await cliente.end();
        await aparte.destruir();
      }
    });

    it("toda política de alta o cambio de la aplicación sobre sucursal, trabajo y auditoria_empresa exige empresa_operable", async () => {
      const sinEmpresaOperable = await filas<{ tablename: string; policyname: string }>(
        `select tablename, policyname from pg_policies
         where schemaname = 'public' and 'zuluhub_app' = any (roles)
           and tablename in ('sucursal', 'trabajo', 'auditoria_empresa')
           and cmd in ('INSERT', 'UPDATE', 'ALL')
           and coalesce(with_check, qual, '') not like '%empresa_operable(%'
         order by 1, 2`,
      );
      expect(sinEmpresaOperable, "políticas sin empresa_operable").toEqual([]);
      // Y existen todas las que tienen que existir (el test anterior no pasa por vacío).
      const existentes = await filas<{ tablename: string; cmd: string }>(
        `select tablename, cmd from pg_policies
         where schemaname = 'public' and 'zuluhub_app' = any (roles)
           and tablename in ('sucursal', 'trabajo', 'auditoria_empresa')
           and cmd in ('INSERT', 'UPDATE', 'ALL')
         order by 1, 2`,
      );
      expect(existentes).toEqual([
        { tablename: "auditoria_empresa", cmd: "INSERT" },
        // La del contexto de invitación (H3): también exige empresa_operable, o la empresa en alta.
        { tablename: "auditoria_empresa", cmd: "INSERT" },
        { tablename: "sucursal", cmd: "INSERT" },
        { tablename: "sucursal", cmd: "UPDATE" },
        { tablename: "trabajo", cmd: "INSERT" },
      ]);
    });

    it("la auditoría de la aplicación exige que el actor sea la persona del contexto", async () => {
      const { rows } = await dueno.query<{ with_check: string }>(
        `select with_check from pg_policies
         where schemaname = 'public' and policyname = 'auditoria_empresa_app_alta'`,
      );
      expect(rows[0]?.with_check).toMatch(
        /NOT \(actor_persona_id IS DISTINCT FROM \(\s*SELECT app_persona_id\(\)/,
      );
    });

    it("la zona horaria se valida con un disparador y no con un CHECK que cambiaría con tzdata", async () => {
      const { rows } = await dueno.query<{ conname: string }>(
        `select conname from pg_constraint where conrelid = 'public.empresa'::regclass and contype = 'c'`,
      );
      expect(rows.map((r) => r.conname)).not.toContain("empresa_zona_horaria_ck");
    });

    it("ningún rol limitado tiene TEMP sobre la base, ni PUBLIC", async () => {
      const { rows } = await dueno.query<{ rol: string; temp: boolean }>(
        `select r as rol, has_database_privilege(r, current_database(), 'TEMP') as temp
         from unnest($1::text[]) as r order by 1`,
        [[...ROLES]],
      );
      expect(rows).toEqual([...ROLES].sort().map((rol) => ({ rol, temp: false })));
      const { rows: publico } = await dueno.query(
        `select 1 from pg_database d, aclexplode(d.datacl) a
         where d.datname = current_database() and a.grantee = 0 and a.privilege_type = 'TEMPORARY'`,
      );
      expect(publico).toEqual([]);
    });

    it("cada rol tiene fijados statement_timeout, idle_in_transaction_session_timeout y lock_timeout", async () => {
      const { rows } = await dueno.query<{ rolname: string; setconfig: string[] }>(
        `select r.rolname, s.setconfig
         from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
         where s.setdatabase = 0 and r.rolname = any($1) order by 1`,
        [[...ROLES]],
      );
      expect(rows.map((r) => r.rolname)).toEqual([...ROLES].sort());
      for (const fila of rows) {
        expect([...fila.setconfig].sort(), fila.rolname).toEqual([
          "idle_in_transaction_session_timeout=60s",
          "lock_timeout=15s",
          "statement_timeout=30s",
        ]);
      }
    });

    describe("la migración frena a un rol que es miembro de otro", () => {
      // El primer bloque DO del archivo crea y revisa los roles. Se corre en una transacción que
      // se deshace: ni la pertenencia de prueba ni nada de lo que haga queda en el servidor.
      const bloqueDeRoles = /^DO \$\$[\s\S]*?^\$\$;/m.exec(MIGRACION)?.[0] ?? "";

      it("el bloque de roles se localiza y, sin pertenencias ajenas, corre sin errores", async () => {
        expect(bloqueDeRoles).toContain("CREATE ROLE");
        await dueno.query("begin");
        try {
          await expect(dueno.query(bloqueDeRoles)).resolves.toBeDefined();
        } finally {
          await dueno.query("rollback");
        }
      });

      it("falla con un mensaje claro si uno de los cuatro roles es miembro de otro rol", async () => {
        await dueno.query("begin");
        try {
          await dueno.query("grant pg_monitor to zuluhub_app");
          await expect(dueno.query(bloqueDeRoles)).rejects.toThrow(
            /zuluhub_app es miembro de pg_monitor/,
          );
        } finally {
          await dueno.query("rollback");
        }
      });
    });

    describe("las funciones no se dejan suplantar con tablas temporales", () => {
      // Lo que prueban estos tests no depende de REVOKE TEMPORARY: el dueño de la base (que sí
      // puede crear temporales) arma tablas falsas y las funciones deben ignorarlas. Se hace todo
      // en una transacción que se deshace.
      const enTransaccion = async (cuerpo: () => Promise<void>) => {
        await dueno.query("begin");
        try {
          await cuerpo();
        } finally {
          await dueno.query("rollback");
        }
      };
      const escalar = async <T>(texto: string, parametros: unknown[] = []) =>
        (await dueno.query<{ v: T }>(`select ${texto} as v`, parametros)).rows[0]?.v;

      /** Un tenant suspendido con una empresa ACTIVE, y copias temporales "falsas" donde todo opera. */
      const armarSuplantacion = async () => {
        const { rows: t } = await dueno.query<{ id: string }>(
          "insert into public.tenant (nombre) values ('suplantacion') returning id",
        );
        const tenant = t[0]?.id as string;
        const { rows: e } = await dueno.query<{ id: string }>(
          `insert into public.empresa (tenant_id, cuit, razon_social, estado)
           values ($1, '30500010912', 'suplantacion', 'ACTIVE') returning id`,
          [tenant],
        );
        const empresa = e[0]?.id as string;
        const { rows: o } = await dueno.query<{ id: string }>(
          `insert into public.empresa (tenant_id, cuit, razon_social, estado)
           values ($1, $2, 'suplantacion 2', 'ACTIVE') returning id`,
          [tenant, cuitAlAzar()],
        );
        const otraEmpresa = o[0]?.id as string;
        await dueno.query(
          "update public.tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1",
          [tenant],
        );
        const { rows: p } = await dueno.query<{ id: string }>(
          "insert into public.persona (email) values ('suplantacion@prueba.test') returning id",
        );
        const persona = p[0]?.id as string;
        // Las copias falsas: el tenant figura ACTIVE (y `empresa` cuelga de él, así que parece
        // operable), `otraEmpresa` cuelga de un tenant inventado, y la persona es propietaria.
        await dueno.query("create temp table tenant as select * from public.tenant");
        await dueno.query("update pg_temp.tenant set estado = 'ACTIVE', motivo_estado = null");
        await dueno.query("create temp table empresa as select * from public.empresa");
        await dueno.query(
          "update pg_temp.empresa set tenant_id = gen_random_uuid() where id = $1",
          [otraEmpresa],
        );
        await dueno.query("create temp table persona as select * from public.persona");
        await dueno.query(
          "create temp table membresia_tenant (like public.membresia_tenant including defaults)",
        );
        await dueno.query(
          "insert into pg_temp.membresia_tenant (persona_id, tenant_id, rol, activo) values ($1, $2, 'PROPIETARIO', true)",
          [persona, tenant],
        );
        // El dueño también pasa por el contexto firmado: token de SU rol de sesión y de esa persona.
        const { rows: sesion } = await dueno.query<{ u: string }>("select session_user::text as u");
        const token = firmarCarga(base!.clave, {
          u: sesion[0]?.u as string,
          e: null,
          t: null,
          p: persona,
          i: null,
          x: Math.floor(Date.now() / 1000) + 300,
          a: null,
        });
        await dueno.query("select set_config('app.ctx', $1, true)", [token]);
        return { tenant, empresa, otraEmpresa, persona };
      };

      it("empresa_operable, tenant_activo, tenant_de_empresa y es_propietario_activo miran las tablas reales", async () => {
        await enTransaccion(async () => {
          const { tenant, empresa, otraEmpresa } = await armarSuplantacion();
          expect(await escalar<boolean>("public.empresa_operable($1)", [empresa])).toBe(false);
          expect(await escalar<boolean>("public.tenant_activo($1)", [tenant])).toBe(false);
          expect(await escalar<string>("public.tenant_de_empresa($1)", [otraEmpresa])).toBe(tenant);
          expect(await escalar<boolean>("public.es_propietario_activo($1)", [tenant])).toBe(false);
        });
      });

      it("los disparadores de alta de tenant y de empresa tampoco leen tablas temporales", async () => {
        await enTransaccion(async () => {
          const { tenant } = await armarSuplantacion();
          // Instalación SINGLE de verdad, con un "MULTI" falso en una temporal.
          await dueno.query("create temp table instalacion as select * from public.instalacion");
          await dueno.query("update public.instalacion set modo = 'SINGLE'");
          await dueno.query("savepoint s1");
          await expect(
            dueno.query("insert into public.tenant (nombre) values ('segundo')"),
          ).rejects.toMatchObject({ code: "23514", constraint: "tenant_instalacion_single" });
          await dueno.query("rollback to savepoint s1");
          // El tenant real está suspendido (el falso, ACTIVE): la empresa nueva se rechaza igual.
          await dueno.query("update public.instalacion set modo = 'MULTI'");
          await expect(
            dueno.query(
              `insert into public.empresa (tenant_id, cuit, razon_social) values ($1, $2, 'nueva')`,
              [tenant, cuitAlAzar()],
            ),
          ).rejects.toMatchObject({ code: "23514", constraint: "empresa_tenant_no_activo" });
        });
      });
    });

    it("sin la fila de instalación el alta de tenant falla cerrado, no asume MULTI", async () => {
      await dueno.query("begin");
      try {
        await dueno.query("delete from public.instalacion");
        await expect(
          dueno.query("insert into public.tenant (nombre) values ('sin instalacion')"),
        ).rejects.toThrow(/falta su fila/);
      } finally {
        await dueno.query("rollback");
      }
    });

    it("los nombres no aceptan espacios en blanco al inicio ni al final (tampoco tabulaciones ni saltos)", async () => {
      for (const nombre of [" a", "a ", "\ta", "a\n", "", " "]) {
        await dueno.query("begin");
        try {
          await expect(
            dueno.query("insert into public.tenant (nombre) values ($1)", [nombre]),
            JSON.stringify(nombre),
          ).rejects.toMatchObject({ code: "23514", constraint: "tenant_nombre_ck" });
        } finally {
          await dueno.query("rollback");
        }
      }
      await dueno.query("begin");
      try {
        await dueno.query("insert into public.tenant (nombre) values ('Grupo Uno  Sur')");
      } finally {
        await dueno.query("rollback");
      }
    });

    it("lo mismo vale para la razón social de la empresa y el nombre de la sucursal", async () => {
      await dueno.query("begin");
      try {
        const { rows } = await dueno.query<{ id: string }>(
          "insert into public.tenant (nombre) values ('espacios') returning id",
        );
        const tenant = rows[0]?.id as string;
        const alta = (razonSocial: string) =>
          dueno.query(
            "insert into public.empresa (tenant_id, cuit, razon_social) values ($1, '30500010912', $2)",
            [tenant, razonSocial],
          );
        for (const razonSocial of [
          " Mi Empresa",
          "Mi Empresa ",
          "\tMi Empresa",
          "Mi Empresa\n",
          "",
        ]) {
          await dueno.query("savepoint s");
          await expect(alta(razonSocial), JSON.stringify(razonSocial)).rejects.toMatchObject({
            code: "23514",
            constraint: "empresa_razon_social_ck",
          });
          await dueno.query("rollback to savepoint s");
        }
        await alta("Mi Empresa");
        const { rows: e } = await dueno.query<{ id: string }>(
          "select id from public.empresa where tenant_id = $1",
          [tenant],
        );
        for (const nombre of [" Central", "Central ", "\tCentral", "Central\n", ""]) {
          await dueno.query("savepoint s");
          await expect(
            dueno.query("insert into public.sucursal (empresa_id, nombre) values ($1, $2)", [
              e[0]?.id,
              nombre,
            ]),
            JSON.stringify(nombre),
          ).rejects.toMatchObject({ code: "23514", constraint: "sucursal_nombre_ck" });
          await dueno.query("rollback to savepoint s");
        }
      } finally {
        await dueno.query("rollback");
      }
    });

    it("la zona horaria se valida al dar de alta y al cambiarla, con el nombre de restricción que el módulo traduce", async () => {
      await dueno.query("begin");
      try {
        const { rows } = await dueno.query<{ id: string }>(
          "insert into public.tenant (nombre) values ('zonas') returning id",
        );
        const tenant = rows[0]?.id as string;
        const alta = (zona: string | null) =>
          dueno.query(
            "insert into public.empresa (tenant_id, cuit, razon_social, zona_horaria) values ($1, '30500010912', 'zonas', $2)",
            [tenant, zona],
          );
        await dueno.query("savepoint s");
        await expect(alta("Marte/Olympus")).rejects.toMatchObject({
          code: "23514",
          constraint: "empresa_zona_horaria_ck",
        });
        await dueno.query("rollback to savepoint s");
        // Un NULL lo rechaza NOT NULL, no el disparador.
        await expect(alta(null)).rejects.toMatchObject({ code: "23502" });
        await dueno.query("rollback to savepoint s");
        await alta("America/Argentina/Cordoba");
        await dueno.query("savepoint s");
        await expect(
          dueno.query(
            "update public.empresa set zona_horaria = 'Marte/Olympus' where tenant_id = $1",
            [tenant],
          ),
        ).rejects.toMatchObject({ code: "23514", constraint: "empresa_zona_horaria_ck" });
        await dueno.query("rollback to savepoint s");
        await dueno.query("update public.empresa set zona_horaria = 'UTC' where tenant_id = $1", [
          tenant,
        ]);
      } finally {
        await dueno.query("rollback");
      }
    });
  });

  describe("restricciones y tipos", () => {
    it("toda restricción de las tablas de un módulo tiene su traducción declarada, y no sobra ninguna", async () => {
      const restricciones = await filas<{ nombre: string }>(
        `select conname as nombre from pg_constraint
         where conrelid = any(array['public.tenant','public.empresa','public.sucursal']::regclass[])
           and contype in ('p', 'u', 'c', 'f', 'x')
         union
         select indexname as nombre from pg_indexes
         where schemaname = 'public' and tablename in ('tenant', 'empresa', 'sucursal')
           and indexdef like 'CREATE UNIQUE INDEX%' and indexname not like '%pkey' and indexname not like '%_key'`,
      );
      const declaradas = new Set([
        ...Object.keys(ERRORES_DE_TENANT_POR_RESTRICCION),
        ...Object.keys(ERRORES_DE_EMPRESAS_POR_RESTRICCION),
      ]);
      const existentes = new Set(restricciones.map((r) => r.nombre));
      const sinTraduccion = [...existentes].filter((n) => !declaradas.has(n)).sort();
      expect(sinTraduccion, "restricciones sin traducción declarada").toEqual([]);
      const sobrantes = [...declaradas].filter(
        (n) => !existentes.has(n) && !RESTRICCIONES_DE_DISPARADORES.includes(n),
      );
      expect(sobrantes, "traducciones de restricciones que no existen").toEqual([]);
    });

    // Una restricción única que NO incluye `empresa_id` deja que un cliente detecte, por el error de
    // duplicado (o por un `ON CONFLICT DO NOTHING` que no inserta nada), que un valor existe en OTRO
    // cliente. Se exceptúan las columnas que el cliente no elige (identidad o valor por defecto: ids
    // generados por la base). La unicidad global es una decisión de negocio explícita (por ejemplo el
    // CUIT), y vive en tablas que no tienen `empresa_id`.
    const unicasSinEmpresa = async (cliente: pg.Client) =>
      (
        await cliente.query<{ tabla: string; indice: string }>(
          `select c.relname as tabla, ic.relname as indice
           from pg_index i
           join pg_class c on c.oid = i.indrelid
           join pg_class ic on ic.oid = i.indexrelid
           join pg_namespace n on n.oid = c.relnamespace
           join pg_attribute e on e.attrelid = c.oid and e.attname = 'empresa_id' and not e.attisdropped
           where n.nspname = 'public' and i.indisunique
             and not (e.attnum = any (i.indkey::int2[]))
             and exists (
               select 1
               from unnest(i.indkey::int2[]) as k(attnum)
               join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
               where a.attidentity = ''
                 and not exists (select 1 from pg_attrdef d where d.adrelid = c.oid and d.adnum = a.attnum)
             )
           order by 1, 2`,
        )
      ).rows;

    it("toda restricción única de una tabla con empresa_id la incluye (nada de detectar datos de otro cliente), salvo las excepciones explícitas emisor_cuit_uk y referencia_de_error_referencia_uk", async () => {
      expect(await unicasSinEmpresa(dueno)).toEqual([
        { tabla: "emisor", indice: "emisor_cuit_uk" }, // el CUIT del secundario es único en toda la instalación
        // La referencia de error la sortea el servidor y quien la escribe no puede leer la tabla (0007, P5).
        { tabla: "referencia_de_error", indice: "referencia_de_error_referencia_uk" },
      ]);
    });

    it("la premisa de referencia_de_error_referencia_uk: solo la plataforma lee la tabla, así que un choque de referencias no deja ver nada de otra empresa", async () => {
      const leen = await filas<{ grantee: string }>(
        `select distinct grantee from information_schema.column_privileges
         where table_schema = 'public' and table_name = 'referencia_de_error' and privilege_type = 'SELECT'
           and (grantee = any($1) or grantee = 'PUBLIC' or grantee in ('zuluhub_autenticacion', 'zuluhub_publico'))
         order by 1`,
        [[...ROLES]],
      );
      expect(leen).toEqual([{ grantee: "zuluhub_plataforma" }]);
    });

    it("la premisa de emisor_cuit_uk: solo la plataforma escribe emisor.cuit (si el cliente lo escribiera, el error de duplicado le mostraría los CUIT ajenos)", async () => {
      const escriben = await filas<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.column_privileges
         where table_schema = 'public' and table_name = 'emisor' and column_name = 'cuit'
           and privilege_type in ('INSERT', 'UPDATE')
           and (grantee = any($1) or grantee = 'PUBLIC' or grantee = 'zuluhub_autenticacion')
         order by 1, 2`,
        [[...ROLES]],
      );
      expect(escriben).toEqual([
        { grantee: "zuluhub_plataforma", privilege_type: "INSERT" },
        { grantee: "zuluhub_plataforma", privilege_type: "UPDATE" },
      ]);
    });

    it("el chequeo de unicidad muerde: detecta una única sin empresa_id y acepta las que corresponden", async () => {
      if (base === null) return;
      const aparte = await crearBaseAparte(base);
      const cliente = new pg.Client({ connectionString: aparte.base.dueno });
      await cliente.connect();
      try {
        await cliente.query(`create table producto_mala (
          id uuid primary key default gen_random_uuid(), empresa_id uuid not null, sku text not null,
          unique (sku))`);
        await cliente.query(`create table producto_buena (
          id uuid primary key default gen_random_uuid(), empresa_id uuid not null, sku text not null,
          unique (empresa_id, sku))`);
        await cliente.query(`create table producto_clave_propia (
          codigo text primary key, empresa_id uuid not null)`);
        await cliente.query(`create table producto_global (id uuid primary key, sku text unique)`);
        expect(await unicasSinEmpresa(cliente)).toEqual([
          { tabla: "emisor", indice: "emisor_cuit_uk" }, // la excepción explícita de 0006
          { tabla: "producto_clave_propia", indice: "producto_clave_propia_pkey" },
          { tabla: "producto_mala", indice: "producto_mala_sku_key" },
          { tabla: "referencia_de_error", indice: "referencia_de_error_referencia_uk" }, // la de 0007
        ]);
      } finally {
        await cliente.end();
        await aparte.destruir();
      }
    });

    it("las columnas de cada tabla coinciden con los tipos del módulo", async () => {
      const columnasDe = async (tabla: string) =>
        (
          await filas<{ column_name: string }>(
            `select column_name from information_schema.columns
             where table_schema = 'public' and table_name = $1 order by ordinal_position`,
            [tabla],
          )
        ).map((c) => c.column_name);
      expect(await columnasDe("tenant")).toEqual([...COLUMNAS_DE_TENANT]);
      expect(await columnasDe("empresa")).toEqual([...COLUMNAS_DE_EMPRESAS.empresa]);
      expect(await columnasDe("sucursal")).toEqual([...COLUMNAS_DE_EMPRESAS.sucursal]);
    });

    it("el CUIT se valida igual en SQL y en TypeScript (miles de casos al azar)", async () => {
      const candidatos = new Set<string>([
        "20123456786",
        "33693450239",
        "20123456787",
        "0000000000" + "0",
        "00000000060",
        "2012345678",
        "abcdefghijk",
        "",
      ]);
      while (candidatos.size < 3000) {
        let texto = "";
        const largo = randomInt(0, 10) === 0 ? randomInt(1, 14) : 11;
        for (let i = 0; i < largo; i++) texto += String(randomInt(0, 10));
        candidatos.add(texto);
      }
      // Entre los aleatorios casi ninguno es válido: se agregan válidos construidos a propósito.
      for (let i = 0; i < 500; i++) {
        let diez = "";
        for (let j = 0; j < 10; j++) diez += String(randomInt(0, 10));
        for (let d = 0; d <= 9; d++) candidatos.add(`${diez}${d}`);
      }
      const lista = [...candidatos];
      const { rows } = await dueno.query<{ texto: string; valido: boolean }>(
        `select t as texto, cuit_valido(t) as valido from unnest($1::text[]) as t`,
        [lista],
      );
      expect(rows).toHaveLength(lista.length);
      const distintos = rows.filter(
        (r) => r.valido !== (/^\d{11}$/.test(r.texto) && cuitDesdeTexto(r.texto).ok),
      );
      expect(distintos).toEqual([]);
      expect(rows.some((r) => r.valido)).toBe(true);
      expect(rows.some((r) => !r.valido)).toBe(true);
    });
  });

  describe("máquina de estados de la empresa", () => {
    const ESTADOS: readonly EstadoDeEmpresa[] = [
      "PROVISIONING",
      "ACTIVE",
      "SUSPENDED",
      "CANCELLED",
      "DELETING",
    ];

    it("la base permite exactamente las transiciones que el dominio permite", async () => {
      await dueno.query("begin");
      try {
        const { rows: t } = await dueno.query<{ id: string }>(
          "insert into tenant (nombre) values ('transiciones') returning id",
        );
        const tenant = t[0]?.id;
        let cuit = 30000000000;
        for (const desde of ESTADOS) {
          for (const hacia of ESTADOS) {
            if (desde === hacia) continue;
            const digitos = String(cuit++);
            const valido = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
              .map((d) => `${digitos.slice(0, 10)}${d}`)
              .find((c) => cuitDesdeTexto(c).ok);
            if (valido === undefined) continue;
            await dueno.query("savepoint s");
            const motivo = (e: string) =>
              e === "SUSPENDED" || e === "CANCELLED" ? "motivo" : null;
            const { rows } = await dueno.query<{ id: string }>(
              `insert into empresa (tenant_id, cuit, razon_social, estado, motivo_estado)
               values ($1, $2, 'transicion', $3, $4) returning id`,
              [tenant, valido, desde, motivo(desde)],
            );
            let permitida = true;
            try {
              await dueno.query(
                "update empresa set estado = $2, motivo_estado = $3 where id = $1",
                [rows[0]?.id, hacia, motivo(hacia)],
              );
            } catch (error) {
              expect(error).toMatchObject({
                code: "23514",
                constraint: "empresa_transicion_invalida",
              });
              permitida = false;
            }
            await dueno.query("rollback to savepoint s");
            expect(permitida, `${desde} → ${hacia}`).toBe(
              TRANSICIONES_DE_EMPRESA[desde].includes(hacia),
            );
          }
        }
      } finally {
        await dueno.query("rollback");
      }
    });
  });
});
