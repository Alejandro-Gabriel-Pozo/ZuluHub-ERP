import { describe, expect, it } from "vitest";
import type { ContextoDeSesion } from "../../../contexto/contexto";
import {
  empresaId,
  marcaComercialId,
  personaId,
  usuarioAuthId,
} from "../../../primitivas/identificadores/marca";
import { ok } from "../../../primitivas/resultado/resultado";
import type { EmpresaDeLaSesion, LecturasDeSesion } from "../../../puertos/sesion";
import type { OpcionesDeTransaccion, Transacciones } from "../../../puertos/transacciones";
import { crearConsultasDeSesion, type TxDeConsultasDeSesion } from "./de-la-sesion";

const USUARIO = usuarioAuthId("11111111-1111-4111-8111-111111111111");
const MARCA = marcaComercialId("33333333-3333-4333-8333-333333333333");
const CONTEXTO: ContextoDeSesion = { tipo: "SESION", usuarioAuth: USUARIO, ahora: new Date(0) };

const empresa = (
  id: string,
  nombre: string,
  extra: Partial<EmpresaDeLaSesion> = {},
): EmpresaDeLaSesion => ({
  empresaId: empresaId(id),
  nombre,
  rol: "OPERADOR",
  estado: "ACTIVE",
  estadoDelTenant: "ACTIVE",
  ...extra,
});

/** Una transacción falsa que anota las opciones con las que se abrió y las llamadas al puerto. */
function armar(lecturas: Partial<LecturasDeSesion>) {
  const abiertas: OpcionesDeTransaccion[] = [];
  const llamadas: unknown[][] = [];
  const sesion: LecturasDeSesion = {
    personaDelUsuario: (...args) => {
      llamadas.push(["personaDelUsuario", ...args]);
      return lecturas.personaDelUsuario?.(...args) ?? Promise.resolve(null);
    },
    empresasDelUsuario: (...args) => {
      llamadas.push(["empresasDelUsuario", ...args]);
      return lecturas.empresasDelUsuario?.(...args) ?? Promise.resolve([]);
    },
  };
  const transacciones: Transacciones<TxDeConsultasDeSesion> = {
    ejecutar: (opciones, trabajo) => {
      abiertas.push(opciones);
      return trabajo({ sesion }).then((r) => r);
    },
  };
  return { consultas: crearConsultasDeSesion({ transacciones }), abiertas, llamadas };
}

describe("personaDeLaSesion", () => {
  it("devuelve la persona del usuario de la sesión, y nada más que su id", async () => {
    const { consultas, llamadas } = armar({
      personaDelUsuario: () => Promise.resolve(personaId("p-1")),
    });
    expect(await consultas.personaDeLaSesion(CONTEXTO)).toEqual({
      ok: true,
      valor: { personaId: "p-1" },
    });
    expect(llamadas).toEqual([["personaDelUsuario", USUARIO]]);
  });

  it("sin persona vinculada devuelve ok con null (no es un error: el usuario todavía no aceptó ninguna invitación)", async () => {
    const { consultas } = armar({ personaDelUsuario: () => Promise.resolve(null) });
    expect(await consultas.personaDeLaSesion(CONTEXTO)).toEqual({ ok: true, valor: null });
  });

  it("corre en una transacción de solo lectura con el contexto de la sesión", async () => {
    const { consultas, abiertas } = armar({});
    await consultas.personaDeLaSesion(CONTEXTO);
    expect(abiertas).toEqual([
      { contexto: CONTEXTO, aislamiento: "read committed", soloLectura: true },
    ]);
  });
});

describe("empresasDeLaSesion", () => {
  it("pide las empresas del usuario en la marca de la puerta", async () => {
    const { consultas, llamadas } = armar({});
    await consultas.empresasDeLaSesion(CONTEXTO, { marcaId: MARCA });
    expect(llamadas).toEqual([["empresasDelUsuario", USUARIO, MARCA]]);
  });

  it("corre en una transacción de solo lectura con el contexto de la sesión", async () => {
    const { consultas, abiertas } = armar({});
    await consultas.empresasDeLaSesion(CONTEXTO, { marcaId: MARCA });
    expect(abiertas).toEqual([
      { contexto: CONTEXTO, aislamiento: "read committed", soloLectura: true },
    ]);
  });

  it("ordena por nombre (por código de carácter: las mayúsculas antes) y, a igual nombre, por empresa; copia solo lo que la pantalla necesita", async () => {
    const { consultas } = armar({
      empresasDelUsuario: () =>
        Promise.resolve([
          empresa("e-3", "Beta"),
          empresa("e-2", "Alfa", { rol: "GERENTE" }),
          empresa("e-1", "Beta"),
          empresa("e-0", "alfa"),
        ]),
    });
    const r = await consultas.empresasDeLaSesion(CONTEXTO, { marcaId: MARCA });
    expect(r).toEqual({
      ok: true,
      valor: [
        {
          empresaId: "e-2",
          nombre: "Alfa",
          rol: "GERENTE",
          estado: "ACTIVE",
          estadoEfectivo: "OPERA",
        },
        {
          empresaId: "e-1",
          nombre: "Beta",
          rol: "OPERADOR",
          estado: "ACTIVE",
          estadoEfectivo: "OPERA",
        },
        {
          empresaId: "e-3",
          nombre: "Beta",
          rol: "OPERADOR",
          estado: "ACTIVE",
          estadoEfectivo: "OPERA",
        },
        {
          empresaId: "e-0",
          nombre: "alfa",
          rol: "OPERADOR",
          estado: "ACTIVE",
          estadoEfectivo: "OPERA",
        },
      ],
    });
    // Ningún campo de más (por ejemplo, el estado del tenant sin procesar).
    if (r.ok)
      expect(Object.keys(r.valor[0] ?? {}).sort()).toEqual([
        "empresaId",
        "estado",
        "estadoEfectivo",
        "nombre",
        "rol",
      ]);
  });

  it("el estado efectivo combina empresa y tenant: un tenant suspendido arrastra a sus empresas", async () => {
    const { consultas } = armar({
      empresasDelUsuario: () =>
        Promise.resolve([
          empresa("e-1", "A", { estadoDelTenant: "SUSPENDED" }),
          empresa("e-2", "B", { estado: "PROVISIONING" }),
          empresa("e-3", "C", { estado: "SUSPENDED" }),
          empresa("e-4", "D", { estado: "CANCELLED" }),
          empresa("e-5", "E", { estado: "DELETING" }),
          empresa("e-6", "F", { estado: "CANCELLED", estadoDelTenant: "SUSPENDED" }),
        ]),
    });
    const r = await consultas.empresasDeLaSesion(CONTEXTO, { marcaId: MARCA });
    expect(r.ok && r.valor.map((e) => [e.empresaId, e.estado, e.estadoEfectivo])).toEqual([
      ["e-1", "ACTIVE", "TENANT_SUSPENDIDO"],
      ["e-2", "PROVISIONING", "EMPRESA_EN_ALTA"],
      ["e-3", "SUSPENDED", "EMPRESA_SUSPENDIDA"],
      ["e-4", "CANCELLED", "EMPRESA_CANCELADA"],
      ["e-5", "DELETING", "EMPRESA_EN_BAJA"],
      ["e-6", "CANCELLED", "EMPRESA_CANCELADA"],
    ]);
  });

  it("sin empresas devuelve la lista vacía, no un error", async () => {
    const { consultas } = armar({ empresasDelUsuario: () => Promise.resolve([]) });
    expect(await consultas.empresasDeLaSesion(CONTEXTO, { marcaId: MARCA })).toEqual(ok([]));
  });
});
