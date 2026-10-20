import { describe, expect, it } from "vitest";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import type { MarcaGuardada } from "../../src/modulos/marcas/publico";
import type {
  RepositorioDePlanes,
  TenantConLaVersionVigente,
  VersionDePlanGuardada,
} from "../../src/modulos/planes/publico";
import {
  crearConsultasDeMarcasYPlanes,
  type ConsultasDeMarcasYPlanes,
} from "../../src/plataforma/consultas/consultas-de-marcas-y-planes";
import type { TxDeConsultasDeMarcasYPlanes } from "../../src/plataforma/consultas/contrato-de-marcas-y-planes";
import {
  marcaComercialId,
  tenantId,
  versionDePlanId,
} from "../../src/primitivas/identificadores/marca";
import { MODULOS_DE_PRUEBA, PERILLAS_DE_PRUEBA } from "../utilidades/planes";
import { AHORA, comoAdministrador, conRol, transaccionesDe, uuid } from "./apoyo-de-soporte";

/**
 * `tenantsConLaVersion` sin base de datos: el orden de las validaciones, qué le pide al repositorio y cómo
 * arma la página. Que la sentencia diga lo que tiene que decir está en `test/integracion/tenants-con-la-version.test.ts`.
 */

const MARCA = marcaComercialId(uuid(50));
const fila = (n: number): TenantConLaVersionVigente => ({
  tenantId: tenantId(uuid(n)),
  nombre: `Tenant ${n}`,
  estado: "ACTIVE",
  marcaId: MARCA,
  ultimoNumeroDeAsignacion: n,
  hayProgramada: n % 2 === 0,
  empresas: n,
});

function armar(filas: TenantConLaVersionVigente[], existeLaVersion = true) {
  const pedidos: unknown[][] = [];
  const planes = {
    versionPorId: (id: unknown) => {
      pedidos.push(["versionPorId", id]);
      return Promise.resolve(existeLaVersion ? ({ id } as unknown as VersionDePlanGuardada) : null);
    },
    tenantsConLaVersionVigente: (...a: unknown[]) => {
      pedidos.push(["tenantsConLaVersionVigente", ...a]);
      return Promise.resolve(filas);
    },
  } as unknown as RepositorioDePlanes;
  const marcas = {
    listar: () => {
      pedidos.push(["listar"]);
      return Promise.resolve([
        { id: MARCA, codigo: "marca-de-prueba" } as unknown as MarcaGuardada,
      ]);
    },
  };
  const tx = {
    autorizacionDePlataforma: conRol("SOPORTE"),
    planes,
    marcas,
  } as unknown as TxDeConsultasDeMarcasYPlanes;
  const consultas: ConsultasDeMarcasYPlanes = crearConsultasDeMarcasYPlanes({
    transacciones: transaccionesDe(tx),
    reglas: REGLAS_DE_PLATAFORMA,
    catalogoDeModulos: MODULOS_DE_PRUEBA,
    catalogoDePerillas: PERILLAS_DE_PRUEBA,
  });
  return { consultas, pedidos };
}

describe("tenantsConLaVersion", () => {
  it("arma las filas con el código de la marca y deja el cursor si la página llegó llena", async () => {
    const { consultas, pedidos } = armar([fila(1), fila(2)]);
    const r = await consultas.tenantsConLaVersion(comoAdministrador, {
      versionDePlanId: uuid(9).toUpperCase(),
      limite: 2,
    });
    expect(r).toEqual({
      ok: true,
      valor: {
        filas: [
          {
            tenantId: uuid(1),
            nombre: "Tenant 1",
            estado: "ACTIVE",
            marcaId: MARCA,
            marcaCodigo: "marca-de-prueba",
            ultimoNumeroDeAsignacion: 1,
            hayProgramada: false,
            empresas: 1,
          },
          {
            tenantId: uuid(2),
            nombre: "Tenant 2",
            estado: "ACTIVE",
            marcaId: MARCA,
            marcaCodigo: "marca-de-prueba",
            ultimoNumeroDeAsignacion: 2,
            hayProgramada: true,
            empresas: 2,
          },
        ],
        siguienteDespuesDeId: uuid(2),
      },
    });
    // Pide la versión normalizada, a la hora del contexto y con la página validada.
    expect(pedidos).toEqual([
      ["versionPorId", versionDePlanId(uuid(9))],
      [
        "tenantsConLaVersionVigente",
        versionDePlanId(uuid(9)),
        AHORA,
        { limite: 2, despuesDeId: null },
      ],
      ["listar"],
    ]);
  });

  it("pasa el cursor normalizado; una página corta no tiene siguiente", async () => {
    const { consultas, pedidos } = armar([fila(3)]);
    const r = await consultas.tenantsConLaVersion(comoAdministrador, {
      versionDePlanId: uuid(9),
      limite: 5,
      despuesDeId: uuid(2).toUpperCase(),
    });
    expect(r.ok && r.valor.siguienteDespuesDeId).toBeNull();
    expect(pedidos[1]).toEqual([
      "tenantsConLaVersionVigente",
      versionDePlanId(uuid(9)),
      AHORA,
      { limite: 5, despuesDeId: tenantId(uuid(2)) },
    ]);
  });

  it("las entradas inválidas son errores con nombre y no leen nada", async () => {
    const { consultas, pedidos } = armar([]);
    const pedir = (entrada: { versionDePlanId: string; limite?: number; despuesDeId?: string }) =>
      consultas.tenantsConLaVersion(comoAdministrador, entrada);
    expect(await pedir({ versionDePlanId: "x" })).toEqual({ ok: false, error: "ID_INVALIDO" });
    expect(await pedir({ versionDePlanId: uuid(9), limite: 0 })).toEqual({
      ok: false,
      error: "LIMITE_INVALIDO",
    });
    expect(await pedir({ versionDePlanId: uuid(9), despuesDeId: "x" })).toEqual({
      ok: false,
      error: "CURSOR_INVALIDO",
    });
    // La página se mira antes que el id, como en las demás listas.
    expect(await pedir({ versionDePlanId: "x", limite: 101 })).toEqual({
      ok: false,
      error: "LIMITE_INVALIDO",
    });
    expect(pedidos).toEqual([]);
  });

  it("una versión que no existe es VERSION_DE_PLAN_NO_ENCONTRADA y no pide la lista", async () => {
    const { consultas, pedidos } = armar([fila(1)], false);
    expect(
      await consultas.tenantsConLaVersion(comoAdministrador, { versionDePlanId: uuid(9) }),
    ).toEqual({
      ok: false,
      error: "VERSION_DE_PLAN_NO_ENCONTRADA",
    });
    expect(pedidos.map((p) => p[0])).toEqual(["versionPorId"]);
  });

  it("un tenant cuya marca no existe es un defecto de datos: lanza, no inventa un código", async () => {
    const huerfano = { ...fila(1), marcaId: uuid(77) };
    const { consultas } = armar([huerfano]);
    await expect(
      consultas.tenantsConLaVersion(comoAdministrador, { versionDePlanId: uuid(9) }),
    ).rejects.toThrow(RangeError);
  });
});
