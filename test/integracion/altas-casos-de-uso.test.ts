import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearMarcasDeMail } from "../../src/adaptadores/postgres/marcas-de-mail";
import {
  crearTransacciones,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoDePlataforma, ContextoOperativo } from "../../src/contexto/contexto";
import { crearCasosDeUsoDeIdentidad } from "../../src/modulos/identidad/publico";
import {
  crearLecturaDeMarcaParaMail,
  type MarcasParaMailDb,
} from "../../src/modulos/marcas/publico";
import { crearAltaEnTransaccion } from "../../src/plataforma/casos-de-uso/alta-nucleo";
import type { CasosDeUsoDeAltas } from "../../src/plataforma/casos-de-uso/altas";
import { validarAlta } from "../../src/plataforma/dominio/alta";
import {
  empresaId,
  invitacionId,
  marcaComercialId,
  tenantId,
} from "../../src/primitivas/identificadores/marca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { MarcasDeMail } from "../../src/puertos/marcas";
import type { Tokens } from "../../src/puertos/tokens";
import { MODULOS_DE_PRUEBA } from "../utilidades/planes";
import { usuarioDePrueba } from "../utilidades/usuarios";
import { ADMIN_DE_PRUEBA, EMAIL_DE_ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import {
  DELTA_DE_UN_ALTA_CON_TENANT_NUEVO,
  SIN_CAMBIOS,
  SECRETO_DE_PRUEBA,
  altaEnTenant,
  altaNueva,
  comoAdminAhora,
  comoSoporteAhora,
  crearCasosDeAlta,
  crearEntornoDeAlta,
  crearMarcaLista,
  crearTenantConPlan,
  diferencia,
  huellaDelAlta,
  tokensDePrueba,
  type TxDeAltaDePrueba,
} from "./altas-apoyo";
import { crearBaseAparte, crearEntornoDePrueba, cuitAlAzar } from "./entorno";
import { emailAlAzar } from "./fixtures-identidad";
import {
  crearBorradorDePlan,
  crearDominio,
  crearMarca,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  publicarVersionDePlan,
} from "./marcas-apoyo";
import { adminInexistente, claveAlAzar, crearAdminDeBase } from "./plataforma-apoyo";
import { plataformaEn } from "./soporte-datos";

/**
 * El alta de empresa de plataforma (H5 P5 y M6) contra Postgres real: lo que deja, lo que decide, lo que
 * rechaza sin dejar nada, la autorización, la idempotencia y la historia que cuenta. La atomicidad con
 * fallas en cada paso está en `altas-atomicidad.test.ts` y la concurrencia en `altas-concurrencia.test.ts`.
 * Base propia.
 */

const base = inject("baseDePruebas");

/** El contexto con el que corre el manejador del trabajo del mail: la empresa del trabajo, sin persona ni puerta. */
const contextoDelSistemaDe = (empresa: string): ContextoOperativo => ({
  tipo: "OPERATIVO",
  empresaId: empresaId(empresa),
  personaId: null,
  marcaDeEntrada: null,
  ahora: new Date(),
});

function exito<T>(r: Resultado<T, unknown>): T {
  if (!r.ok) throw new Error(`tenía que salir bien: ${JSON.stringify(r.error)}`);
  return r.valor;
}
const falla = <T>(r: Resultado<T, unknown>) => {
  if (r.ok) throw new Error("tenía que fallar");
  return r.error;
};

describe.skipIf(base === null)("alta de empresa: casos de uso contra Postgres", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeAltaDePrueba>;
  let entornoGeneral: ReturnType<typeof crearEntornoDePrueba>;
  let tokens: Tokens;
  let casos: CasosDeUsoDeAltas;
  let entornoDeMail: TransaccionesDePostgres<Readonly<{ mails: MarcasDeMail }>>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeAlta(propia.base, 6);
    entornoGeneral = crearEntornoDePrueba(propia.base, 3);
    entornoDeMail = crearTransacciones<Readonly<{ mails: MarcasDeMail }>>({
      urls: { OPERATIVO: propia.base.app },
      clave: propia.base.clave,
      armar: (db) => ({
        mails: crearMarcasDeMail(crearLecturaDeMarcaParaMail(db.withTables<MarcasParaMailDb>()), {
          nombre: "Respaldo del entorno",
          urlBase: "https://respaldo.ejemplo.test",
        }),
      }),
      maximoDeConexiones: 2,
    });
    tokens = tokensDePrueba();
    casos = crearCasosDeAlta(entorno, tokens);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoGeneral.cerrar();
    await entornoDeMail.cerrar();
    await propia.destruir();
  });

  const una = <T extends Record<string, unknown>>(texto: string, parametros: unknown[] = []) =>
    dueno.query<T>(texto, parametros).then((r) => r.rows[0] as T);
  const todas = <T extends Record<string, unknown>>(texto: string, parametros: unknown[] = []) =>
    dueno.query<T>(texto, parametros).then((r) => r.rows);

  describe("un tenant nuevo con su marca", () => {
    it("deja el tenant con su marca, la empresa en alta con su sucursal, el plan, la invitación al gerente y el trabajo del mail", async () => {
      const m = await crearMarcaLista(dueno);
      const entrada = altaNueva(m.marca, {
        nombreDeTenant: "  Panadería López ",
        razonSocial: " López Hnos. S.R.L. ",
        emailGerente: " Gerente@Lopez.COM ",
      });
      const antes = await huellaDelAlta(dueno);
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), entrada));
      expect(alta.yaExistia).toBe(false);
      expect(Object.keys(alta).sort()).toEqual([
        "empresaId",
        "invitacionId",
        "tenantId",
        "yaExistia",
      ]);
      expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual(
        DELTA_DE_UN_ALTA_CON_TENANT_NUEVO,
      );

      // El tenant: SU marca, el nombre recortado, activo.
      expect(
        await una("select nombre, estado, marca_id from tenant where id = $1", [alta.tenantId]),
      ).toEqual({
        nombre: "Panadería López",
        estado: "ACTIVE",
        marca_id: m.marca,
      });
      // La empresa: en alta (todavía no opera), con el CUIT normalizado, la razón social recortada, la zona.
      const empresa = await una<{
        tenant_id: string;
        cuit: string;
        razon_social: string;
        estado: string;
        zona_horaria: string;
        moneda: string;
      }>(
        "select tenant_id, cuit, razon_social, estado, zona_horaria, moneda from empresa where id = $1",
        [alta.empresaId],
      );
      expect(empresa).toEqual({
        tenant_id: alta.tenantId,
        cuit: entrada.cuit.replaceAll("-", ""),
        razon_social: "López Hnos. S.R.L.",
        estado: "PROVISIONING",
        zona_horaria: "America/Argentina/Buenos_Aires",
        moneda: "ARS",
      });
      // La sucursal inicial.
      expect(
        await todas("select nombre, activa from sucursal where empresa_id = $1", [alta.empresaId]),
      ).toEqual([{ nombre: "Casa central", activa: true }]);
      // El plan: la versión por defecto de la marca, asignación número 1, origen ALTA, con el actor firmado.
      expect(
        await todas(
          "select numero, version_de_plan_id, origen, asignado_por, motivo from plan_de_tenant where tenant_id = $1",
          [alta.tenantId],
        ),
      ).toEqual([
        {
          numero: 1,
          version_de_plan_id: m.version,
          origen: "ALTA",
          asignado_por: ADMIN_DE_PRUEBA,
          motivo: "Alta del tenant",
        },
      ]);
      // La invitación: del tipo alta, al email normalizado, pendiente, a 24 horas, sin emisor, de ese tenant
      // y de esa empresa como GERENTE; guarda el hash del token y nunca el token.
      const invitacion = await una<{
        id: string;
        tenant_id: string;
        tipo: string;
        email: string;
        estado: string;
        token_hash: string;
        emitida_por: string | null;
        vence_en: Date;
        emitida_en: Date;
      }>(
        "select id, tenant_id, tipo, email, estado, token_hash, emitida_por, vence_en, emitida_en from invitacion where id = $1",
        [alta.invitacionId],
      );
      expect(invitacion).toMatchObject({
        id: alta.invitacionId,
        tenant_id: alta.tenantId,
        tipo: "ALTA_GERENTE",
        email: "gerente@lopez.com",
        estado: "PENDIENTE",
        emitida_por: null,
      });
      expect(invitacion.vence_en.getTime() - invitacion.emitida_en.getTime()).toBe(24 * 3_600_000);
      expect(invitacion.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(
        await todas(
          "select empresa_id, rol, tipo, estado from invitacion_empresa where invitacion_id = $1",
          [alta.invitacionId],
        ),
      ).toEqual([
        { empresa_id: alta.empresaId, rol: "GERENTE", tipo: "ALTA_GERENTE", estado: "PENDIENTE" },
      ]);
      // El trabajo que envía el mail: de esa empresa, pendiente, con solo el id de la invitación.
      expect(
        await todas(
          "select tipo, estado, datos, clave_idempotencia, empresa_id from trabajo where empresa_id = $1",
          [alta.empresaId],
        ),
      ).toEqual([
        {
          tipo: "enviar_invitacion",
          estado: "PENDIENTE",
          datos: { invitacionId: alta.invitacionId },
          clave_idempotencia: `invitacion:${alta.invitacionId}:envio`,
          empresa_id: alta.empresaId,
        },
      ]);
    });

    it("el token de la invitación se recalcula del secreto y su hash es el que quedó guardado; el token no queda en ningún lado", async () => {
      const m = await crearMarcaLista(dueno);
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca)));
      const { createHmac } = await import("node:crypto");
      const token = createHmac("sha256", SECRETO_DE_PRUEBA)
        .update(`invitacion/v1/${alta.invitacionId}`, "utf8")
        .digest("base64url");
      const hash = createHash("sha256").update(token, "utf8").digest("hex");
      expect(
        (
          await una<{ token_hash: string }>("select token_hash from invitacion where id = $1", [
            alta.invitacionId,
          ])
        ).token_hash,
      ).toBe(hash);
      // Ni el token ni su hash aparecen en el trabajo, la idempotencia ni las auditorías.
      for (const consulta of [
        "select datos::text as t from trabajo where empresa_id = $1",
        "select despues::text as t from auditoria_empresa where empresa_id = $1",
      ]) {
        for (const fila of await todas<{ t: string }>(consulta, [alta.empresaId])) {
          expect(fila.t).not.toContain(token);
          expect(fila.t).not.toContain(hash);
        }
      }
      for (const fila of await todas<{ t: string }>(
        "select despues::text as t from auditoria_plataforma where entidad_id in ($1, $2)",
        [alta.empresaId, alta.tenantId],
      )) {
        expect(fila.t).not.toContain(token);
        expect(fila.t).not.toContain(hash);
      }
      const clave = await una<{ resultado: unknown }>(
        "select resultado from idempotencia_plataforma order by creado_en desc limit 1",
      );
      expect(JSON.stringify(clave.resultado)).not.toContain(token);
    });

    it("la empresa NO queda activa: sigue en alta hasta que el gerente acepte la invitación", async () => {
      const m = await crearMarcaLista(dueno);
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca)));
      expect(
        (
          await una<{ estado: string }>("select estado from empresa where id = $1", [
            alta.empresaId,
          ])
        ).estado,
      ).toBe("PROVISIONING");
      expect(
        (
          await una<{ estado: string }>("select estado from invitacion where id = $1", [
            alta.invitacionId,
          ])
        ).estado,
      ).toBe("PENDIENTE");
    });
  });

  describe("el plan y los módulos con los que nace", () => {
    it("sin plan elegido recibe la ÚLTIMA versión publicada del plan por defecto de la marca (no un borrador)", async () => {
      const m = await crearMarcaLista(dueno);
      // Una segunda versión publicada y un borrador posterior: rige la publicada de mayor número.
      const v2 = await crearBorradorDePlan(dueno, m.plan, { modulos: [] });
      await publicarVersionDePlan(dueno, v2);
      await crearBorradorDePlan(dueno, m.plan, { modulos: [] });
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca)));
      expect(
        await todas("select version_de_plan_id from plan_de_tenant where tenant_id = $1", [
          alta.tenantId,
        ]),
      ).toEqual([{ version_de_plan_id: v2 }]);
    });

    it("con una versión de plan elegida, recibe esa (de cualquier plan publicado), no la de la marca", async () => {
      const m = await crearMarcaLista(dueno);
      const otro = await crearPlanPublicado(dueno);
      const alta = exito(
        await casos.altaDeEmpresa(
          comoAdminAhora(),
          altaNueva(m.marca, { versionDePlanId: otro.version }),
        ),
      );
      expect(
        await todas("select version_de_plan_id, origen from plan_de_tenant where tenant_id = $1", [
          alta.tenantId,
        ]),
      ).toEqual([{ version_de_plan_id: otro.version, origen: "ALTA" }]);
    });

    it("los módulos iniciales de la marca que el plan incluye quedan activos; los que no, se omiten y la constancia lo dice", async () => {
      const m = await crearMarcaLista(dueno, {
        modulosIniciales: ["caja", "ventas", "reservas", "comandas", "inventado"],
        // `reservas` queda fuera del techo; `comandas` está en desarrollo; `inventado` no existe.
        modulosDelPlan: ["caja", "ventas", "comandas"],
      });
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca)));
      expect(
        await todas(
          "select modulo, activo from modulo_de_empresa where empresa_id = $1 order by modulo",
          [alta.empresaId],
        ),
      ).toEqual([
        { modulo: "caja", activo: true },
        { modulo: "ventas", activo: true },
      ]);
      const constancia = await una<{ despues: Record<string, unknown> }>(
        "select despues from auditoria_plataforma where accion = 'EMPRESA_ALTA' and entidad_id = $1",
        [alta.empresaId],
      );
      expect(constancia.despues["modulosActivados"]).toEqual(["caja", "ventas"]);
      expect(constancia.despues["modulosOmitidos"]).toEqual([
        { modulo: "reservas", motivo: "MODULO_FUERA_DEL_PLAN" },
        { modulo: "comandas", motivo: "MODULO_EN_DESARROLLO" },
        { modulo: "inventado", motivo: "MODULO_DESCONOCIDO" },
      ]);
      // Cada módulo activado deja su constancia en la historia de la empresa.
      expect(
        await todas(
          "select accion, entidad_id from auditoria_empresa where empresa_id = $1 and accion = 'MODULO_ACTIVADO' order by entidad_id",
          [alta.empresaId],
        ),
      ).toEqual([
        { accion: "MODULO_ACTIVADO", entidad_id: "caja" },
        { accion: "MODULO_ACTIVADO", entidad_id: "ventas" },
      ]);
    });

    it("un módulo cuyo requerido no entra (por el plan) no se activa: respeta `requiere`", async () => {
      const m = await crearMarcaLista(dueno, {
        modulosIniciales: ["ventas"],
        modulosDelPlan: ["ventas"],
      });
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca)));
      expect(
        await todas("select modulo from modulo_de_empresa where empresa_id = $1", [alta.empresaId]),
      ).toEqual([]);
      const constancia = await una<{ despues: Record<string, unknown> }>(
        "select despues from auditoria_plataforma where accion = 'EMPRESA_ALTA' and entidad_id = $1",
        [alta.empresaId],
      );
      expect(constancia.despues["modulosOmitidos"]).toEqual([
        { modulo: "ventas", motivo: "REQUIERE_INACTIVO" },
      ]);
    });

    it("un producto sin módulos propios hereda los de su marca padre", async () => {
      const principal = await crearMarcaLista(dueno, {
        modulosIniciales: ["caja"],
        modulosDelPlan: ["caja"],
      });
      const producto = await crearMarca(dueno, { padre: principal.marca });
      await crearVersionDeMarcaConfirmada(dueno, producto, {
        nombreVisible: "Producto",
        modulosIniciales: null,
      });
      await crearDominio(dueno, producto, { canonico: true });
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(producto)));
      expect(
        await todas("select modulo from modulo_de_empresa where empresa_id = $1", [alta.empresaId]),
      ).toEqual([{ modulo: "caja" }]);
      expect(
        await todas("select version_de_plan_id from plan_de_tenant where tenant_id = $1", [
          alta.tenantId,
        ]),
      ).toEqual([{ version_de_plan_id: principal.version }]);
    });
  });

  describe("lo que se rechaza no deja NADA (ni tenant, ni clave, ni constancia)", () => {
    type EntradaPreparada = Parameters<CasosDeUsoDeAltas["altaDeEmpresa"]>[1];
    type Rechazo = readonly [
      nombre: string,
      preparar: () => EntradaPreparada | Promise<EntradaPreparada>,
      error: unknown,
    ];
    const hexa = "0a1b2c3d-0000-4000-8000-0000000000ff";
    const rechazos: readonly Rechazo[] = [
      ["una marca que no existe", () => altaNueva(hexa), "MARCA_NO_ENCONTRADA"],
      [
        "una marca retirada",
        async () => {
          const m = await crearMarcaLista(dueno);
          await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [m.marca]);
          return altaNueva(m.marca);
        },
        "MARCA_RETIRADA",
      ],
      [
        "una marca sin versión confirmada",
        async () => altaNueva((await crearMarcaLista(dueno, { sinVersion: true })).marca),
        "MARCA_SIN_DEFINICION",
      ],
      [
        "una marca sin dominio canónico",
        async () => altaNueva((await crearMarcaLista(dueno, { sinDominio: true })).marca),
        "MARCA_SIN_DOMINIO",
      ],
      [
        "una marca cuyo plan por defecto está retirado",
        async () => {
          const m = await crearMarcaLista(dueno);
          await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [m.plan]);
          return altaNueva(m.marca);
        },
        "MARCA_SIN_PLAN_POR_DEFECTO",
      ],
      [
        "una versión de plan que no existe",
        async () => altaNueva((await crearMarcaLista(dueno)).marca, { versionDePlanId: hexa }),
        "VERSION_DE_PLAN_NO_ENCONTRADA",
      ],
      [
        "un borrador de plan",
        async () => {
          const m = await crearMarcaLista(dueno);
          const borrador = await crearBorradorDePlan(dueno, m.plan);
          return altaNueva(m.marca, { versionDePlanId: borrador });
        },
        "VERSION_DE_PLAN_NO_PUBLICADA",
      ],
      [
        "un plan retirado, elegido a mano",
        async () => {
          const m = await crearMarcaLista(dueno);
          const otro = await crearPlanPublicado(dueno);
          await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [otro.plan]);
          return altaNueva(m.marca, { versionDePlanId: otro.version });
        },
        "PLAN_RETIRADO",
      ],
      [
        "un CUIT con el dígito verificador mal",
        async () => altaNueva((await crearMarcaLista(dueno)).marca, { cuit: "30-70308853-5" }),
        "CUIT_DIGITO_VERIFICADOR_INVALIDO",
      ],
      [
        "un email inválido",
        async () => altaNueva((await crearMarcaLista(dueno)).marca, { emailGerente: "sin-arroba" }),
        "EMAIL_INVALIDO",
      ],
      [
        "una zona horaria que no existe",
        async () =>
          altaNueva((await crearMarcaLista(dueno)).marca, { zonaHoraria: "Marte/Olympus" }),
        "ZONA_HORARIA_INVALIDA",
      ],
      [
        "una moneda que no es pesos",
        async () => altaNueva((await crearMarcaLista(dueno)).marca, { moneda: "USD" }),
        "MONEDA_NO_SOPORTADA",
      ],
      [
        "un tenant y un nombre a la vez",
        async () => ({ ...altaNueva((await crearMarcaLista(dueno)).marca), tenantId: hexa }),
        "TENANT_AMBIGUO",
      ],
      [
        "un tenant nuevo sin marca",
        () => ({ ...altaNueva(hexa), marcaId: undefined }),
        "MARCA_INDEFINIDA",
      ],
      [
        "el email de un administrador de plataforma",
        async () =>
          altaNueva((await crearMarcaLista(dueno)).marca, {
            emailGerente: `  ${EMAIL_DE_ADMIN_DE_PRUEBA.toUpperCase()} `,
          }),
        "EMAIL_DE_ADMIN_PLATAFORMA",
      ],
      [
        "un CUIT que ya tiene otra empresa (de otro tenant)",
        async () => {
          const m = await crearMarcaLista(dueno);
          const previa = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca)));
          const cuit = (
            await una<{ cuit: string }>("select cuit from empresa where id = $1", [
              previa.empresaId,
            ])
          ).cuit;
          return altaNueva(m.marca, { cuit });
        },
        "CUIT_DUPLICADO",
      ],
    ];

    it.each(rechazos)("%s", async (_nombre, preparar, errorEsperado) => {
      const entrada = await preparar();
      const antes = await huellaDelAlta(dueno);
      expect(falla(await casos.altaDeEmpresa(comoAdminAhora(), entrada))).toEqual(errorEsperado);
      expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual(SIN_CAMBIOS);
    });

    it("un rechazo no se guarda como resultado: corregir el dato y repetir con la MISMA clave sí crea", async () => {
      const m = await crearMarcaLista(dueno);
      const clave = claveAlAzar();
      const mal = altaNueva(m.marca, { claveDeIdempotencia: clave, zonaHoraria: "Marte/Olympus" });
      expect(falla(await casos.altaDeEmpresa(comoAdminAhora(), mal))).toBe("ZONA_HORARIA_INVALIDA");
      const bien = { ...mal, zonaHoraria: "America/Argentina/Buenos_Aires" };
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), bien));
      expect(alta.yaExistia).toBe(false);
    });
  });

  describe("la marca principal", () => {
    it("puede dar de alta sin dominio canónico (el mail cae en el respaldo del entorno), pero no sin versión confirmada", async () => {
      const principal = await crearMarcaLista(dueno, { principal: true, sinDominio: true });
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(principal.marca)));
      expect(
        (
          await una<{ marca_id: string }>("select marca_id from tenant where id = $1", [
            alta.tenantId,
          ])
        ).marca_id,
      ).toBe(principal.marca);
    });
  });

  describe("una empresa más en un tenant que ya existe", () => {
    it("la suma al tenant con SU marca, sin tocar su plan: no hay asignación nueva ni constancia de tenant", async () => {
      const m = await crearMarcaLista(dueno);
      const mundo = await crearTenantConPlan(dueno, m, { empresasPorTenant: "2" });
      const antes = await huellaDelAlta(dueno);
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant)));
      expect(alta.tenantId).toBe(mundo.tenant);
      expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual({
        ...DELTA_DE_UN_ALTA_CON_TENANT_NUEVO,
        tenants: 0,
        asignaciones: 0,
        // Solo EMPRESA_ALTA (no hubo plan que asignar).
        auditoriaDeEmpresa: 1,
        // Solo EMPRESA_ALTA (el tenant ya existía).
        auditoriaDePlataforma: 1,
      });
      expect(
        await todas("select estado, tenant_id from empresa where id = $1", [alta.empresaId]),
      ).toEqual([{ estado: "PROVISIONING", tenant_id: mundo.tenant }]);
    });

    it("no se le pasa marca ni plan: se rechaza antes de tocar nada", async () => {
      const m = await crearMarcaLista(dueno);
      const mundo = await crearTenantConPlan(dueno, m, { empresasPorTenant: "2" });
      expect(
        falla(
          await casos.altaDeEmpresa(comoAdminAhora(), {
            ...altaEnTenant(mundo.tenant),
            marcaId: m.marca,
          }),
        ),
      ).toBe("MARCA_SOLO_CON_TENANT_NUEVO");
      expect(
        falla(
          await casos.altaDeEmpresa(comoAdminAhora(), {
            ...altaEnTenant(mundo.tenant),
            versionDePlanId: m.version,
          }),
        ),
      ).toBe("PLAN_SOLO_CON_TENANT_NUEVO");
    });

    it("un tenant que no existe es TENANT_NO_ENCONTRADO y uno suspendido, TENANT_NO_ACTIVO", async () => {
      const m = await crearMarcaLista(dueno);
      const suspendido = await crearTenantConPlan(dueno, m, { estado: "SUSPENDED" });
      const antes = await huellaDelAlta(dueno);
      expect(
        falla(
          await casos.altaDeEmpresa(
            comoAdminAhora(),
            altaEnTenant("0a1b2c3d-0000-4000-8000-0000000000ee"),
          ),
        ),
      ).toBe("TENANT_NO_ENCONTRADO");
      expect(
        falla(await casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(suspendido.tenant))),
      ).toBe("TENANT_NO_ACTIVO");
      expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual(SIN_CAMBIOS);
    });

    it("el email de un administrador no puede ser gerente tampoco en un tenant que ya existe", async () => {
      const m = await crearMarcaLista(dueno);
      const mundo = await crearTenantConPlan(dueno, m, { empresasPorTenant: "5" });
      expect(
        falla(
          await casos.altaDeEmpresa(
            comoAdminAhora(),
            altaEnTenant(mundo.tenant, { emailGerente: EMAIL_DE_ADMIN_DE_PRUEBA }),
          ),
        ),
      ).toBe("EMAIL_DE_ADMIN_PLATAFORMA");
    });

    it("un administrador dado de baja ya no lo impide: su email puede ser gerente", async () => {
      const m = await crearMarcaLista(dueno);
      const baja = await crearAdminDeBase(dueno, { activo: false });
      exito(
        await casos.altaDeEmpresa(
          comoAdminAhora(),
          altaNueva(m.marca, { emailGerente: baja.email }),
        ),
      );
    });
  });

  describe("el tope de empresas del tenant (perilla `empresas_por_tenant`)", () => {
    it("con la base del catálogo (1) y una empresa ya, la segunda es LIMITE_DEL_PLAN con el límite y el uso, y no deja nada", async () => {
      const m = await crearMarcaLista(dueno);
      const mundo = await crearTenantConPlan(dueno, m);
      const antes = await huellaDelAlta(dueno);
      expect(
        falla(await casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant))),
      ).toEqual({
        codigo: "LIMITE_DEL_PLAN",
        perilla: "empresas_por_tenant",
        limite: 1,
        usoActual: 1,
      });
      expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual(SIN_CAMBIOS);
    });

    it("con el plan que lo sube, entra hasta el tope y no pasa de ahí", async () => {
      const m = await crearMarcaLista(dueno, {
        perillasDelPlan: { empresas_por_tenant: { tipo: "LIMITE", limite: 3 } },
      });
      const mundo = await crearTenantConPlan(dueno, m);
      exito(await casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant)));
      exito(await casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant)));
      expect(
        falla(await casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant))),
      ).toMatchObject({
        codigo: "LIMITE_DEL_PLAN",
        limite: 3,
        usoActual: 3,
      });
    });

    it("un ajuste del cliente le gana al plan; ILIMITADO no tiene tope", async () => {
      const m = await crearMarcaLista(dueno);
      const mundo = await crearTenantConPlan(dueno, m, { empresasPorTenant: "ILIMITADO" });
      for (let i = 0; i < 3; i++) {
        exito(await casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant)));
      }
    });

    it("una empresa cancelada no ocupa lugar; una en alta (PROVISIONING) o suspendida, sí", async () => {
      const m = await crearMarcaLista(dueno);
      const mundo = await crearTenantConPlan(dueno, m, { empresasPorTenant: "2" });
      // Una cancelada y una activa: hay lugar para una más.
      const cancelada = exito(
        await casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant)),
      );
      await dueno.query(
        "update empresa set estado = 'CANCELLED', motivo_estado = 'prueba' where id = $1",
        [cancelada.empresaId],
      );
      const nueva = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant)));
      // Ahora la activa y la nueva (en alta) ocupan los dos lugares.
      expect(
        falla(await casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant))),
      ).toMatchObject({
        codigo: "LIMITE_DEL_PLAN",
        usoActual: 2,
      });
      await dueno.query("update empresa set estado = 'ACTIVE' where id = $1", [nueva.empresaId]);
      await dueno.query(
        "update empresa set estado = 'SUSPENDED', motivo_estado = 'mora' where id = $1",
        [nueva.empresaId],
      );
      expect(
        falla(await casos.altaDeEmpresa(comoAdminAhora(), altaEnTenant(mundo.tenant))),
      ).toMatchObject({
        codigo: "LIMITE_DEL_PLAN",
        usoActual: 2,
      });
    });

    it("un tenant nuevo con un plan que fija el tope en 0 no puede ni empezar (y no deja el tenant)", async () => {
      const m = await crearMarcaLista(dueno, {
        perillasDelPlan: { empresas_por_tenant: { tipo: "LIMITE", limite: 0 } },
      });
      const antes = await huellaDelAlta(dueno);
      expect(falla(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca)))).toMatchObject({
        codigo: "LIMITE_DEL_PLAN",
        limite: 0,
        usoActual: 0,
      });
      expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual(SIN_CAMBIOS);
    });
  });

  describe("quién puede dar de alta", () => {
    it("SOPORTE, un administrador dado de baja, uno inexistente y el sistema reciben SIN_PERMISO y no dejan nada", async () => {
      const m = await crearMarcaLista(dueno);
      const baja = await crearAdminDeBase(dueno, { activo: false });
      const antes = await huellaDelAlta(dueno);
      for (const contexto of [
        comoSoporteAhora(),
        plataformaEn(new Date(), { tipo: "ADMIN", id: baja.id }),
        plataformaEn(new Date(), { tipo: "ADMIN", id: adminInexistente() }),
        plataformaEn(new Date(), { tipo: "SISTEMA", proceso: "barrido-de-altas" }),
      ]) {
        expect(falla(await casos.altaDeEmpresa(contexto, altaNueva(m.marca)))).toBe("SIN_PERMISO");
      }
      expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual(SIN_CAMBIOS);
    });

    it("el rechazo del guard gana sobre una entrada inválida y sobre una clave mal formada", async () => {
      expect(
        falla(
          await casos.altaDeEmpresa(comoSoporteAhora(), {
            claveDeIdempotencia: "corta",
            cuit: "x",
            razonSocial: "",
            zonaHoraria: "",
            moneda: "",
            emailGerente: "",
          }),
        ),
      ).toBe("SIN_PERMISO");
    });

    it("la base es la segunda barrera: aunque el guard se saltara, SOPORTE no puede crear tenant, empresa ni plan", async () => {
      const m = await crearMarcaLista(dueno);
      const antes = await huellaDelAlta(dueno);
      // Una transacción de SOPORTE que llama al núcleo directo, sin el guard.
      const r = await entorno.ejecutar({ contexto: comoSoporteAhora() }, async (tx) => {
        const alta = validarAlta(altaNueva(m.marca));
        if (!alta.ok) throw new Error("la entrada de la prueba es válida");
        const emitida = tokensDePrueba().emitir();
        return crearAltaEnTransaccion(tx, {
          contexto: comoSoporteAhora(),
          catalogoDeModulos: MODULOS_DE_PRUEBA,
          alta: alta.valor,
          invitacion: { invitacionId: emitida.invitacionId, tokenHash: emitida.tokenHash },
        });
      });
      expect(falla(r)).toMatchObject({ tipo: "AccesoDenegado" });
      expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual(SIN_CAMBIOS);
    });

    it("un contexto que no es de plataforma ni compila ni pasa: lanza antes de abrir una transacción", async () => {
      await expect(
        casos.altaDeEmpresa(
          { tipo: "TRABAJOS", ahora: new Date() } as unknown as ContextoDePlataforma,
          altaNueva("x"),
        ),
      ).rejects.toThrow(RangeError);
    });
  });

  describe("repetir el pedido (idempotencia)", () => {
    it("la misma clave con los mismos datos devuelve lo mismo (yaExistia) y no crea, encola ni audita nada más", async () => {
      const m = await crearMarcaLista(dueno, {
        modulosIniciales: ["caja"],
        modulosDelPlan: ["caja"],
      });
      const entrada = altaNueva(m.marca);
      const primera = exito(await casos.altaDeEmpresa(comoAdminAhora(), entrada));
      const despuesDeLaPrimera = await huellaDelAlta(dueno);
      const segunda = exito(await casos.altaDeEmpresa(comoAdminAhora(), entrada));
      const tercera = exito(await casos.altaDeEmpresa(comoAdminAhora(), entrada));
      expect(primera.yaExistia).toBe(false);
      expect(segunda).toEqual({ ...primera, yaExistia: true });
      expect(tercera).toEqual(segunda);
      expect(diferencia(despuesDeLaPrimera, await huellaDelAlta(dueno))).toEqual(SIN_CAMBIOS);
      // Una sola invitación, un solo trabajo de mail.
      expect(
        await una("select count(*)::int as n from trabajo where empresa_id = $1", [
          primera.empresaId,
        ]),
      ).toEqual({ n: 1 });
    });

    it("los mismos datos escritos de otra forma (CUIT con guiones, email en mayúsculas, espacios) son el mismo pedido", async () => {
      const m = await crearMarcaLista(dueno);
      const cuit = cuitAlAzar();
      const entrada = altaNueva(m.marca, {
        cuit,
        emailGerente: "g@acme.com",
        nombreDeTenant: "ACME",
      });
      const primera = exito(await casos.altaDeEmpresa(comoAdminAhora(), entrada));
      const igual = exito(
        await casos.altaDeEmpresa(comoAdminAhora(), {
          ...entrada,
          cuit: `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`,
          emailGerente: "  G@ACME.com ",
          nombreDeTenant: "  ACME  ",
        }),
      );
      expect(igual).toEqual({ ...primera, yaExistia: true });
    });

    it.each([
      ["otro CUIT", { cuit: cuitAlAzar() }],
      ["otro email del gerente", { emailGerente: "otro@gerente.test" }],
      ["otra razón social", { razonSocial: "Otra S.A." }],
      ["otra zona horaria", { zonaHoraria: "America/Argentina/Cordoba" }],
      ["otro nombre de tenant", { nombreDeTenant: "Otro nombre" }],
    ])("la misma clave con %s es CLAVE_REUTILIZADA y no crea nada", async (_c, cambio) => {
      const m = await crearMarcaLista(dueno);
      const entrada = altaNueva(m.marca);
      exito(await casos.altaDeEmpresa(comoAdminAhora(), entrada));
      const antes = await huellaDelAlta(dueno);
      expect(falla(await casos.altaDeEmpresa(comoAdminAhora(), { ...entrada, ...cambio }))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(diferencia(antes, await huellaDelAlta(dueno))).toEqual(SIN_CAMBIOS);
    });

    it("la misma clave con otra marca o con otro plan es CLAVE_REUTILIZADA", async () => {
      const a = await crearMarcaLista(dueno);
      const b = await crearMarcaLista(dueno);
      const entrada = altaNueva(a.marca);
      exito(await casos.altaDeEmpresa(comoAdminAhora(), entrada));
      expect(
        falla(await casos.altaDeEmpresa(comoAdminAhora(), { ...entrada, marcaId: b.marca })),
      ).toBe("CLAVE_REUTILIZADA");
      expect(
        falla(
          await casos.altaDeEmpresa(comoAdminAhora(), { ...entrada, versionDePlanId: b.version }),
        ),
      ).toBe("CLAVE_REUTILIZADA");
    });

    it("la clave de otro administrador no choca: es por administrador", async () => {
      const m = await crearMarcaLista(dueno);
      const otro = await crearAdminDeBase(dueno);
      const clave = claveAlAzar();
      const uno = exito(
        await casos.altaDeEmpresa(
          comoAdminAhora(),
          altaNueva(m.marca, { claveDeIdempotencia: clave }),
        ),
      );
      const dos = exito(
        await casos.altaDeEmpresa(
          plataformaEn(new Date(), { tipo: "ADMIN", id: otro.id }),
          altaNueva(m.marca, { claveDeIdempotencia: clave }),
        ),
      );
      expect(dos.empresaId).not.toBe(uno.empresaId);
      expect(dos.yaExistia).toBe(false);
    });

    it("una clave con mala forma es CLAVE_DE_IDEMPOTENCIA_INVALIDA (corta, con espacios o con símbolos)", async () => {
      const m = await crearMarcaLista(dueno);
      for (const clave of [
        "",
        "corta",
        "x".repeat(129),
        "con espacios en la clave",
        "con:dos:puntos:0001",
      ]) {
        expect(
          falla(
            await casos.altaDeEmpresa(
              comoAdminAhora(),
              altaNueva(m.marca, { claveDeIdempotencia: clave }),
            ),
          ),
        ).toBe("CLAVE_DE_IDEMPOTENCIA_INVALIDA");
      }
    });

    it("la misma clave usada para otra operación de plataforma es CLAVE_REUTILIZADA (la operación forma parte de la huella)", async () => {
      const m = await crearMarcaLista(dueno);
      const clave = claveAlAzar();
      // Otra operación registra la clave con la misma entrada, a mano.
      await entorno.ejecutar({ contexto: comoAdminAhora() }, async (tx) => {
        await tx.idempotencia.registrar("dominios.agregar", clave, { host: "x" }, { ok: true });
        return { ok: true as const, valor: null };
      });
      expect(
        falla(
          await casos.altaDeEmpresa(
            comoAdminAhora(),
            altaNueva(m.marca, { claveDeIdempotencia: clave }),
          ),
        ),
      ).toBe("CLAVE_REUTILIZADA");
    });
  });

  describe("la historia: quién hizo qué", () => {
    it("deja la constancia de plataforma con el actor firmado y todo lo decidido, y la de la empresa sin actor", async () => {
      const m = await crearMarcaLista(dueno, {
        modulosIniciales: ["caja"],
        modulosDelPlan: ["caja"],
      });
      const otro = await crearAdminDeBase(dueno);
      const entrada = altaNueva(m.marca, {
        emailGerente: "Ger@Prueba.test",
        nombreDeTenant: "Mi cliente",
      });
      const alta = exito(
        await casos.altaDeEmpresa(
          plataformaEn(new Date(), { tipo: "ADMIN", id: otro.id }),
          entrada,
        ),
      );
      const tenant = await una<{ actor: string; antes: unknown; despues: Record<string, unknown> }>(
        "select actor, antes, despues from auditoria_plataforma where accion = 'TENANT_ALTA' and entidad_id = $1",
        [alta.tenantId],
      );
      expect(tenant).toEqual({
        actor: otro.id,
        antes: null,
        despues: { nombre: "Mi cliente", marcaId: m.marca, versionDePlanId: m.version },
      });
      const empresa = await una<{
        actor: string;
        entidad: string;
        despues: Record<string, unknown>;
      }>(
        "select actor, entidad, despues from auditoria_plataforma where accion = 'EMPRESA_ALTA' and entidad_id = $1",
        [alta.empresaId],
      );
      expect(empresa.actor).toBe(otro.id);
      expect(empresa.entidad).toBe("empresa");
      expect(empresa.despues).toEqual({
        tenantId: alta.tenantId,
        cuit: entrada.cuit.replaceAll("-", ""),
        razonSocial: entrada.razonSocial,
        zonaHoraria: "America/Argentina/Buenos_Aires",
        moneda: "ARS",
        emailGerente: "ger@prueba.test",
        invitacionId: alta.invitacionId,
        marcaId: m.marca,
        versionDePlanId: m.version,
        modulosActivados: ["caja"],
        modulosOmitidos: [],
      });
      // La historia de la empresa: nace, recibe plan y módulos; sin actor (el responsable queda en plataforma).
      const historia = await todas<{
        accion: string;
        entidad: string;
        entidad_id: string;
        actor_persona_id: string | null;
      }>(
        "select accion, entidad, entidad_id, actor_persona_id from auditoria_empresa where empresa_id = $1 order by id",
        [alta.empresaId],
      );
      expect(historia).toEqual([
        {
          accion: "EMPRESA_ALTA",
          entidad: "empresa",
          entidad_id: alta.empresaId,
          actor_persona_id: null,
        },
        {
          accion: "PLAN_ASIGNADO",
          entidad: "tenant",
          entidad_id: alta.tenantId,
          actor_persona_id: null,
        },
        {
          accion: "MODULO_ACTIVADO",
          entidad: "modulo",
          entidad_id: "caja",
          actor_persona_id: null,
        },
      ]);
    });

    it("ninguna constancia lleva campos con nombre de secreto (la red de seguridad del puerto no se dispara)", async () => {
      const m = await crearMarcaLista(dueno, {
        modulosIniciales: ["caja"],
        modulosDelPlan: ["caja"],
      });
      const alta = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(m.marca)));
      const nombres = /token|secret|clave|passw|contrase|credencial|hash|firma/i;
      for (const f of await todas<{ d: string }>(
        "select despues::text as d from auditoria_plataforma where entidad_id in ($1, $2) union all select despues::text from auditoria_empresa where empresa_id = $3",
        [alta.empresaId, alta.tenantId, alta.empresaId],
      )) {
        const claves = [...f.d.matchAll(/"([^"]+)":/g)].map((x) => x[1] ?? "");
        expect(claves.filter((k) => nombres.test(k))).toEqual([]);
      }
    });
  });

  describe("de punta a punta: la aceptación del gerente es lo que activa la empresa", () => {
    it("el gerente entra por la marca de su tenant: desde otra marca el enlace no existe; desde la suya activa la empresa", async () => {
      const a = await crearMarcaLista(dueno);
      const b = await crearMarcaLista(dueno);
      const email = emailAlAzar("gerente");
      const alta = exito(
        await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(a.marca, { emailGerente: email })),
      );
      const identidad = crearCasosDeUsoDeIdentidad({
        transacciones: entornoGeneral,
        tokens,
        reglas: REGLAS_DE_EMPRESA,
      });
      const token = tokens.derivar(invitacionId(alta.invitacionId));
      const aceptar = (marcaDeEntrada: string) =>
        identidad.aceptarInvitacion({
          token,
          emailAutenticado: email,
          usuarioAuth: usuarioDePrueba(email),
          marcaDeEntrada: marcaComercialId(marcaDeEntrada),
          ahora: new Date(),
        });
      // Por la puerta de otra marca: la misma respuesta que para un enlace que no existe; nada cambia.
      expect(falla(await aceptar(b.marca))).toBe("INVITACION_NO_ENCONTRADA");
      expect(
        (
          await una<{ estado: string }>("select estado from empresa where id = $1", [
            alta.empresaId,
          ])
        ).estado,
      ).toBe("PROVISIONING");
      // Por la suya: la empresa pasa a ACTIVE y el gerente queda como GERENTE.
      exito(await aceptar(a.marca));
      expect(
        (
          await una<{ estado: string }>("select estado from empresa where id = $1", [
            alta.empresaId,
          ])
        ).estado,
      ).toBe("ACTIVE");
      expect(
        await todas(
          "select m.rol, m.activo from membresia m join persona p on p.id = m.persona_id where m.empresa_id = $1 and p.email = $2",
          [alta.empresaId, email],
        ),
      ).toEqual([{ rol: "GERENTE", activo: true }]);
    });
  });

  describe("dos marcas conviven sin mezclarse", () => {
    it("cada alta nace con SU marca, SU plan y SUS módulos; el mail se resuelve con la marca del tenant y nunca con la de la otra", async () => {
      const a = await crearMarcaLista(dueno, {
        nombreVisible: "Mi Calendario",
        modulosIniciales: ["caja"],
        modulosDelPlan: ["caja"],
      });
      const b = await crearMarcaLista(dueno, {
        nombreVisible: "Otra Marca",
        modulosIniciales: ["reservas"],
        modulosDelPlan: ["reservas"],
      });
      const altaA = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(a.marca)));
      const altaB = exito(await casos.altaDeEmpresa(comoAdminAhora(), altaNueva(b.marca)));

      expect(
        (
          await una<{ marca_id: string }>("select marca_id from tenant where id = $1", [
            altaA.tenantId,
          ])
        ).marca_id,
      ).toBe(a.marca);
      expect(
        (
          await una<{ marca_id: string }>("select marca_id from tenant where id = $1", [
            altaB.tenantId,
          ])
        ).marca_id,
      ).toBe(b.marca);
      expect(
        await todas("select version_de_plan_id from plan_de_tenant where tenant_id = $1", [
          altaA.tenantId,
        ]),
      ).toEqual([{ version_de_plan_id: a.version }]);
      expect(
        await todas("select version_de_plan_id from plan_de_tenant where tenant_id = $1", [
          altaB.tenantId,
        ]),
      ).toEqual([{ version_de_plan_id: b.version }]);
      expect(
        await todas("select modulo from modulo_de_empresa where empresa_id = $1", [
          altaA.empresaId,
        ]),
      ).toEqual([{ modulo: "caja" }]);
      expect(
        await todas("select modulo from modulo_de_empresa where empresa_id = $1", [
          altaB.empresaId,
        ]),
      ).toEqual([{ modulo: "reservas" }]);

      // El mail del gerente sale de la marca del TENANT de la empresa (lo que lee el manejador del trabajo,
      // con el contexto de la empresa, aún en alta): el nombre y el dominio de A para A, los de B para B.
      const mailDe = async (empresa: string, tenant: string) => {
        const r = await entornoDeMail.ejecutar(
          { contexto: contextoDelSistemaDe(empresa) },
          async (tx) => ({
            ok: true as const,
            valor: await tx.mails.delTenant(tenantId(tenant), new Date()),
          }),
        );
        return exito(r);
      };
      expect(await mailDe(altaA.empresaId, altaA.tenantId)).toEqual({
        nombre: "Mi Calendario",
        urlBase: `https://${a.host}`,
      });
      expect(await mailDe(altaB.empresaId, altaB.tenantId)).toEqual({
        nombre: "Otra Marca",
        urlBase: `https://${b.host}`,
      });
    });
  });
});
