import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import type { ConsultasDeMarcasYPlanes } from "../../src/plataforma/consultas/consultas-de-marcas-y-planes";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import {
  ACTOR_DE_PRUEBA,
  ajustarPerilla,
  asignarPlan,
  codigoAlAzar,
  crearBorradorDeMarca,
  crearBorradorDePlan,
  crearDominio,
  crearMarca,
  crearMundoDeMarca,
  crearPlan,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  marcaPrincipal,
  publicarVersionDePlan,
} from "./marcas-apoyo";
import { adminInexistente, crearAdminDeBase } from "./plataforma-apoyo";
import {
  comoAdminAhora,
  comoAdministradorAhora,
  comoElSistemaAhora,
  comoSoporteAhora,
  crearConsultasDeMarcasYPlanesDePrueba,
  crearEntornoDeMarcasYPlanes,
  exito,
  falla,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";
import { crearEntornoDeDerechos } from "./derechos-apoyo";
import { MODULOS_DE_PRUEBA, PERILLAS_DE_PRUEBA } from "../utilidades/planes";

/**
 * Las consultas de plataforma sobre marcas y planes contra Postgres real (M5): qué devuelve cada una, que
 * SOPORTE las ve (no cambia estructura) y que ninguna escribe nada. Base propia.
 */

const base = inject("baseDePruebas");
const INEXISTENTE = "00000000-0000-4000-8000-00000000dead";
const TEMA = {
  primary: "#1d4ed8",
  "on-primary": "#ffffff",
  secondary: "#475569",
  accent: "#0f766e",
};

describe.skipIf(base === null)("consultas de marcas y planes: contra Postgres", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
  let consultas: ConsultasDeMarcasYPlanes;
  let principal: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeMarcasYPlanes(propia.base);
    consultas = crearConsultasDeMarcasYPlanesDePrueba(entorno);
    principal = await marcaPrincipal(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  /** Un tenant con dos empresas. */
  async function tenantConDosEmpresas() {
    const primera = await crearMundoDeMarca(dueno);
    const segunda = await crearMundoDeMarca(dueno, { tenant: primera.tenant });
    return {
      tenant: primera.tenant,
      empresas: [primera.empresa, segunda.empresa] as [string, string],
    };
  }
  const consultar = [
    ["listarMarcas", () => consultas.listarMarcas(comoAdminAhora())],
    ["fichaDeMarca", () => consultas.fichaDeMarca(comoAdminAhora(), { marcaId: principal })],
    ["listarPlanes", () => consultas.listarPlanes(comoAdminAhora())],
    ["fichaDePlan", () => consultas.fichaDePlan(comoAdminAhora(), { planId: INEXISTENTE })],
    ["planDelTenant", () => consultas.planDelTenant(comoAdminAhora(), { tenantId: INEXISTENTE })],
    [
      "derechosDeUsoDeEmpresa",
      () => consultas.derechosDeUsoDeEmpresa(comoAdminAhora(), { empresaId: INEXISTENTE }),
    ],
    [
      "diferenciaEntreVersiones",
      () =>
        consultas.diferenciaEntreVersiones(comoAdminAhora(), {
          desde: INEXISTENTE,
          hasta: INEXISTENTE,
        }),
    ],
  ] as const;

  describe("autorización", () => {
    it("SOPORTE y ADMIN las ven; un administrador de baja, uno inexistente y el sistema reciben SIN_PERMISO; ninguna escribe", async () => {
      const deBaja = await crearAdminDeBase(dueno, { rol: "ADMIN", activo: false });
      const antes = await huellaDeEscrituras(dueno);
      const con = (contexto: ContextoDePlataforma) =>
        [
          consultas.listarMarcas(contexto),
          consultas.fichaDeMarca(contexto, { marcaId: principal }),
          consultas.listarPlanes(contexto),
          consultas.fichaDePlan(contexto, { planId: INEXISTENTE }),
          consultas.planDelTenant(contexto, { tenantId: INEXISTENTE }),
          consultas.derechosDeUsoDeEmpresa(contexto, { empresaId: INEXISTENTE }),
          consultas.diferenciaEntreVersiones(contexto, { desde: INEXISTENTE, hasta: INEXISTENTE }),
        ] as const;
      for (const contexto of [comoAdminAhora(), comoSoporteAhora()]) {
        const [marcas, ficha, planes, fichaPlan, tenant, derechos, diferencia] = await Promise.all(
          con(contexto),
        );
        expect(marcas.ok).toBe(true);
        expect(ficha.ok).toBe(true);
        expect(planes.ok).toBe(true);
        // Las que piden algo que no existe llegan hasta ahí: el permiso lo tienen.
        expect(falla(fichaPlan)).toBe("PLAN_NO_ENCONTRADO");
        expect(falla(tenant)).toBe("TENANT_NO_ENCONTRADO");
        expect(falla(derechos)).toBe("EMPRESA_NO_ENCONTRADA");
        expect(falla(diferencia)).toBe("VERSION_DE_PLAN_NO_ENCONTRADA");
      }
      for (const contexto of [
        comoAdministradorAhora(deBaja.id),
        comoAdministradorAhora(adminInexistente()),
        comoElSistemaAhora(),
      ]) {
        for (const r of await Promise.all(con(contexto))) {
          expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
        }
      }
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("un actor de empresa nunca llega: el contexto de empresa lanza antes de leer nada", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const empresa = comoEmpresa(mundo.empresa as never) as unknown as ContextoDePlataforma;
      for (const [nombre] of consultar) {
        const llamada = {
          listarMarcas: () => consultas.listarMarcas(empresa),
          fichaDeMarca: () => consultas.fichaDeMarca(empresa, { marcaId: principal }),
          listarPlanes: () => consultas.listarPlanes(empresa),
          fichaDePlan: () => consultas.fichaDePlan(empresa, { planId: INEXISTENTE }),
          planDelTenant: () => consultas.planDelTenant(empresa, { tenantId: INEXISTENTE }),
          derechosDeUsoDeEmpresa: () =>
            consultas.derechosDeUsoDeEmpresa(empresa, { empresaId: INEXISTENTE }),
          diferenciaEntreVersiones: () =>
            consultas.diferenciaEntreVersiones(empresa, { desde: INEXISTENTE, hasta: INEXISTENTE }),
        }[nombre];
        // El guard va primero y la autorización de plataforma no conoce al actor de empresa: o lanza o rechaza.
        const r = await llamada().then(
          (x) => x,
          (e: unknown) => ({
            ok: false as const,
            error: e instanceof RangeError ? "RANGE" : "OTRO",
          }),
        );
        expect(r.ok, nombre).toBe(false);
      }
    });
  });

  describe("listarMarcas y fichaDeMarca", () => {
    it("lista las marcas por código con su versión vigente, su borrador y lo programado", async () => {
      const sola = await crearMarca(dueno, { codigo: codigoAlAzar("aa") });
      const conVersion = await crearMarca(dueno, { codigo: codigoAlAzar("ab") });
      await crearVersionDeMarcaConfirmada(dueno, conVersion, {
        nombreVisible: "Con versión",
        desdeSegundos: -30,
      });
      await crearVersionDeMarcaConfirmada(dueno, conVersion, {
        nombreVisible: "Programada",
        desdeSegundos: 3600,
      });
      await crearBorradorDeMarca(dueno, conVersion, { nombreVisible: "Borrador" });
      const { marcas } = exito(await consultas.listarMarcas(comoAdminAhora()));
      const codigos = marcas.map((m) => m.marca.codigo);
      expect(codigos).toEqual([...codigos].sort());
      const fila = (id: string) => marcas.find((m) => m.marca.id === id);
      expect(fila(sola)).toMatchObject({
        nombreVisible: null,
        versionVigente: null,
        hayBorrador: false,
        hayProgramada: false,
      });
      expect(fila(conVersion)).toMatchObject({
        nombreVisible: "Con versión",
        versionVigente: 1,
        hayBorrador: true,
        hayProgramada: true,
      });
      expect(fila(principal)?.marca).toMatchObject({
        esPrincipal: true,
        nivel: 0,
        estado: "ACTIVA",
      });
    });

    it("la ficha: cadena de padres, versiones con su estado calculado, borrador, dominios y claves de texto huérfanas", async () => {
      const padre = await crearMarca(dueno);
      const marca = await crearMarca(dueno, { padre });
      await crearVersionDeMarcaConfirmada(dueno, marca, {
        nombreVisible: "Anterior",
        desdeSegundos: -50,
        vocabulario: { "texto.que.el.codigo.quito": "viejo" },
      });
      await crearVersionDeMarcaConfirmada(dueno, marca, {
        nombreVisible: "Vigente",
        desdeSegundos: -30,
      });
      // La 4 empieza antes que la 3 y es de número mayor: la 3 nunca va a regir.
      await crearVersionDeMarcaConfirmada(dueno, marca, {
        nombreVisible: "Sin efecto",
        desdeSegundos: 7200,
      });
      await crearVersionDeMarcaConfirmada(dueno, marca, {
        nombreVisible: "Programada",
        desdeSegundos: 3600,
      });
      await crearBorradorDeMarca(dueno, marca, {
        nombreVisible: "Borrador",
        vocabulario: { "otro.texto.huerfano": "x", "rol.gerente.nombre": "Jefe" },
      });
      const dominio = await crearDominio(dueno, marca, { estado: "ACTIVO", canonico: true });
      const ficha = exito(await consultas.fichaDeMarca(comoAdminAhora(), { marcaId: marca }));
      expect(ficha.marca).toMatchObject({ id: marca, marcaPadreId: padre, nivel: 1 });
      expect(ficha.cadena.map((m) => m.id)).toEqual([padre]);
      expect(ficha.versiones.map((v) => [v.numero, v.estado, v.definicion.nombreVisible])).toEqual([
        [1, "ANTERIOR", "Anterior"],
        [2, "VIGENTE", "Vigente"],
        [3, "SIN_EFECTO", "Sin efecto"],
        [4, "PROGRAMADA", "Programada"],
      ]);
      expect(ficha.versiones[1]).toMatchObject({
        confirmadaPor: ACTOR_DE_PRUEBA,
        motivo: "prueba",
      });
      expect(ficha.borrador).toMatchObject({
        version: 1,
        definicion: { nombreVisible: "Borrador" },
      });
      expect(ficha.dominios).toMatchObject([
        { id: dominio.id, host: dominio.host, estado: "ACTIVO", esCanonico: true },
      ]);
      expect(ficha.clavesDeTextoHuerfanas).toEqual([
        "otro.texto.huerfano",
        "texto.que.el.codigo.quito",
      ]);
    });

    it("la ficha de una marca sin nada devuelve listas vacías; una que no existe o mal escrita, su error", async () => {
      const marca = await crearMarca(dueno, { codigo: codigoAlAzar("zz") });
      const ficha = exito(
        await consultas.fichaDeMarca(comoAdminAhora(), { marcaId: marca.toUpperCase() }),
      );
      expect(ficha).toMatchObject({
        cadena: [],
        versiones: [],
        borrador: null,
        dominios: [],
        clavesDeTextoHuerfanas: [],
      });
      expect(falla(await consultas.fichaDeMarca(comoAdminAhora(), { marcaId: INEXISTENTE }))).toBe(
        "MARCA_NO_ENCONTRADA",
      );
      expect(falla(await consultas.fichaDeMarca(comoAdminAhora(), { marcaId: "x" }))).toBe(
        "ID_INVALIDO",
      );
    });

    it("el borrador de la ficha trae la version que va en versionEsperada de la próxima edición", async () => {
      const marca = await crearMarca(dueno);
      await crearBorradorDeMarca(dueno, marca, { nombreVisible: "Uno", tema: TEMA });
      await dueno.query("update version_de_marca set nombre_visible = 'Dos' where marca_id = $1", [
        marca,
      ]);
      const ficha = exito(await consultas.fichaDeMarca(comoAdminAhora(), { marcaId: marca }));
      expect(ficha.borrador?.version).toBe(2);
    });
  });

  describe("listarPlanes y fichaDePlan", () => {
    it("lista los planes por código con su última versión publicada y su borrador", async () => {
      const sin = await crearPlan(dueno, codigoAlAzar("qa"));
      const conBorrador = await crearPlan(dueno, codigoAlAzar("qb"));
      await crearBorradorDePlan(dueno, conBorrador, { nombreComercial: "Borrador" });
      const publicado = await crearPlanPublicado(dueno, {
        codigo: codigoAlAzar("qc"),
        nombreComercial: "Uno",
        modulos: ["caja"],
      });
      const dos = await crearBorradorDePlan(dueno, publicado.plan, {
        nombreComercial: "Dos",
        modulos: ["caja"],
      });
      await publicarVersionDePlan(dueno, dos);
      const { planes } = exito(await consultas.listarPlanes(comoAdminAhora()));
      const codigos = planes.map((p) => p.plan.codigo);
      expect(codigos).toEqual([...codigos].sort());
      const fila = (id: string) => planes.find((p) => p.plan.id === id);
      expect(fila(sin)).toMatchObject({ ultimaVersion: null, hayBorrador: false });
      expect(fila(conBorrador)).toMatchObject({ ultimaVersion: null, hayBorrador: true });
      expect(fila(publicado.plan)).toMatchObject({
        ultimaVersion: { versionDePlanId: dos, numero: 2, nombreComercial: "Dos" },
        hayBorrador: false,
      });
    });

    it("la ficha: versiones con sus módulos y perillas, y cuántos tenants tiene hoy cada una", async () => {
      const a = await tenantConDosEmpresas();
      const b = await tenantConDosEmpresas();
      const c = await tenantConDosEmpresas();
      const primera = await crearPlanPublicado(dueno, {
        modulos: ["caja"],
        perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 2 } },
      });
      const v2 = await crearBorradorDePlan(dueno, primera.plan, { modulos: ["caja", "ventas"] });
      await publicarVersionDePlan(dueno, v2);
      const borrador = await crearBorradorDePlan(dueno, primera.plan, {
        nombreComercial: "En curso",
      });
      const otroPlan = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      await asignarPlan(dueno, a.tenant, primera.version, { desdeSegundos: -30 });
      await asignarPlan(dueno, b.tenant, primera.version, { desdeSegundos: -30 });
      await asignarPlan(dueno, b.tenant, v2, { desdeSegundos: -20 }); // b pasó a la 2
      await asignarPlan(dueno, c.tenant, primera.version, { desdeSegundos: -30 });
      await asignarPlan(dueno, c.tenant, otroPlan.version, { desdeSegundos: -20 }); // c se fue a otro plan
      const ficha = exito(await consultas.fichaDePlan(comoAdminAhora(), { planId: primera.plan }));
      expect(ficha.plan.id).toBe(primera.plan);
      expect(ficha.versiones.map((v) => [v.numero, v.estado, v.tenantsConLaVersion])).toEqual([
        [1, "PUBLICADA", 1],
        [2, "PUBLICADA", 1],
        [null, "BORRADOR", 0],
      ]);
      expect(ficha.versiones[0]).toMatchObject({
        versionDePlanId: primera.version,
        modulos: ["caja"],
        perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 2 } },
        motivo: "prueba",
      });
      expect(ficha.versiones[2]).toMatchObject({
        versionDePlanId: borrador,
        nombreComercial: "En curso",
        version: 1,
      });
      expect(ficha.tenantsConElPlan).toBe(2);
      expect(falla(await consultas.fichaDePlan(comoAdminAhora(), { planId: INEXISTENTE }))).toBe(
        "PLAN_NO_ENCONTRADO",
      );
      expect(falla(await consultas.fichaDePlan(comoAdminAhora(), { planId: "x" }))).toBe(
        "ID_INVALIDO",
      );
    });
  });

  describe("planDelTenant", () => {
    it("el historial con VIGENTE, PROGRAMADA, SIN_EFECTO y ANTERIOR, los ajustes con su estado y los módulos por empresa", async () => {
      const { tenant, empresas } = await tenantConDosEmpresas();
      const v1 = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      const v2 = await crearPlanPublicado(dueno, { modulos: ["caja", "ventas"] });
      await asignarPlan(dueno, tenant, v1.version, { desdeSegundos: -50, origen: "ALTA" });
      await asignarPlan(dueno, tenant, v2.version, { desdeSegundos: -30 });
      await asignarPlan(dueno, tenant, v1.version, { desdeSegundos: 7200 }); // programada
      await asignarPlan(dueno, tenant, v2.version, { desdeSegundos: 3600 }); // pisa a la anterior? no: empieza antes → la #3 queda sin efecto
      await ajustarPerilla(dueno, tenant, "empresas_por_tenant", "3", { desdeSegundos: -30 });
      await ajustarPerilla(dueno, tenant, "empresas_por_tenant", "DEL_PLAN", {
        desdeSegundos: -20,
      });
      await ajustarPerilla(dueno, tenant, "vidriera_por_qr", "1", {
        empresa: empresas[0],
        desdeSegundos: 3600,
      });
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo, activo) values ($1, 'caja', true), ($1, 'ventas', false)",
        [empresas[0]],
      );
      const plan = exito(await consultas.planDelTenant(comoAdminAhora(), { tenantId: tenant }));
      expect(plan.tenantId).toBe(tenant);
      expect(plan.asignaciones.map((a) => [a.numero, a.estado, a.origen, a.versionNumero])).toEqual(
        [
          [1, "ANTERIOR", "ALTA", 1],
          [2, "VIGENTE", "CAMBIO", 1],
          [3, "SIN_EFECTO", "CAMBIO", 1],
          [4, "PROGRAMADA", "CAMBIO", 1],
        ],
      );
      expect(plan.asignaciones[1]).toMatchObject({
        versionDePlanId: v2.version,
        planCodigo: expect.stringMatching(/^p-/) as string,
        motivo: "prueba",
      });
      expect(
        plan.ajustes.map((a) => [a.perilla, a.empresaId, a.numero, a.estado, a.valor]),
      ).toEqual([
        ["empresas_por_tenant", null, 1, "ANTERIOR", { tipo: "LIMITE", limite: 3 }],
        ["empresas_por_tenant", null, 2, "VIGENTE", "DEL_PLAN"],
        ["vidriera_por_qr", empresas[0], 1, "PROGRAMADA", { tipo: "INTERRUPTOR", encendida: true }],
      ]);
      const deLaPrimera = plan.empresas.find((e) => e.empresaId === empresas[0]);
      expect(deLaPrimera?.modulos).toEqual([
        { modulo: "caja", activo: true },
        { modulo: "ventas", activo: false },
      ]);
      expect(plan.empresas.find((e) => e.empresaId === empresas[1])?.modulos).toEqual([]);
    });

    it("un tenant sin plan devuelve el historial vacío; uno que no existe o mal escrito, su error", async () => {
      const { tenant } = await tenantConDosEmpresas();
      expect(
        exito(await consultas.planDelTenant(comoAdminAhora(), { tenantId: tenant })),
      ).toMatchObject({
        asignaciones: [],
        ajustes: [],
      });
      expect(
        falla(await consultas.planDelTenant(comoAdminAhora(), { tenantId: INEXISTENTE })),
      ).toBe("TENANT_NO_ENCONTRADO");
      expect(falla(await consultas.planDelTenant(comoAdminAhora(), { tenantId: "x" }))).toBe(
        "ID_INVALIDO",
      );
    });
  });

  describe("derechosDeUsoDeEmpresa", () => {
    it("módulos habilitados y activados con su estado, y cada perilla con su valor y su origen", async () => {
      const { tenant, empresas } = await tenantConDosEmpresas();
      const plan = await crearPlanPublicado(dueno, {
        modulos: ["caja", "ventas"],
        perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 4 } },
      });
      await asignarPlan(dueno, tenant, plan.version, { desdeSegundos: -30 });
      await ajustarPerilla(dueno, tenant, "vidriera_por_qr", "1", {
        empresa: empresas[0],
        desdeSegundos: -30,
      });
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'caja'), ($1, 'cuentas')",
        [empresas[0]],
      );
      const d = exito(
        await consultas.derechosDeUsoDeEmpresa(comoAdminAhora(), { empresaId: empresas[0] }),
      );
      expect(d).toMatchObject({
        empresaId: empresas[0],
        tenantId: tenant,
        versionDePlan: { versionDePlanId: plan.version, numero: 1 },
      });
      const estado = (m: string) => d.modulos.find((x) => x.modulo === m);
      expect(estado("nucleo")).toMatchObject({
        obligatorio: true,
        habilitadoPorElPlan: true,
        estado: "ACTIVO",
      });
      expect(estado("caja")).toMatchObject({
        habilitadoPorElPlan: true,
        activado: true,
        estado: "ACTIVO",
      });
      expect(estado("ventas")).toMatchObject({
        habilitadoPorElPlan: true,
        activado: false,
        estado: "NO_ACTIVO",
      });
      // Activado pero fuera del techo del plan: solo lectura.
      expect(estado("cuentas")).toMatchObject({
        habilitadoPorElPlan: false,
        activado: true,
        estado: "SOLO_LECTURA",
      });
      expect(estado("comandas")).toMatchObject({ disponible: false, estado: "NO_ACTIVO" });
      const perilla = (p: string) => d.perillas.find((x) => x.perilla === p);
      expect(perilla("cajas_por_sucursal")).toEqual({
        perilla: "cajas_por_sucursal",
        valor: { tipo: "LIMITE", limite: 4 },
        origen: "PLAN",
      });
      expect(perilla("vidriera_por_qr")).toEqual({
        perilla: "vidriera_por_qr",
        valor: { tipo: "INTERRUPTOR", encendida: true },
        origen: "AJUSTE",
      });
      expect(perilla("empresas_por_tenant")).toEqual({
        perilla: "empresas_por_tenant",
        valor: { tipo: "LIMITE", limite: 1 },
        origen: "BASE",
      });
      // La otra empresa del tenant no tiene el ajuste de la primera.
      const otra = exito(
        await consultas.derechosDeUsoDeEmpresa(comoAdminAhora(), { empresaId: empresas[1] }),
      );
      expect(otra.perillas.find((x) => x.perilla === "vidriera_por_qr")).toMatchObject({
        origen: "BASE",
      });
    });

    it("es el mismo cálculo que ve la propia empresa (una sola regla)", async () => {
      const { tenant, empresas } = await tenantConDosEmpresas();
      const plan = await crearPlanPublicado(dueno, {
        modulos: ["caja"],
        perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 4 } },
      });
      await asignarPlan(dueno, tenant, plan.version, { desdeSegundos: -30 });
      await ajustarPerilla(dueno, tenant, "cajas_por_sucursal", "9", {
        empresa: empresas[0],
        desdeSegundos: -30,
      });
      await ajustarPerilla(dueno, tenant, "empresas_por_tenant", "ILIMITADO", {
        desdeSegundos: -30,
      });
      const deLaPlataforma = exito(
        await consultas.derechosDeUsoDeEmpresa(comoAdminAhora(), { empresaId: empresas[0] }),
      );
      const entornoDeDerechos = crearEntornoDeDerechos(propia.base, {
        catalogoDeModulos: MODULOS_DE_PRUEBA,
        catalogoDePerillas: PERILLAS_DE_PRUEBA,
      });
      try {
        const r = await entornoDeDerechos.ejecutar(
          {
            contexto: {
              tipo: "OPERATIVO",
              empresaId: empresas[0] as never,
              personaId: null,
              marcaDeEntrada: principal as never,
              ahora: new Date(),
            },
            soloLectura: true,
          },
          async ({ derechos }) => {
            const d = await derechos.deLaEmpresa({
              tipo: "OPERATIVO",
              empresaId: empresas[0] as never,
              personaId: null,
              marcaDeEntrada: principal as never,
              ahora: new Date(),
            });
            return { ok: true as const, valor: d };
          },
        );
        const deLaEmpresa = exito(r);
        expect(deLaPlataforma.perillas.map((p) => [p.perilla, p.valor, p.origen])).toEqual(
          [...deLaEmpresa.perillas].map(([perilla, v]) => [
            perilla,
            v.tipo === "INTERRUPTOR"
              ? { tipo: v.tipo, encendida: v.encendida }
              : { tipo: v.tipo, limite: v.limite },
            v.origen,
          ]),
        );
        expect(
          deLaPlataforma.modulos
            .filter((m) => m.habilitadoPorElPlan)
            .map((m) => m.modulo)
            .sort(),
        ).toEqual([...deLaEmpresa.modulosHabilitados].sort());
      } finally {
        await entornoDeDerechos.cerrar();
      }
    });

    it("una empresa que no existe o mal escrita, su error", async () => {
      expect(
        falla(await consultas.derechosDeUsoDeEmpresa(comoAdminAhora(), { empresaId: INEXISTENTE })),
      ).toBe("EMPRESA_NO_ENCONTRADA");
      expect(
        falla(await consultas.derechosDeUsoDeEmpresa(comoAdminAhora(), { empresaId: "x" })),
      ).toBe("ID_INVALIDO");
    });
  });

  describe("diferenciaEntreVersiones", () => {
    it("módulos que entran y salen, perillas que suben o bajan y, por tenant, ajustes que pisan y módulos que quedarían en solo lectura", async () => {
      const a = await tenantConDosEmpresas();
      const b = await tenantConDosEmpresas();
      const desde = await crearPlanPublicado(dueno, {
        modulos: ["caja", "ventas"],
        perillas: {
          cajas_por_sucursal: { tipo: "LIMITE", limite: 5 },
          vidriera_por_qr: { tipo: "INTERRUPTOR", encendida: true },
        },
      });
      const hastaId = await crearBorradorDePlan(dueno, desde.plan, {
        modulos: ["caja", "reservas"],
        perillas: { cajas_por_sucursal: { tipo: "LIMITE", limite: 2 } },
      });
      await publicarVersionDePlan(dueno, hastaId);
      await asignarPlan(dueno, a.tenant, desde.version, { desdeSegundos: -30 });
      await asignarPlan(dueno, b.tenant, desde.version, { desdeSegundos: -30 });
      // `a` tiene un ajuste que pisa la baja de cajas y `ventas` activada en su primera empresa.
      await ajustarPerilla(dueno, a.tenant, "cajas_por_sucursal", "8", { desdeSegundos: -30 });
      await dueno.query(
        "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'ventas')",
        [a.empresas[0]],
      );
      const sinTenants = exito(
        await consultas.diferenciaEntreVersiones(comoAdminAhora(), {
          desde: desde.version,
          hasta: hastaId,
          tenantIds: [],
        }),
      );
      expect(sinTenants).toMatchObject({
        desde: { versionDePlanId: desde.version, numero: 1, estado: "PUBLICADA" },
        hasta: { versionDePlanId: hastaId, numero: 2 },
        modulosQueEntran: ["reservas"],
        modulosQueSalen: ["ventas"],
        porTenant: [],
      });
      expect(sinTenants.perillas.map((p) => [p.perilla, p.sentido])).toEqual([
        ["cajas_por_sucursal", "BAJA"],
        ["vidriera_por_qr", "BAJA"],
      ]);
      // Sin `tenantIds`: todos los que hoy tienen la versión de origen vigente.
      const todos = exito(
        await consultas.diferenciaEntreVersiones(comoAdminAhora(), {
          desde: desde.version,
          hasta: hastaId,
        }),
      );
      expect(todos.porTenant.map((t) => t.tenantId).sort()).toEqual([a.tenant, b.tenant].sort());
      const deA = todos.porTenant.find((t) => t.tenantId === a.tenant);
      expect(deA?.ajustes).toEqual([
        expect.objectContaining({
          perilla: "cajas_por_sucursal",
          empresaId: null,
          valor: { tipo: "LIMITE", limite: 8 },
          pisaUnCambio: true,
        }),
      ]);
      expect(deA?.modulosEnSoloLectura).toEqual([
        { empresaId: a.empresas[0], modulo: "ventas", yaLoEstaba: false },
      ]);
      expect(todos.porTenant.find((t) => t.tenantId === b.tenant)).toMatchObject({
        ajustes: [],
        modulosEnSoloLectura: [],
      });
      // Con `tenantIds`: solo esos.
      const soloB = exito(
        await consultas.diferenciaEntreVersiones(comoAdminAhora(), {
          desde: desde.version,
          hasta: hastaId,
          tenantIds: [b.tenant, b.tenant.toUpperCase()],
        }),
      );
      expect(soloB.porTenant.map((t) => t.tenantId)).toEqual([b.tenant]);
    });

    it("tras migrar un tenant ya no figura entre los que tienen la versión de origen", async () => {
      const a = await tenantConDosEmpresas();
      const desde = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      const borrador = await crearBorradorDePlan(dueno, desde.plan, {
        modulos: ["caja", "ventas"],
      });
      await publicarVersionDePlan(dueno, borrador);
      await asignarPlan(dueno, a.tenant, desde.version, { desdeSegundos: -30 });
      const antes = exito(
        await consultas.diferenciaEntreVersiones(comoAdminAhora(), {
          desde: desde.version,
          hasta: borrador,
        }),
      );
      expect(antes.porTenant.map((t) => t.tenantId)).toEqual([a.tenant]);
      await asignarPlan(dueno, a.tenant, borrador, { desdeSegundos: -20 });
      const despues = exito(
        await consultas.diferenciaEntreVersiones(comoAdminAhora(), {
          desde: desde.version,
          hasta: borrador,
        }),
      );
      expect(despues.porTenant).toEqual([]);
    });

    it("rechaza lo que no existe o está mal escrito", async () => {
      const v = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      const ok = { desde: v.version, hasta: v.version };
      expect(
        falla(
          await consultas.diferenciaEntreVersiones(comoAdminAhora(), { ...ok, hasta: INEXISTENTE }),
        ),
      ).toBe("VERSION_DE_PLAN_NO_ENCONTRADA");
      expect(
        falla(await consultas.diferenciaEntreVersiones(comoAdminAhora(), { ...ok, desde: "x" })),
      ).toBe("ID_INVALIDO");
      expect(
        falla(
          await consultas.diferenciaEntreVersiones(comoAdminAhora(), { ...ok, tenantIds: ["x"] }),
        ),
      ).toBe("ID_INVALIDO");
      expect(
        falla(
          await consultas.diferenciaEntreVersiones(comoAdminAhora(), {
            ...ok,
            tenantIds: [INEXISTENTE],
          }),
        ),
      ).toBe("TENANT_NO_ENCONTRADO");
      const muchos = Array.from(
        { length: 201 },
        (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      );
      expect(
        falla(
          await consultas.diferenciaEntreVersiones(comoAdminAhora(), { ...ok, tenantIds: muchos }),
        ),
      ).toBe("LOTE_DEMASIADO_GRANDE");
    });
  });
});
