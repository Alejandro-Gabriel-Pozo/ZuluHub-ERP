import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { CasosDeUsoDeAltas } from "../../src/plataforma/casos-de-uso/altas";
import type { ConsultasDeMarcasYPlanes } from "../../src/plataforma/consultas/consultas-de-marcas-y-planes";
import type { MarcaParaElAlta } from "../../src/plataforma/consultas/contrato-de-marcas-y-planes";
import {
  altaNueva,
  comoAdminAhora as comoAdminDelAlta,
  crearCasosDeAlta,
  crearEntornoDeAlta,
  crearMarcaLista,
  type TxDeAltaDePrueba,
} from "./altas-apoyo";
import { crearBaseAparte } from "./entorno";
import {
  crearDominio,
  crearMarca,
  crearPlan,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
} from "./marcas-apoyo";
import { adminInexistente, crearAdminDeBase } from "./plataforma-apoyo";
import {
  comoAdminAhora,
  comoAdministradorAhora,
  comoSoporteAhora,
  crearConsultasDeMarcasYPlanesDePrueba,
  crearEntornoDeMarcasYPlanes,
  exito,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * `marcasParaElAlta` contra Postgres real. La prueba que importa es la de COINCIDENCIA: por cada marca de la
 * base, lo que la consulta dice («elegible», y si no, por qué) es lo que responde el alta REAL de una empresa
 * con tenant nuevo por esa marca. Hay marcas elegibles y de cada tipo de no elegible, de varias familias. Base
 * propia.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("marcasParaElAlta: contra Postgres, contra el alta real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entornoDeConsultas: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
  let entornoDelAlta: TransaccionesDePostgres<TxDeAltaDePrueba>;
  let consultas: ConsultasDeMarcasYPlanes;
  let alta: CasosDeUsoDeAltas;

  // Cada marca sembrada, con el motivo por el que se espera que no sirva (`null`: sirve).
  const m = {} as Record<string, { id: string; motivo: string | null }>;
  const registrar = (nombre: string, id: string, motivo: string | null) => {
    m[nombre] = { id, motivo };
  };

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entornoDeConsultas = crearEntornoDeMarcasYPlanes(propia.base);
    consultas = crearConsultasDeMarcasYPlanesDePrueba(entornoDeConsultas);
    entornoDelAlta = crearEntornoDeAlta(propia.base);
    alta = crearCasosDeAlta(entornoDelAlta);

    // La principal sirve aunque no tenga dominio propio (solo ella se apoya en el respaldo de las variables).
    const principal = await crearMarcaLista(dueno, {
      principal: true,
      sinDominio: true,
      nombreVisible: "Principal",
      modulosDelPlan: ["caja"],
      modulosIniciales: ["caja"],
    });
    registrar("principal", principal.marca, null);

    // Un producto completo con su propio plan, y otro que hereda plan y módulos de la principal.
    const completo = await crearMarcaLista(dueno, {
      nombreVisible: "Producto completo",
      modulosDelPlan: ["caja", "ventas"],
      modulosIniciales: ["ventas", "caja"],
    });
    registrar("completo", completo.marca, null);
    const hereda = await crearMarca(dueno, { codigo: "hereda", padre: principal.marca });
    await crearVersionDeMarcaConfirmada(dueno, hereda, { nombreVisible: "Hereda todo" });
    await crearDominio(dueno, hereda, { canonico: true });
    registrar("hereda", hereda, null);

    // Las que no sirven, una por motivo.
    const retirada = await crearMarcaLista(dueno, { nombreVisible: "Retirada" });
    await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [retirada.marca]);
    registrar("retirada", retirada.marca, "MARCA_RETIRADA");

    const sinVersion = await crearMarcaLista(dueno, { sinVersion: true });
    registrar("sinVersion", sinVersion.marca, "MARCA_SIN_DEFINICION");

    // Con versión vigente pero sin nombre propio: un producto no hereda el nombre.
    const sinNombre = await crearMarca(dueno, { codigo: "sin-nombre", padre: principal.marca });
    await crearVersionDeMarcaConfirmada(dueno, sinNombre, { nombreVisible: null });
    await crearDominio(dueno, sinNombre, { canonico: true });
    registrar("sinNombre", sinNombre, "MARCA_SIN_DEFINICION");

    const sinDominio = await crearMarcaLista(dueno, {
      sinDominio: true,
      nombreVisible: "Sin host",
    });
    registrar("sinDominio", sinDominio.marca, "MARCA_SIN_DOMINIO");

    // Con dominio, pero no activo: el alta mira el host canónico ACTIVO.
    const dominioPendiente = await crearMarcaLista(dueno, {
      sinDominio: true,
      nombreVisible: "Host pendiente",
    });
    await crearDominio(dueno, dominioPendiente.marca, {
      canonico: true,
      estado: "PENDIENTE_VERIFICACION",
    });
    registrar("dominioPendiente", dominioPendiente.marca, "MARCA_SIN_DOMINIO");

    // Plan por defecto: ninguno, sin versión publicada, retirado.
    const sinPlan = await crearMarca(dueno, { codigo: "sin-plan" });
    await crearVersionDeMarcaConfirmada(dueno, sinPlan, { nombreVisible: "Sin plan" });
    await crearDominio(dueno, sinPlan, { canonico: true });
    registrar("sinPlan", sinPlan, "MARCA_SIN_PLAN_POR_DEFECTO");

    const planSinPublicar = await crearPlan(dueno, "plan-sin-publicar");
    const sinVersionDePlan = await crearMarca(dueno, { codigo: "plan-sin-version" });
    await crearVersionDeMarcaConfirmada(dueno, sinVersionDePlan, {
      nombreVisible: "Plan sin versión",
      planPorDefecto: planSinPublicar,
      modulosIniciales: [],
    });
    await crearDominio(dueno, sinVersionDePlan, { canonico: true });
    registrar("planSinVersion", sinVersionDePlan, "MARCA_SIN_PLAN_POR_DEFECTO");

    const conPlanRetirado = await crearMarcaLista(dueno, { nombreVisible: "Plan retirado" });
    await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [conPlanRetirado.plan]);
    registrar("planRetirado", conPlanRetirado.marca, "MARCA_SIN_PLAN_POR_DEFECTO");
    // Y un plan nuevo y vivo de OTRA marca, para que no se mezclen.
    await crearPlanPublicado(dueno, { codigo: "plan-ajeno", modulos: [] });
  });

  afterAll(async () => {
    await dueno.end();
    await entornoDeConsultas.cerrar();
    await entornoDelAlta.cerrar();
    await propia.destruir();
  });

  const lista = async (): Promise<MarcaParaElAlta[]> => [
    ...exito(await consultas.marcasParaElAlta(comoAdminAhora())).marcas,
  ];
  const deLa = (marcas: readonly MarcaParaElAlta[], nombre: string) =>
    marcas.find((x) => x.marcaId === m[nombre]?.id);

  it("lista todas las marcas, por código, con su nombre propio", async () => {
    const marcas = await lista();
    const codigos = marcas.map((x) => x.codigo);
    expect(codigos).toEqual([...codigos].sort());
    expect(marcas).toHaveLength(Object.keys(m).length);
    for (const nombre of Object.keys(m)) expect(deLa(marcas, nombre), nombre).toBeDefined();
    expect(deLa(marcas, "principal")?.nombre).toBe("Principal");
    expect(deLa(marcas, "hereda")?.nombre).toBe("Hereda todo");
    // Sin versión vigente, o con una sin nombre, no hay nombre propio.
    expect(deLa(marcas, "sinVersion")?.nombre).toBeNull();
    expect(deLa(marcas, "sinNombre")?.nombre).toBeNull();
  });

  it("COINCIDENCIA: lo que dice la consulta es lo que responde el alta real, marca por marca", async () => {
    const marcas = await lista();
    const elegibles: string[] = [];
    const noElegibles: string[] = [];
    for (const marca of marcas) {
      const contexto = comoAdminDelAlta();
      const entrada = altaNueva(marca.marcaId);
      const r = await alta.altaDeEmpresa(contexto, entrada);
      const etiqueta = `${marca.codigo} (${marca.elegible ? "elegible" : String(marca.motivoSiNo)})`;
      if (marca.elegible) {
        expect(r.ok, etiqueta).toBe(true);
        expect(marca.motivoSiNo, etiqueta).toBeNull();
        elegibles.push(marca.codigo);
      } else {
        expect(r.ok, etiqueta).toBe(false);
        expect(r.ok ? null : r.error, etiqueta).toBe(marca.motivoSiNo);
        expect(marca.planPorDefecto, etiqueta).toBeNull();
        noElegibles.push(marca.codigo);
      }
    }
    // La prueba no es vacua: hay de las dos clases y de cada motivo.
    expect(elegibles.length).toBeGreaterThanOrEqual(3);
    const motivos = new Set(marcas.map((x) => x.motivoSiNo));
    for (const motivo of [
      "MARCA_RETIRADA",
      "MARCA_SIN_DEFINICION",
      "MARCA_SIN_DOMINIO",
      "MARCA_SIN_PLAN_POR_DEFECTO",
    ]) {
      expect(motivos.has(motivo as never), motivo).toBe(true);
    }
    expect(noElegibles.length).toBeGreaterThanOrEqual(7);
  });

  it("cada marca sembrada tiene el motivo que se esperaba", async () => {
    const marcas = await lista();
    for (const [nombre, esperada] of Object.entries(m)) {
      expect(deLa(marcas, nombre)?.motivoSiNo, nombre).toBe(esperada.motivo);
      expect(deLa(marcas, nombre)?.elegible, nombre).toBe(esperada.motivo === null);
    }
  });

  it("el plan por defecto que informa es la versión que el alta le asigna al tenant nuevo, y los módulos que propone", async () => {
    const marcas = await lista();
    for (const nombre of ["principal", "completo", "hereda"]) {
      const marca = deLa(marcas, nombre);
      expect(marca?.planPorDefecto, nombre).not.toBeNull();
      const r = exito(
        await alta.altaDeEmpresa(comoAdminDelAlta(), altaNueva(m[nombre]?.id as string)),
      );
      const { rows } = await dueno.query<{ version_de_plan_id: string }>(
        "select version_de_plan_id from plan_de_tenant where tenant_id = $1",
        [r.tenantId],
      );
      expect(
        rows.map((x) => x.version_de_plan_id),
        nombre,
      ).toEqual([marca?.planPorDefecto?.versionDePlanId]);
      const modulos = await dueno.query<{ modulo: string }>(
        "select modulo from modulo_de_empresa where empresa_id = $1 order by modulo",
        [r.empresaId],
      );
      // Los activados son los propuestos que el plan incluye (todos, en estos escenarios).
      expect(
        modulos.rows.map((x) => x.modulo),
        nombre,
      ).toEqual([...(marca?.modulosIniciales ?? [])].sort());
    }
  });

  it("informa el plan con su código, versión y nombre comercial; la que hereda trae el de la principal", async () => {
    const marcas = await lista();
    const principal = deLa(marcas, "principal");
    const hereda = deLa(marcas, "hereda");
    expect(principal?.planPorDefecto).toMatchObject({
      numero: 1,
      nombreComercial: "Plan de prueba",
    });
    expect(principal?.planPorDefecto?.codigo).toEqual(expect.stringMatching(/^p-/));
    expect(hereda?.planPorDefecto).toEqual(principal?.planPorDefecto);
    expect(hereda?.modulosIniciales).toEqual(["caja"]);
    expect(deLa(marcas, "completo")?.planPorDefecto?.planId).not.toBe(
      principal?.planPorDefecto?.planId,
    );
    expect(deLa(marcas, "completo")?.modulosIniciales).toEqual(["ventas", "caja"]);
  });

  it("una marca sin plan por defecto utilizable no deja de servir para un tenant que YA existe, ni con una versión elegida a mano", async () => {
    const marcas = await lista();
    expect(deLa(marcas, "sinPlan")?.motivoSiNo).toBe("MARCA_SIN_PLAN_POR_DEFECTO");
    // Eligiendo a mano una versión publicada, el alta por esa marca funciona: lo que falta es el DEFECTO.
    const { version } = await crearPlanPublicado(dueno, { codigo: "plan-elegido", modulos: [] });
    const r = await alta.altaDeEmpresa(
      comoAdminDelAlta(),
      altaNueva(m["sinPlan"]?.id as string, { versionDePlanId: version }),
    );
    expect(r.ok).toBe(true);
    // Las no elegibles por la marca misma siguen sin servir aunque se elija el plan.
    const retirada = await alta.altaDeEmpresa(
      comoAdminDelAlta(),
      altaNueva(m["retirada"]?.id as string, { versionDePlanId: version }),
    );
    expect(retirada).toEqual({ ok: false, error: "MARCA_RETIRADA" });
  });

  it("solo lee: no escribe, no audita y no toca claves; SOPORTE la ve y quien no es administrador vigente, no", async () => {
    const antes = await huellaDeEscrituras(dueno);
    exito(await consultas.marcasParaElAlta(comoAdminAhora()));
    exito(await consultas.marcasParaElAlta(comoSoporteAhora()));
    expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    const deBaja = await crearAdminDeBase(dueno, { rol: "ADMIN", activo: false });
    for (const contexto of [
      comoAdministradorAhora(deBaja.id),
      comoAdministradorAhora(adminInexistente()),
    ]) {
      expect(await consultas.marcasParaElAlta(contexto)).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
    }
  });

  it("retirar el plan de una marca no cambia lo que dicen las demás (y es la última prueba: un plan retirado no vuelve)", async () => {
    // Retirar el plan por defecto de «completo» no toca a «principal» ni a «hereda».
    const antes = await lista();
    const planDelCompleto = deLa(antes, "completo")?.planPorDefecto?.planId;
    await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [planDelCompleto]);
    const despues = await lista();
    expect(deLa(despues, "completo")?.motivoSiNo).toBe("MARCA_SIN_PLAN_POR_DEFECTO");
    expect(deLa(despues, "principal")?.elegible).toBe(true);
    expect(deLa(despues, "hereda")?.elegible).toBe(true);
    const r = await alta.altaDeEmpresa(comoAdminDelAlta(), altaNueva(m["completo"]?.id as string));
    expect(r).toEqual({ ok: false, error: "MARCA_SIN_PLAN_POR_DEFECTO" });
  });
});
