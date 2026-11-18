import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";

/**
 * `apps/web/servidor/salon.ts`, la cuenta de mesa (S-0r): la sucursal la fija el SERVIDOR (la efectiva del dispositivo) y del pedido del navegador solo se toman las claves declaradas. Sin sucursal (`efectiva`
 * vacía) no se asume «todas»: cierra con el genérico y no llama a ninguna consulta ni caso de uso. La composición es la real (`src/composicion/cuenta-de-mesa-web.ts`); las consultas y los casos de uso son falsos
 * (con la base real se prueban en `test/integracion/cuenta-de-mesa-web.test.ts`).
 * Previene: abrir, liberar o mover la cuenta de una mesa en una sucursal que la persona no eligió, o en «todas».
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`REDIRECT ${ruta}`);
  },
}));
const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const SUCURSAL = "33333333-3333-4333-8333-333333333333";
const MESA = "11111111-1111-4111-8111-111111111111";
const DESTINO = "44444444-4444-4444-8444-444444444444";
const CUENTA = "22222222-2222-4222-8222-222222222222";
const mundo = vi.hoisted(
  (): { efectiva: string; llamadas: { caso: string; entrada: Record<string, unknown> }[] } => ({
    efectiva: "",
    llamadas: [],
  }),
);
const caso =
  (nombre: string, valor: unknown) => (_contexto: unknown, entrada: Record<string, unknown>) => {
    mundo.llamadas.push({ caso: nombre, entrada });
    return Promise.resolve({ ok: true, valor });
  };
vi.mock("../../apps/web/servidor/composicion", () => ({
  web: {
    casosDeUsoDeSalon: () => ({
      tomarPedido: caso("tomarPedido", {
        cuentaId: "22222222-2222-4222-8222-222222222222",
        yaExistia: false,
      }),
      liberarMesa: caso("liberarMesa", { yaEstabaLibre: false }),
      cambiarDeMesa: caso("cambiarDeMesa", { yaExistia: false }),
    }),
    consultasDeSalon: () => ({
      mapaDeMesas: (_c: unknown, entrada: Record<string, unknown>) => {
        mundo.llamadas.push({ caso: "mapaDeMesas", entrada });
        return Promise.resolve({
          ok: true,
          valor: [
            {
              mesaId: "11111111-1111-4111-8111-111111111111",
              numero: 1,
              forma: "CUADRADA",
              tamano: "CHICA",
              columna: 1,
              fila: 1,
              estado: "EN_PEDIDO",
              cuentaId: "22222222-2222-4222-8222-222222222222",
              total: { moneda: "ARS", monto: "10.00" },
              secreto: "no sale",
            },
            {
              mesaId: "44444444-4444-4444-8444-444444444444",
              numero: 2,
              forma: "CUADRADA",
              tamano: "CHICA",
              columna: 3,
              fila: 1,
              estado: "LIBRE",
            },
          ],
        });
      },
      fichaDeMesa: caso("fichaDeMesa", {
        mesaId: "11111111-1111-4111-8111-111111111111",
        numero: 1,
        estado: "EN_PEDIDO",
        unidaAMesa: null,
        cuentas: [],
      }),
    }),
  },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: { registrar: () => undefined, azar: () => new Uint8Array(4) },
  },
}));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => unknown) => hacer(CONTEXTO),
}));
vi.mock("../../apps/web/servidor/sucursal-elegida", () => ({
  sucursalDelPedido: () =>
    Promise.resolve({ ok: true, dato: { elegida: null, efectiva: mundo.efectiva } }),
}));

const RUTA = "../../apps/web/servidor/salon";
type Accion = (crudo?: unknown) => Promise<unknown>;
type Salon = {
  cargarElMapaDeMesas: Accion;
  cargarLaFichaDeLaMesa: Accion;
  tomarElPedidoDeLaMesa: Accion;
  liberarLaMesaDelSalon: Accion;
  cambiarDeMesaLaCuentaDelSalon: Accion;
  nuevoIdDeCuentaDeMesa: () => string;
};
const cargar = () => import(/* @vite-ignore */ RUTA) as Promise<Salon>;
const GENERICO = { ok: false, error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA") };

beforeEach(() => {
  mundo.efectiva = SUCURSAL;
  mundo.llamadas = [];
});

describe("servidor del salón: cuenta de mesa", () => {
  it("el mapa pide la sucursal del servidor y deja salir solo lo declarado", async () => {
    const { cargarElMapaDeMesas } = await cargar();
    const r = (await cargarElMapaDeMesas({ filtro: "LIBRES", sucursalId: "otra" })) as {
      ok: boolean;
      dato: { mesas: object[] };
    };
    expect(r.ok).toBe(true);
    expect(mundo.llamadas).toEqual([
      { caso: "mapaDeMesas", entrada: { sucursalId: SUCURSAL, filtro: "LIBRES" } },
    ]);
    expect(Object.keys(r.dato.mesas[0] ?? {})).not.toContain("secreto");
  });

  it("«Tomar pedido» lleva el id de la página y la mesa; la sucursal, la persona y el estado del navegador se descartan", async () => {
    const { tomarElPedidoDeLaMesa } = await cargar();
    const r = await tomarElPedidoDeLaMesa({
      cuentaId: CUENTA,
      mesaId: MESA,
      sucursalId: "otra",
      personaId: "otra",
      estado: "ABIERTA",
    });
    expect(r).toEqual({ ok: true, dato: { cuentaId: CUENTA, yaExistia: false } });
    expect(mundo.llamadas.find((l) => l.caso === "tomarPedido")?.entrada).toEqual({
      cuentaId: CUENTA,
      mesaId: MESA,
    });
    expect(mundo.llamadas.find((l) => l.caso === "mapaDeMesas")?.entrada).toMatchObject({
      sucursalId: SUCURSAL,
    });
  });

  it("una mesa que no es de la sucursal del servidor no llega al caso de uso", async () => {
    const { tomarElPedidoDeLaMesa, cambiarDeMesaLaCuentaDelSalon } = await cargar();
    const ajena = "55555555-5555-4555-8555-555555555555";
    expect(await tomarElPedidoDeLaMesa({ cuentaId: CUENTA, mesaId: ajena })).toEqual(GENERICO);
    expect(await cambiarDeMesaLaCuentaDelSalon({ cuentaId: CUENTA, mesaDestinoId: ajena })).toEqual(
      GENERICO,
    );
    expect(mundo.llamadas.filter((l) => l.caso !== "mapaDeMesas")).toEqual([]);
  });

  it("la ficha, liberar y cambiar de mesa pasan por el caso de uso con lo declarado", async () => {
    const { cargarLaFichaDeLaMesa, liberarLaMesaDelSalon, cambiarDeMesaLaCuentaDelSalon } =
      await cargar();
    expect(await cargarLaFichaDeLaMesa({ mesaId: MESA })).toMatchObject({
      ok: true,
      dato: { mesaId: MESA },
    });
    expect(await liberarLaMesaDelSalon({ cuentaId: CUENTA, sucursalId: "otra" })).toEqual({
      ok: true,
      dato: { yaEstabaLibre: false },
    });
    expect(
      await cambiarDeMesaLaCuentaDelSalon({ cuentaId: CUENTA, mesaDestinoId: DESTINO }),
    ).toEqual({ ok: true, dato: { yaExistia: false } });
    expect(mundo.llamadas.find((l) => l.caso === "liberarMesa")?.entrada).toEqual({
      cuentaId: CUENTA,
    });
    expect(mundo.llamadas.find((l) => l.caso === "cambiarDeMesa")?.entrada).toEqual({
      cuentaId: CUENTA,
      mesaDestinoId: DESTINO,
    });
  });

  it("sin sucursal efectiva no se asume «todas»: el genérico y ninguna llamada, en cada operación", async () => {
    mundo.efectiva = "";
    const c = await cargar();
    for (const accion of [
      c.cargarElMapaDeMesas,
      c.cargarLaFichaDeLaMesa,
      c.tomarElPedidoDeLaMesa,
      c.liberarLaMesaDelSalon,
      c.cambiarDeMesaLaCuentaDelSalon,
    ]) {
      expect(await accion({ cuentaId: CUENTA, mesaId: MESA, mesaDestinoId: DESTINO })).toEqual(
        GENERICO,
      );
    }
    expect(mundo.llamadas).toEqual([]);
  });

  it("el id de la cuenta es nuevo en cada apertura de la página", async () => {
    const { nuevoIdDeCuentaDeMesa } = await cargar();
    const id = nuevoIdDeCuentaDeMesa();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nuevoIdDeCuentaDeMesa()).not.toBe(id);
  });
});
