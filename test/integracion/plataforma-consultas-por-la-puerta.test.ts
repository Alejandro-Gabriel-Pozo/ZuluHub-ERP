import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { armarPlataforma } from "../../src/composicion/plataforma";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES } from "../../src/plataforma/consultas/declaraciones-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA } from "../../src/plataforma/consultas/declaraciones";
import type { ContextoDePlataforma } from "../../src/contexto/contexto";
import { SOPORTE_DE_PRUEBA } from "./admins-de-prueba";
import { altaNueva, crearMarcaLista, crearTenantConPlan, type MarcaLista } from "./altas-apoyo";
import { crearBaseAparte } from "./entorno";
import type { MundoDeMarca } from "./marcas-apoyo";
import { adminInexistente, crearAdminDeBase } from "./plataforma-apoyo";
import { plataformaEn } from "./soporte-datos";

/**
 * Las consultas de la consola llamadas POR LA PUERTA REAL (`armarPlataforma`, con el entorno de plataforma y el
 * rol `pedernal_plataforma`), no por los apoyos de las pruebas: lo que cablea `src/composicion/plataforma.ts`.
 * Con el guard real: ADMIN y SOPORTE pasan lo que su matriz permite; un administrador de baja o inexistente no
 * pasa nada; y SOPORTE no puede lo que es solo de ADMIN. Base propia.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

describe.skipIf(base === null)("consultas de plataforma por la puerta real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let plataforma: ReturnType<typeof armarPlataforma>;
  let marca: MarcaLista;
  let otraMarca: MarcaLista;
  let mundo: MundoDeMarca;
  let otroMundo: MundoDeMarca;

  const admin = (): ContextoDePlataforma => plataformaEn(new Date());
  const soporte = (): ContextoDePlataforma =>
    plataformaEn(new Date(), { tipo: "ADMIN", id: SOPORTE_DE_PRUEBA });

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    const entorno = {
      PEDERNAL_DB_PLATAFORMA: propia.base.plataforma,
      PEDERNAL_CLAVE_CONTEXTO: `${base.clave.kid}:${base.clave.secreto.toString("hex")}`,
      PEDERNAL_SECRETO_INVITACIONES: randomBytes(32).toString("hex"),
    };
    plataforma = armarPlataforma({ fuente: () => entorno });
    // Dos marcas con su plan y un tenant cada una.
    marca = await crearMarcaLista(dueno, { nombreVisible: "Marca Uno", modulosDelPlan: [] });
    otraMarca = await crearMarcaLista(dueno, { nombreVisible: "Marca Dos" });
    mundo = await crearTenantConPlan(dueno, marca, { empresasPorTenant: "4" });
    otroMundo = await crearTenantConPlan(dueno, otraMarca);
  });

  afterAll(async () => {
    await plataforma.cerrar();
    await dueno.end();
    await propia.destruir();
  });

  /** Las siete consultas nuevas o ampliadas, cada una con una entrada válida sobre lo sembrado. */
  const consultas = (contexto: ContextoDePlataforma) =>
    ({
      listarTenants: () =>
        plataforma.consultasDePlataforma().listarTenants(contexto, { limite: 100 }),
      listarEmpresas: () =>
        plataforma.consultasDePlataforma().listarEmpresas(contexto, { limite: 100 }),
      catalogoDePerillas: () => plataforma.consultasDePlataforma().catalogoDePerillas(contexto),
      fichaDeMarca: () =>
        plataforma.consultasDeMarcasYPlanes().fichaDeMarca(contexto, { marcaId: marca.marca }),
      marcasParaElAlta: () => plataforma.consultasDeMarcasYPlanes().marcasParaElAlta(contexto),
      catalogosDeMarca: () => plataforma.consultasDeMarcasYPlanes().catalogosDeMarca(contexto),
      tenantsConLaVersion: () =>
        plataforma
          .consultasDeMarcasYPlanes()
          .tenantsConLaVersion(contexto, { versionDePlanId: marca.version }),
    }) as const;

  const accionDe = {
    listarTenants: DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA.listarTenants.accion,
    listarEmpresas: DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA.listarEmpresas.accion,
    catalogoDePerillas: DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA.catalogoDePerillas.accion,
    fichaDeMarca: DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES.fichaDeMarca.accion,
    marcasParaElAlta: DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES.marcasParaElAlta.accion,
    catalogosDeMarca: DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES.catalogosDeMarca.accion,
    tenantsConLaVersion: DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES.tenantsConLaVersion.accion,
  } as const;
  const nombres = Object.keys(accionDe) as Array<keyof typeof accionDe>;

  it("cada consulta nueva está cableada: ADMIN y SOPORTE la ven si su matriz lo permite", async () => {
    for (const [rol, contexto] of [
      ["ADMIN", admin()],
      ["SOPORTE", soporte()],
    ] as const) {
      for (const nombre of nombres) {
        const permitido = (
          REGLAS_DE_PLATAFORMA.permisos[accionDe[nombre]] as readonly string[]
        ).includes(rol);
        const r = await consultas(contexto)[nombre]();
        expect(r.ok, `${rol} ${nombre}`).toBe(permitido);
        if (!permitido) expect(r, `${rol} ${nombre}`).toEqual({ ok: false, error: "SIN_PERMISO" });
      }
    }
    // Y la matriz real las deja a las siete para los dos roles: la prueba no es vacua.
    for (const nombre of nombres) {
      expect(REGLAS_DE_PLATAFORMA.permisos[accionDe[nombre]]).toEqual(["ADMIN", "SOPORTE"]);
    }
  });

  it("un administrador de baja o inexistente no pasa ninguna", async () => {
    const deBaja = await crearAdminDeBase(dueno, { rol: "ADMIN", activo: false });
    for (const contexto of [
      plataformaEn(new Date(), { tipo: "ADMIN", id: deBaja.id }),
      plataformaEn(new Date(), { tipo: "ADMIN", id: adminInexistente() }),
    ]) {
      for (const nombre of nombres) {
        expect(await consultas(contexto)[nombre](), nombre).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
      }
    }
  });

  it("listarTenants y listarEmpresas traen marca, plan vigente, empresas en uso y tope por la puerta", async () => {
    for (const contexto of [admin(), soporte()]) {
      const tenants = await consultas(contexto).listarTenants();
      if (!tenants.ok) throw new Error(JSON.stringify(tenants.error));
      const t = tenants.valor.filas.find((f) => f.id === mundo.tenant);
      expect(t).toMatchObject({
        marcaId: marca.marca,
        marcaNombreVisible: "Marca Uno",
        versionDePlanId: marca.version,
        planProgramado: false,
        empresasEnUso: 1,
        limiteDeEmpresas: 4,
      });
      expect(tenants.valor.filas.find((f) => f.id === otroMundo.tenant)).toMatchObject({
        marcaId: otraMarca.marca,
        limiteDeEmpresas: 1,
      });
      const empresas = await consultas(contexto).listarEmpresas();
      if (!empresas.ok) throw new Error(JSON.stringify(empresas.error));
      expect(empresas.valor.filas.find((f) => f.id === mundo.empresa)).toMatchObject({
        tenantNombre: expect.any(String) as string,
        marcaCodigo: expect.any(String) as string,
        planVersionNumero: 1,
        estadoEfectivo: "OPERA",
      });
    }
  });

  it("filtra por la puerta: la marca de uno no trae las empresas del otro", async () => {
    const r = await plataforma
      .consultasDePlataforma()
      .listarEmpresas(admin(), { marcaId: otraMarca.marca });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.valor.filas.map((f) => f.id)).toEqual([otroMundo.empresa]);
  });

  it("catálogos, ficha, marcas para el alta y tenants con la versión devuelven lo sembrado", async () => {
    const perillas = await consultas(soporte()).catalogoDePerillas();
    expect(perillas.ok && perillas.valor.perillas.map((p) => p.perilla)).toContain(
      "empresas_por_tenant",
    );
    const catalogos = await consultas(soporte()).catalogosDeMarca();
    expect(catalogos.ok && catalogos.valor.tema.tokens).toEqual([
      "primary",
      "on-primary",
      "secondary",
      "accent",
    ]);
    const ficha = await consultas(soporte()).fichaDeMarca();
    expect(ficha.ok && ficha.valor.efectiva?.nombreVisible).toEqual({
      valor: "Marca Uno",
      origen: { tipo: "propio" },
    });
    const tenants = await consultas(admin()).tenantsConLaVersion();
    expect(tenants.ok && tenants.valor.filas.map((f) => f.tenantId)).toEqual([mundo.tenant]);
    expect(tenants.ok && tenants.valor.filas[0]).toMatchObject({
      ultimoNumeroDeAsignacion: 1,
      hayProgramada: false,
      empresas: 1,
    });
  });

  it("marcasParaElAlta por la puerta coincide con el alta real por la puerta", async () => {
    const lista = await consultas(admin()).marcasParaElAlta();
    if (!lista.ok) throw new Error(JSON.stringify(lista.error));
    const deLaMarca = lista.valor.marcas.find((m) => m.marcaId === marca.marca);
    expect(deLaMarca).toMatchObject({ elegible: true, motivoSiNo: null, nombre: "Marca Uno" });
    expect(deLaMarca?.planPorDefecto?.versionDePlanId).toBe(marca.version);
    const alta = await plataforma
      .casosDeUsoDeAltas()
      .altaDeEmpresa(admin(), altaNueva(marca.marca));
    expect(alta.ok).toBe(true);
    // Una marca sin versión vigente no es elegible, y el alta lo confirma.
    const sinVersion = await crearMarcaLista(dueno, { sinVersion: true });
    const otra = await consultas(admin()).marcasParaElAlta();
    const fila = otra.ok
      ? otra.valor.marcas.find((m) => m.marcaId === sinVersion.marca)
      : undefined;
    expect(fila).toMatchObject({ elegible: false, motivoSiNo: "MARCA_SIN_DEFINICION" });
    const rechazada = await plataforma
      .casosDeUsoDeAltas()
      .altaDeEmpresa(admin(), altaNueva(sinVersion.marca));
    expect(rechazada).toEqual({ ok: false, error: "MARCA_SIN_DEFINICION" });
  });

  it("SOPORTE ve, pero lo que es solo de ADMIN le da SIN_PERMISO y no escribe nada", async () => {
    const antes = Number(
      (
        (await dueno.query<{ n: string }>("select count(*)::int as n from marca")).rows[0] as {
          n: string;
        }
      ).n,
    );
    const r = await plataforma.casosDeUsoDeMarcasYPlanes().crearMarca(soporte(), {
      claveDeIdempotencia: `soporte-${randomBytes(8).toString("hex")}`,
      codigo: "marca-de-soporte",
      marcaPadreId: null,
    });
    expect(r).toEqual({ ok: false, error: "SIN_PERMISO" });
    const despues = Number(
      (
        (await dueno.query<{ n: string }>("select count(*)::int as n from marca")).rows[0] as {
          n: string;
        }
      ).n,
    );
    expect(despues).toBe(antes);
  });
});
