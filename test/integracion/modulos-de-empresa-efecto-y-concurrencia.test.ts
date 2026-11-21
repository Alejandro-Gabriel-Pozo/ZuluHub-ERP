import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { crearConsultasDeEmpresas } from "../../src/modulos/empresas/publico";
import { empresaId, marcaComercialId, personaId } from "../../src/primitivas/identificadores/marca";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";
import { asignarPlan, crearMundoDeMarca, crearPlanPublicado } from "./marcas-apoyo";
import {
  auditoriaDePlataformaDe,
  clave,
  comoAdminAhora,
  crearCasosDeMarcasYPlanes,
  crearEntornoDeMarcasYPlanes,
  exito,
  falla,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * Activar y desactivar módulos desde la consola, lo que la pantalla no puede garantizar sola: dos pedidos a la vez
 * (el mismo módulo, o un módulo y el que lo necesita) y lo que ve la empresa después (`permisosDelActor`), sin tocar
 * a otra empresa del mismo cliente. Base propia.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("módulos de empresa: concurrencia y efecto en la empresa", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
  let casos: CasosDeUsoDeMarcasYPlanes;
  let operativo: ReturnType<typeof crearEntornoDePrueba>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeMarcasYPlanes(propia.base);
    casos = crearCasosDeMarcasYPlanes(entorno);
    operativo = crearEntornoDePrueba(propia.base, 3);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await operativo.cerrar();
    await propia.destruir();
  });

  /** Un cliente con dos empresas y un plan que incluye caja y ventas. */
  async function escenario() {
    const primera = await crearMundoDeMarca(dueno);
    const segunda = await crearMundoDeMarca(dueno, { tenant: primera.tenant });
    const plan = await crearPlanPublicado(dueno, { modulos: ["caja", "ventas"] });
    await asignarPlan(dueno, primera.tenant, plan.version);
    return { empresa: primera.empresa, otraEmpresa: segunda.empresa, marca: primera.marca };
  }
  const activar = (empresa: string, modulo: string, claveDeIdempotencia = clave()) =>
    casos.activarModuloDeEmpresa(comoAdminAhora(), {
      claveDeIdempotencia,
      empresaId: empresa,
      modulo,
    });
  const desactivar = (empresa: string, modulo: string, claveDeIdempotencia = clave()) =>
    casos.desactivarModuloDeEmpresa(comoAdminAhora(), {
      claveDeIdempotencia,
      empresaId: empresa,
      modulo,
    });
  const activos = async (empresa: string) =>
    (
      await dueno.query<{ modulo: string }>(
        "select modulo from modulo_de_empresa where empresa_id = $1 and activo order by modulo",
        [empresa],
      )
    ).rows.map((f) => f.modulo);

  /** Una persona de la empresa (administrador) y lo que `permisosDelActor` dice de sus módulos activos. */
  async function personaDe(empresa: string, marca: string) {
    const persona = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, persona.id, "ADMINISTRADOR");
    const contexto: ContextoOperativo = {
      tipo: "OPERATIVO",
      empresaId: empresaId(empresa),
      personaId: personaId(persona.id),
      marcaDeEntrada: marcaComercialId(marca),
      ahora: new Date(),
    };
    const consultas = crearConsultasDeEmpresas({
      transacciones: operativo,
      reglas: REGLAS_DE_EMPRESA,
    });
    return async () => {
      const permisos = exito(await consultas.permisosDelActor(contexto));
      return permisos.modulos.activos as readonly string[];
    };
  }

  it("dos activaciones del mismo módulo a la vez, con claves distintas: una fila, una constancia y las dos responden bien", async () => {
    const { empresa } = await escenario();
    const [a, b] = await Promise.all([activar(empresa, "caja"), activar(empresa, "caja")]);
    const salidas = [exito(a), exito(b)].map((s) => s.yaEstabaActivo).sort();
    // Una escribió; la otra se encontró el módulo ya activo.
    expect(salidas).toEqual([false, true]);
    expect(await activos(empresa)).toEqual(["caja"]);
    expect(
      await auditoriaDePlataformaDe(dueno, "modulo_de_empresa", `${empresa}:caja`),
    ).toHaveLength(1);
  });

  it("activar ventas mientras se desactiva caja (que ventas necesita): uno se rechaza; nunca queda «ventas activo y caja inactivo»", async () => {
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const { empresa } = await escenario();
      exito(await activar(empresa, "caja"));
      const [conVentas, sinCaja] = await Promise.all([
        activar(empresa, "ventas"),
        desactivar(empresa, "caja"),
      ]);
      const hechos = [conVentas.ok, sinCaja.ok].filter(Boolean).length;
      expect(hechos).toBe(1);
      // Quien pierde dice por qué: el módulo que falta o el que lo necesita.
      if (!conVentas.ok)
        expect(falla(conVentas)).toEqual({ codigo: "REQUIERE_INACTIVO", modulo: "caja" });
      if (!sinCaja.ok)
        expect(falla(sinCaja)).toEqual({ codigo: "ES_REQUERIDO_POR", modulo: "ventas" });
      const quedan = await activos(empresa);
      expect(quedan.includes("ventas") && !quedan.includes("caja")).toBe(false);
    }
  });

  it("después de activar, la persona de esa empresa ve el módulo; después de desactivar, no; y otra empresa del mismo cliente no cambia", async () => {
    const { empresa, otraEmpresa, marca } = await escenario();
    const deLaEmpresa = await personaDe(empresa, marca);
    const deLaOtra = await personaDe(otraEmpresa, marca);
    expect(await deLaEmpresa()).not.toContain("caja");
    expect(await deLaOtra()).not.toContain("caja");

    exito(await activar(empresa, "caja"));
    expect(await deLaEmpresa()).toContain("caja");
    expect(await deLaOtra()).not.toContain("caja");

    exito(await desactivar(empresa, "caja"));
    expect(await deLaEmpresa()).not.toContain("caja");
    expect(await deLaOtra()).not.toContain("caja");
    // Nada se borró: la fila sigue, inactiva, y reactivar la devuelve.
    exito(await activar(empresa, "caja"));
    expect(await deLaEmpresa()).toContain("caja");
  });
});
