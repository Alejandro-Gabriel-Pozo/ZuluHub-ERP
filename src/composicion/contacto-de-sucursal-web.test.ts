import { describe, expect, it } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../test/utilidades/marcas";
import type { ContextoOperativo } from "../contexto/contexto";
import { empresaId, personaId, sucursalId } from "../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import {
  editarContactoDeSucursal,
  fichaDeContactoDeSucursal,
  type DependenciasDeSucursalWeb,
} from "./contacto-de-sucursal-web";

/**
 * Lo que agrega la composición al contacto de la sucursal: validar el pedido, resolver la sucursal contra el alcance ANTES de leer o
 * escribir, mandar el nombre que leyó el servidor (nunca uno del navegador), la lista blanca de lo que sale y cómo se traduce cada
 * error. El permiso, el aislamiento por empresa, la versión y la auditoría son del dominio: se prueban con la base real en
 * `test/integracion/sucursales-contacto-web.test.ts`; acá las consultas y el caso de uso son falsos.
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date("2026-11-04T12:00:00.000Z"),
};
const ID = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";
const SIN_CONTACTO = { telefono: null, correo: null, web: null };

type Llamadas = {
  elegibles: number;
  fichas: unknown[];
  ediciones: Record<string, unknown>[];
};

function con(
  opciones: {
    elegibles?: readonly { id: string; activa: boolean }[];
    ficha?: Resultado<unknown, unknown>;
    edicion?: Resultado<unknown, unknown>;
  } = {},
) {
  const llamadas: Llamadas = { elegibles: 0, fichas: [], ediciones: [] };
  const registrados: string[] = [];
  const ficha = {
    id: sucursalId(ID),
    nombre: "Casa central",
    activa: true,
    horaDeCorte: "00:00",
    contacto: { ...SIN_CONTACTO, telefono: "+54 11 4321-0000" },
    version: 3,
    zonaHoraria: "America/Argentina/Buenos_Aires",
  };
  const d: DependenciasDeSucursalWeb = {
    casosDeUso: () =>
      ({
        editarSucursal: (_c: ContextoOperativo, entrada: Record<string, unknown>) => {
          llamadas.ediciones.push(entrada);
          return Promise.resolve(opciones.edicion ?? ok({ version: 4 }));
        },
      }) as unknown as ReturnType<DependenciasDeSucursalWeb["casosDeUso"]>,
    consultas: () =>
      ({
        sucursalesElegibles: () => {
          llamadas.elegibles += 1;
          return Promise.resolve(
            ok(
              (opciones.elegibles ?? [{ id: ID, activa: true }]).map((s) => ({
                ...s,
                id: sucursalId(s.id),
                nombre: "x",
              })),
            ),
          );
        },
        fichaDeSucursal: (_c: ContextoOperativo, pedido: unknown) => {
          llamadas.fichas.push(pedido);
          return Promise.resolve(opciones.ficha ?? ok(ficha));
        },
      }) as unknown as ReturnType<DependenciasDeSucursalWeb["consultas"]>,
    respuesta: { registrar: (x) => registrados.push(x), azar: () => new Uint8Array([1, 2, 3, 4]) },
  };
  return { d, llamadas, registrados };
}

describe("fichaDeContactoDeSucursal", () => {
  it("devuelve solo id, nombre, contacto y versión (lista blanca)", async () => {
    const { d, llamadas } = con();
    const r = await fichaDeContactoDeSucursal(d, contexto, { sucursalId: ID });
    expect(r).toEqual({
      ok: true,
      dato: {
        id: ID,
        nombre: "Casa central",
        contacto: { telefono: "+54 11 4321-0000", correo: null, web: null },
        version: 3,
      },
    });
    expect(llamadas.fichas).toEqual([{ sucursalId: ID }]);
  });

  it.each([
    ["sin pedido", undefined],
    ["un texto", ID],
    ["un id que no es un identificador", { sucursalId: "no-es-un-id" }],
    ["un id que no es texto", { sucursalId: 7 }],
  ])("%s: «Revisá los datos marcados.» y no se consulta nada", async (_caso, crudo) => {
    const { d, llamadas } = con();
    const r = await fichaDeContactoDeSucursal(d, contexto, crudo);
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS" },
    });
    expect(llamadas.elegibles + llamadas.fichas.length).toBe(0);
  });

  it("una sucursal que no está entre las que la persona puede elegir: fuera de alcance, sin leer su ficha", async () => {
    const { d, llamadas } = con();
    const r = await fichaDeContactoDeSucursal(d, contexto, { sucursalId: OTRA });
    expect(r).toMatchObject({ ok: false, error: { codigo: "FISCAL_SUCURSAL_FUERA_DE_ALCANCE" } });
    expect(llamadas.fichas).toEqual([]);
  });

  it("sin elegir y con varias para elegir: no se asume «todas»", async () => {
    const { d, llamadas } = con({
      elegibles: [
        { id: ID, activa: true },
        { id: OTRA, activa: true },
      ],
    });
    const r = await fichaDeContactoDeSucursal(d, contexto, {});
    expect(r).toMatchObject({ ok: false, error: { codigo: "FISCAL_SUCURSAL_NO_ELEGIDA" } });
    expect(llamadas.fichas).toEqual([]);
  });

  it("sin elegir y con una sola abierta: la toma el servidor (la regla del listado)", async () => {
    const { d, llamadas } = con();
    const r = await fichaDeContactoDeSucursal(d, contexto, { sucursalId: null });
    expect(r.ok).toBe(true);
    expect(llamadas.fichas).toEqual([{ sucursalId: ID }]);
  });

  it("sin ninguna que elegir: fuera de alcance", async () => {
    const { d } = con({ elegibles: [] });
    expect(await fichaDeContactoDeSucursal(d, contexto, { sucursalId: ID })).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_SUCURSAL_FUERA_DE_ALCANCE" },
    });
  });

  it("una ficha que no existe en la empresa se dice como una fuera de alcance (misma respuesta)", async () => {
    const { d } = con({ ficha: ok(null) });
    expect(await fichaDeContactoDeSucursal(d, contexto, { sucursalId: ID })).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_SUCURSAL_FUERA_DE_ALCANCE" },
    });
  });

  it("el motivo del guard pasa tal cual", async () => {
    const { d } = con({ ficha: err("SIN_PERMISO") });
    expect(await fichaDeContactoDeSucursal(d, contexto, { sucursalId: ID })).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
  });
});

describe("editarContactoDeSucursal", () => {
  it("manda al caso de uso el nombre que leyó el servidor y los datos pedidos; el nombre, la empresa y la hora del navegador se descartan", async () => {
    const { d, llamadas } = con();
    const r = await editarContactoDeSucursal(d, contexto, {
      sucursalId: ID,
      versionEsperada: 3,
      telefono: "+54 11 4321-9999",
      correo: null,
      nombre: "Nombre del navegador",
      empresaId: "OTRA-EMPRESA",
      horaDeCorte: "05:00",
    });
    expect(r).toEqual({ ok: true, dato: { version: 4 } });
    expect(llamadas.ediciones).toEqual([
      {
        sucursalId: ID,
        versionEsperada: 3,
        nombre: "Casa central",
        telefono: "+54 11 4321-9999",
        correo: null,
        web: undefined,
      },
    ]);
  });

  it("la versión puede venir como texto de dígitos (un formulario)", async () => {
    const { d, llamadas } = con();
    await editarContactoDeSucursal(d, contexto, { sucursalId: ID, versionEsperada: "3" });
    expect(llamadas.ediciones[0]).toMatchObject({ versionEsperada: 3 });
  });

  it.each([
    ["sin pedido", undefined],
    ["sin versión", { sucursalId: ID }],
    ["versión negativa", { sucursalId: ID, versionEsperada: -1 }],
    ["versión decimal", { sucursalId: ID, versionEsperada: "3.5" }],
    ["un teléfono que no es texto", { sucursalId: ID, versionEsperada: 1, telefono: 5 }],
    ["un correo enorme", { sucursalId: ID, versionEsperada: 1, correo: "a".repeat(1001) }],
    ["un id que no es un identificador", { sucursalId: "x", versionEsperada: 1 }],
  ])("%s: «Revisá los datos marcados.» y no se toca nada", async (_caso, crudo) => {
    const { d, llamadas } = con();
    const r = await editarContactoDeSucursal(d, contexto, crudo);
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS" },
    });
    expect(llamadas.elegibles + llamadas.fichas.length + llamadas.ediciones.length).toBe(0);
  });

  it("una sucursal fuera de alcance no llega al caso de uso", async () => {
    const { d, llamadas } = con();
    const r = await editarContactoDeSucursal(d, contexto, { sucursalId: OTRA, versionEsperada: 1 });
    expect(r).toMatchObject({ ok: false, error: { codigo: "FISCAL_SUCURSAL_FUERA_DE_ALCANCE" } });
    expect(llamadas.ediciones).toEqual([]);
  });

  it.each([
    ["TELEFONO_DE_SUCURSAL_INVALIDO", "telefono"],
    ["CORREO_DE_SUCURSAL_INVALIDO", "correo"],
    ["WEB_DE_SUCURSAL_INVALIDA", "web"],
  ])("%s: «Revisá los datos marcados.» con el campo %s", async (error, campo) => {
    const { d } = con({ edicion: err(error) });
    const r = await editarContactoDeSucursal(d, contexto, { sucursalId: ID, versionEsperada: 3 });
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo },
    });
  });

  it("la versión vieja sale con el texto ya aprobado de «versión desactualizada»", async () => {
    const { d } = con({ edicion: err("VERSION_DESACTUALIZADA") });
    expect(
      await editarContactoDeSucursal(d, contexto, { sucursalId: ID, versionEsperada: 1 }),
    ).toMatchObject({ ok: false, error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" } });
  });

  it.each(["SIN_PERMISO", "MODULO_NO_ACTIVO", "EMPRESA_NO_OPERA"])(
    "el motivo %s pasa por el camino común",
    async (motivo) => {
      const { d } = con({ edicion: err(motivo) });
      const r = await editarContactoDeSucursal(d, contexto, { sucursalId: ID, versionEsperada: 3 });
      expect(r.ok).toBe(false);
    },
  );

  it.each([
    ["una sucursal que desapareció en el medio", err("SUCURSAL_NO_ENCONTRADA")],
    ["un nombre que no pasa", err("NOMBRE_DE_SUCURSAL_INVALIDO")],
    ["un nombre repetido", err("SUCURSAL_DUPLICADA")],
    [
      "un fallo de la base",
      err({ tipo: "Inesperado", sqlstate: "XX000", mensaje: "relation sucursal secreta" }),
    ],
  ])("%s: error inesperado con referencia y sin detalle", async (_caso, edicion) => {
    const { d, registrados } = con({ edicion });
    const r = await editarContactoDeSucursal(d, contexto, { sucursalId: ID, versionEsperada: 3 });
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO", referencia: "PD-0102-0304" },
    });
    expect(JSON.stringify(r)).not.toMatch(/secreta|XX000|relation/);
    expect(registrados).toHaveLength(1);
  });

  it("una excepción sale sin detalle", async () => {
    const { d } = con();
    const roto: DependenciasDeSucursalWeb = {
      ...d,
      consultas: () => {
        throw new Error("clave SECRETO en el mensaje");
      },
    };
    const r = await editarContactoDeSucursal(roto, contexto, {
      sucursalId: ID,
      versionEsperada: 3,
    });
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("SECRETO");
  });
});
