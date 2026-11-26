import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import type { TrabajoDeImpresion } from "../../patrones/papel/BotonDeImprimir.cliente";
import type { PapelParaImprimir } from "../../patrones/papel/hoja-del-papel";
import { armarLosTextosDeImprimir } from "../../patrones/papel/textos-de-imprimir";
import type { ProductoDeLaVenta } from "../venta/modelo-de-venta-rapida";
import { textosDeLaVenta } from "../venta/modelo-de-venta-rapida";
import { PantallaDeLaMesa, type PropsDePantallaDeLaMesa } from "./PantallaDeLaMesa.cliente";
import {
  armarLaMesa,
  textosDeLaMesa,
  type FichaDeLaMesaDeLaPantalla,
  type LineaDeLaFichaDeLaPantalla,
} from "./modelo-de-la-mesa";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/**
 * La ficha de la mesa en Chromium (SAL-B; maquetas `salon.html` y `salida.html`): mesa libre con «Tomar pedido» (un doble toque es un solo envío con el id de la cuenta que fijó la página), platos agrupados por
 * estado de comanda con «Quitar» y «Sale ahora / Sale después» solo en lo no enviado, «Liberar mesa» solo sin platos, «Cambiar de mesa», agregar con la hoja de la venta rápida (el id de la línea se repite si se repite
 * lo mismo tras un corte), el error del servidor, y axe y tamaños en 390 y 1280 px.
 */
const ARS = (monto: string) => ({ moneda: "ARS", monto });
const linea = (extra: Partial<LineaDeLaFichaDeLaPantalla> & { lineaId: string }) => ({
  posicion: 1,
  descripcion: "Milanesa",
  varianteNombre: null,
  cantidad: "2.0000",
  importe: "19000.00",
  nota: null,
  compartida: false,
  comanda: "PARA_ENVIAR",
  numeroDeEnvio: null,
  envioId: null,
  deLaMesa: null,
  ...extra,
});
const fichaConPlatos: FichaDeLaMesaDeLaPantalla = {
  mesaId: "m1",
  numero: 7,
  estado: "EN_PEDIDO",
  unidaAMesa: null,
  cuentas: [
    {
      cuentaId: "c1",
      parte: null,
      total: ARS("21500.50"),
      lineas: [
        linea({ lineaId: "a" }),
        linea({ lineaId: "b", comanda: "ESPERA", descripcion: "Flan" }),
        linea({
          lineaId: "c",
          comanda: "ENVIADA",
          numeroDeEnvio: 1,
          envioId: "e1",
          descripcion: "Café",
        }),
      ],
    },
  ],
};
const fichaSinPlatos: FichaDeLaMesaDeLaPantalla = {
  ...fichaConPlatos,
  cuentas: [{ cuentaId: "c1", parte: null, total: ARS("0.00"), lineas: [] }],
};
const fichaLibre: FichaDeLaMesaDeLaPantalla = {
  ...fichaConPlatos,
  estado: "LIBRE",
  cuentas: [],
};

const base = {
  codigo: null,
  codigoDeBarras: null,
  seccionId: null,
  unidadDeVentaId: "UNIDAD",
  pasoMinimo: "1.0000",
  porcionesOfrecidas: [],
  variante: null,
  grupos: [],
} as const;
const productos: readonly ProductoDeLaVenta[] = [
  { ...base, id: "medialuna", nombre: "Medialuna", precio: { tipo: "BASE", importe: "800.00" } },
];

const resuelta: Respuesta<unknown> = { ok: true, dato: {} };
const rechazada: Respuesta<unknown> = {
  ok: false,
  error: errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA"),
};

const accionFalsa = () =>
  vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>(() => Promise.resolve(resuelta));
type Envio = Readonly<{
  envioId: string;
  numero: number;
  trabajoId: string;
  sinImpresora: boolean;
  yaExistia: boolean;
}>;
const envioHecho = (extra: Partial<Envio> = {}): Respuesta<Envio> => ({
  ok: true,
  dato: {
    envioId: "env-1",
    numero: 1,
    trabajoId: "trab-1",
    sinImpresora: false,
    yaExistia: false,
    ...extra,
  },
});
const trabajo = (extra: Partial<TrabajoDeImpresion> = {}): Respuesta<TrabajoDeImpresion> => ({
  ok: true,
  dato: {
    trabajoId: "trab-1",
    estado: "PENDIENTE",
    intentos: 1,
    sinImpresora: false,
    yaExistia: true,
    reintento: false,
    ...extra,
  },
});
const accionesFalsas = () => ({
  tomarPedido: accionFalsa(),
  agregar: accionFalsa(),
  cambiarSalida: accionFalsa(),
  cambiarNota: accionFalsa(),
  quitar: accionFalsa(),
  liberar: accionFalsa(),
  cambiarDeMesa: accionFalsa(),
  unir: accionFalsa(),
  enviar: vi.fn<(pedido: unknown) => Promise<Respuesta<Envio>>>(() =>
    Promise.resolve(envioHecho()),
  ),
  pedirQueSalga: vi.fn<(pedido: unknown) => Promise<Respuesta<Envio>>>(() =>
    Promise.resolve(envioHecho({ envioId: "env-2", numero: 2, trabajoId: "trab-2" })),
  ),
  anular: vi.fn<
    (
      pedido: unknown,
    ) => Promise<
      Respuesta<
        Readonly<{ avisoId: string; trabajoId: string; sinImpresora: boolean; yaExistia: boolean }>
      >
    >
  >(() =>
    Promise.resolve({
      ok: true,
      dato: { avisoId: "aviso-1", trabajoId: "trab-a1", sinImpresora: false, yaExistia: false },
    }),
  ),
  imprimir: vi.fn<(pedido: unknown) => Promise<Respuesta<TrabajoDeImpresion>>>(() =>
    Promise.resolve(trabajo()),
  ),
  reimprimir: vi.fn<(pedido: unknown) => Promise<Respuesta<TrabajoDeImpresion>>>(() =>
    Promise.resolve(trabajo({ trabajoId: "copia-1", yaExistia: false })),
  ),
  declarar: accionFalsa(),
  papel: vi.fn<(pedido: unknown) => Promise<Respuesta<PapelParaImprimir>>>(() =>
    Promise.resolve({
      ok: true,
      dato: { ancho: 80, lineas: [{ texto: "COMANDA", estilo: "NEGRITA" }] },
    }),
  ),
});
type Acciones = ReturnType<typeof accionesFalsas>;

const pantalla = (
  ficha: FichaDeLaMesaDeLaPantalla,
  acciones: Acciones,
  extra: Partial<PropsDePantallaDeLaMesa> = {},
) => (
  <PantallaDeLaMesa
    mesaId="m1"
    mesa={armarLaMesa({}, ficha)}
    textos={textosDeLaMesa()}
    acciones={acciones}
    cuentaNuevaId="cuenta-nueva"
    mesasLibres={null}
    textosDeImprimir={armarLosTextosDeImprimir()}
    puede={{ enviar: true, imprimir: true, reimprimir: true, cobrar: true, unir: true }}
    rutaDeImpresoras={null}
    mesasParaUnir={null}
    catalogo={null}
    {...extra}
  />
);
const conCatalogo = {
  secciones: [],
  productos,
  textos: textosDeLaVenta(),
  cotizar: vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      dato: { total: ARS("800.00"), lineas: [] },
    }),
  ),
};

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});
afterEach(async () => {
  await page.viewport(390, 844);
});

describe("PantallaDeLaMesa", () => {
  it("mesa libre: «Mesa libre» y «Tomar pedido»; axe y tamaños en 390 y 1280 px", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(pantalla(fichaLibre, accionesFalsas()));
      await expect.element(page.getByText("Mesa libre")).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Tomar pedido" })).toBeVisible();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("IDEMPOTENCIA: dos toques seguidos en «Tomar pedido» son un solo envío, con el id de la cuenta que fijó la página; después se recarga", async () => {
    const acciones = accionesFalsas();
    let liberar: () => void = () => undefined;
    acciones.tomarPedido.mockImplementation(
      () =>
        new Promise<Respuesta<unknown>>((r) => {
          liberar = () => {
            r(resuelta);
          };
        }),
    );
    await render(pantalla(fichaLibre, acciones));
    const boton = page.getByRole("button", { name: "Tomar pedido" });
    tocar(boton);
    tocar(boton);
    tocar(boton);
    await vi.waitFor(() => {
      expect(acciones.tomarPedido).toHaveBeenCalledTimes(1);
    });
    expect(acciones.tomarPedido).toHaveBeenCalledWith({ cuentaId: "cuenta-nueva", mesaId: "m1" });
    liberar();
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
    expect(acciones.tomarPedido).toHaveBeenCalledTimes(1);
  });

  it("con platos: agrupados, con el total; «Quitar» y la salida solo en lo no enviado; sin «Liberar mesa»; axe y tamaños", async () => {
    for (const [ancho, alto] of [
      [390, 900],
      [1280, 800],
    ] as const) {
      await page.viewport(ancho, alto);
      const { unmount } = await render(pantalla(fichaConPlatos, accionesFalsas()));
      await expect.element(page.getByRole("heading", { name: "Para enviar" })).toBeVisible();
      await expect
        .element(page.getByRole("heading", { name: "Esperan para después" }))
        .toBeVisible();
      await expect.element(page.getByRole("heading", { name: "Enviadas" })).toBeVisible();
      await expect.element(page.getByText("$ 21.500,50")).toBeVisible();
      await expect.element(page.getByText("Envío 1").first()).toBeVisible();
      expect(page.getByRole("button", { name: "Quitar" }).elements()).toHaveLength(2);
      expect(page.getByRole("button", { name: /Cuándo sale/ }).elements()).toHaveLength(2);
      expect(page.getByRole("button", { name: "Liberar mesa" }).elements()).toHaveLength(0);
      expect(await violacionesDeAccesibilidad()).toEqual([]);
      legibleYTocable();
      await unmount();
    }
  });

  it("«Quitar» manda la cuenta y la línea (sin motivo) y recarga; un doble toque es un solo envío", async () => {
    const acciones = accionesFalsas();
    await render(pantalla(fichaConPlatos, acciones));
    const quitar = page.getByRole("button", { name: "Quitar" }).first();
    tocar(quitar);
    tocar(quitar);
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
    expect(acciones.quitar).toHaveBeenCalledTimes(1);
    expect(acciones.quitar).toHaveBeenCalledWith({ cuentaId: "c1", lineaId: "a" });
  });

  it("«Sale ahora» pasa a «Sale después» y al revés, con la cuenta y la línea", async () => {
    const acciones = accionesFalsas();
    await render(pantalla(fichaConPlatos, acciones));
    await userEvent.click(page.getByRole("button", { name: /Cuándo sale.*Milanesa/ }));
    await vi.waitFor(() => {
      expect(acciones.cambiarSalida).toHaveBeenCalledTimes(1);
    });
    expect(acciones.cambiarSalida).toHaveBeenLastCalledWith({
      cuentaId: "c1",
      lineaId: "a",
      salida: "DESPUES",
    });
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
    await userEvent.click(page.getByRole("button", { name: /Cuándo sale.*Flan/ }));
    await vi.waitFor(() => {
      expect(acciones.cambiarSalida).toHaveBeenCalledTimes(2);
    });
    expect(acciones.cambiarSalida).toHaveBeenLastCalledWith({
      cuentaId: "c1",
      lineaId: "b",
      salida: "AHORA",
    });
  });

  it("«Liberar mesa» solo con la cuenta sin platos; manda la cuenta", async () => {
    const acciones = accionesFalsas();
    await render(pantalla(fichaSinPlatos, acciones));
    await expect.element(page.getByText("La mesa no tiene pedido")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Liberar mesa" }));
    await vi.waitFor(() => {
      expect(acciones.liberar).toHaveBeenCalledWith({ cuentaId: "c1" });
    });
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("el error del servidor se muestra y no recarga; el genérico dice «Esta acción no está permitida»", async () => {
    const acciones = accionesFalsas();
    acciones.quitar.mockImplementation(() => Promise.resolve(rechazada));
    await render(pantalla(fichaConPlatos, acciones));
    await userEvent.click(page.getByRole("button", { name: "Quitar" }).first());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("una acción que ni llega a una respuesta (red caída) muestra el genérico y no recarga", async () => {
    const acciones = accionesFalsas();
    acciones.quitar.mockImplementation(() => Promise.reject(new Error("sin red")));
    await render(pantalla(fichaConPlatos, acciones));
    await userEvent.click(page.getByRole("button", { name: "Quitar" }).first());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("mientras una acción está en vuelo ninguna otra sale", async () => {
    const acciones = accionesFalsas();
    let liberar: () => void = () => undefined;
    acciones.quitar.mockImplementation(
      () =>
        new Promise<Respuesta<unknown>>((r) => {
          liberar = () => {
            r(resuelta);
          };
        }),
    );
    await render(pantalla(fichaConPlatos, acciones));
    tocar(page.getByRole("button", { name: "Quitar" }).first());
    await vi.waitFor(() => {
      expect(acciones.quitar).toHaveBeenCalledTimes(1);
    });
    tocar(page.getByRole("button", { name: /Cuándo sale.*Milanesa/ }));
    tocar(page.getByRole("button", { name: "Quitar" }).last());
    liberar();
    await vi.waitFor(() => {
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });
    expect(acciones.cambiarSalida).not.toHaveBeenCalled();
    expect(acciones.quitar).toHaveBeenCalledTimes(1);
  });

  it("«Cambiar de mesa» no se ofrece sin permiso; con permiso abre las mesas libres y pasa la cuenta a la elegida", async () => {
    const acciones = accionesFalsas();
    const { unmount } = await render(pantalla(fichaConPlatos, acciones));
    expect(page.getByRole("button", { name: "Cambiar de mesa" }).elements()).toHaveLength(0);
    await unmount();
    await render(
      pantalla(fichaConPlatos, acciones, {
        mesasLibres: [
          { id: "m5", titulo: "Mesa 5" },
          { id: "m9", titulo: "Mesa 9" },
        ],
      }),
    );
    await userEvent.click(page.getByRole("button", { name: "Cambiar de mesa" }));
    await expect.element(page.getByRole("dialog", { name: "Pasar a la mesa" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Mesa 5" }));
    await vi.waitFor(() => {
      expect(acciones.cambiarDeMesa).toHaveBeenCalledWith({
        cuentaId: "c1",
        mesaDestinoId: "m5",
      });
    });
    await vi.waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/salon/cuenta/m5");
    });
  });

  it("sin mesas libres dice «No hay mesas libres»", async () => {
    await render(pantalla(fichaConPlatos, accionesFalsas(), { mesasLibres: [] }));
    await userEvent.click(page.getByRole("button", { name: "Cambiar de mesa" }));
    await expect.element(page.getByText("No hay mesas libres")).toBeVisible();
  });

  describe("agregar", () => {
    // Tras cerrar la hoja se ignora un toque sobre un producto durante medio segundo (evita abrirla dos veces con un doble toque): se espera a que pase.
    const abrirYAgregar = async () => {
      await new Promise((r) => setTimeout(r, 650));
      await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
      await userEvent.click(page.getByRole("button", { name: /^Agregar( ·|$)/ }));
    };

    it("manda el producto, las opciones y la cantidad como texto (sin precio), con el id de la línea y la cuenta; recarga", async () => {
      const acciones = accionesFalsas();
      await render(pantalla(fichaSinPlatos, acciones, { catalogo: conCatalogo }));
      await abrirYAgregar();
      await vi.waitFor(() => {
        expect(acciones.agregar).toHaveBeenCalledTimes(1);
      });
      const { lineaId, ...resto } = acciones.agregar.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(resto).toEqual({
        productoId: "medialuna",
        opcionIds: [],
        cantidad: "1",
        cuentaId: "c1",
      });
      expect(lineaId).toMatch(/^[0-9a-f-]{36}$/);
      await vi.waitFor(() => {
        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
    });

    it("«Nota para la cocina»: lo escrito viaja como texto con la línea (y otra nota es otro intento); sin nota no viaja la clave", async () => {
      const acciones = accionesFalsas();
      await render(pantalla(fichaSinPlatos, acciones, { catalogo: conCatalogo }));
      await new Promise((r) => setTimeout(r, 650));
      await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
      await userEvent.fill(
        page.getByRole("textbox", { name: "Nota para la cocina" }),
        "sin cebolla",
      );
      await userEvent.click(page.getByRole("button", { name: /^Agregar( ·|$)/ }));
      await vi.waitFor(() => {
        expect(acciones.agregar).toHaveBeenCalledTimes(1);
      });
      expect(acciones.agregar.mock.calls[0]?.[0]).toMatchObject({
        productoId: "medialuna",
        nota: "sin cebolla",
        cuentaId: "c1",
      });
    });

    it("IDEMPOTENCIA: tras un corte, repetir lo mismo reutiliza el id de la línea; otra cantidad o éxito previo es otro id", async () => {
      const acciones = accionesFalsas();
      acciones.agregar.mockImplementationOnce(() => Promise.reject(new Error("sin red")));
      await render(pantalla(fichaSinPlatos, acciones, { catalogo: conCatalogo }));
      await abrirYAgregar();
      await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
      await abrirYAgregar();
      await vi.waitFor(() => {
        expect(acciones.agregar).toHaveBeenCalledTimes(2);
      });
      const ids = acciones.agregar.mock.calls.map(
        (c) => (c as unknown as [{ lineaId: string }])[0].lineaId,
      );
      expect(ids[0]).toBe(ids[1]);
      await vi.waitFor(() => {
        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
      // Con el éxito el intento terminó: lo siguiente es otra línea.
      await abrirYAgregar();
      await vi.waitFor(() => {
        expect(acciones.agregar).toHaveBeenCalledTimes(3);
      });
      const tercero = (acciones.agregar.mock.calls[2] as unknown as [{ lineaId: string }])[0];
      expect(tercero.lineaId).not.toBe(ids[0]);
    });

    it("sin lo que se ofrece (catálogo ilegible) no hay «Agregar»; una mesa libre tampoco", async () => {
      await render(pantalla(fichaSinPlatos, accionesFalsas()));
      expect(page.getByRole("button", { name: /Medialuna/ }).elements()).toHaveLength(0);
    });
  });

  describe("nota para la cocina de un plato (SAL-G)", () => {
    it("un plato sin enviar tiene su campo: al salir de él con otro texto guarda la nota (vacía la quita); sin cambios no manda nada; el enviado la muestra y no se edita", async () => {
      const acciones = accionesFalsas();
      const ficha: FichaDeLaMesaDeLaPantalla = {
        ...fichaConPlatos,
        cuentas: [
          {
            cuentaId: "c1",
            parte: null,
            cobrada: false,
            total: ARS("38000.00"),
            lineas: [
              linea({ lineaId: "a", nota: "sin cebolla" }),
              linea({
                lineaId: "c",
                comanda: "ENVIADA",
                numeroDeEnvio: 1,
                envioId: "e1",
                descripcion: "Café",
                nota: "con hielo",
              }),
            ],
          },
        ],
      };
      await render(pantalla(ficha, acciones));
      const campo = page.getByRole("textbox", { name: "Nota para la cocina" });
      expect(campo.elements()).toHaveLength(1);
      await expect.element(campo).toHaveValue("sin cebolla");
      await expect.element(page.getByText("con hielo")).toBeVisible();
      await userEvent.click(campo);
      await userEvent.tab();
      expect(acciones.cambiarNota).not.toHaveBeenCalled();
      await userEvent.fill(campo, "bien cocida");
      await userEvent.tab();
      await vi.waitFor(() => {
        expect(acciones.cambiarNota).toHaveBeenCalledTimes(1);
      });
      expect(acciones.cambiarNota.mock.calls[0]?.[0]).toEqual({
        cuentaId: "c1",
        lineaId: "a",
        nota: "bien cocida",
      });
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    });
  });

  it("una mesa unida o dividida no ofrece ninguna acción", async () => {
    await render(
      pantalla(
        { ...fichaConPlatos, estado: "UNIDA", unidaAMesa: 3, cuentas: [] },
        accionesFalsas(),
        { mesasLibres: [{ id: "m5", titulo: "Mesa 5" }], catalogo: conCatalogo },
      ),
    );
    await expect.element(page.getByText("Unida a la mesa 3")).toBeVisible();
    expect(page.getByRole("button").elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  describe("cocina (SAL-C)", () => {
    let imprimir: MockInstance<() => void>;
    beforeEach(() => {
      imprimir = vi.spyOn(window, "print").mockImplementation(() => undefined);
    });
    afterEach(() => {
      imprimir.mockRestore();
    });
    const fichaParaEnviar: FichaDeLaMesaDeLaPantalla = {
      ...fichaConPlatos,
      cuentas: [
        {
          cuentaId: "c1",
          parte: null,
          total: ARS("38000.00"),
          lineas: [
            linea({ lineaId: "a" }),
            linea({ lineaId: "b", comanda: "ESPERA", descripcion: "Flan" }),
          ],
        },
      ],
    };

    it("IDEMPOTENCIA: dos toques en «Enviar a cocina» son un solo envío con SU id y SU clave; abre el diálogo UNA vez, declara «Impresa» y recarga", async () => {
      const acciones = accionesFalsas();
      await render(pantalla(fichaParaEnviar, acciones));
      const enviar = page.getByRole("button", { name: "Enviar a cocina" });
      tocar(enviar);
      tocar(enviar);
      await vi.waitFor(() => {
        expect(acciones.enviar).toHaveBeenCalledTimes(1);
      });
      const [pedido] = acciones.enviar.mock.calls[0] as unknown as [Record<string, unknown>];
      expect(pedido).toMatchObject({ cuentaId: "c1" });
      expect(String(pedido["envioId"])).toMatch(/^[0-9a-f-]{36}$/);
      expect(String(pedido["claveIdempotencia"])).toMatch(/^[0-9a-f-]{36}$/);
      await expect.element(page.getByText("Impresa")).toBeVisible();
      expect(imprimir).toHaveBeenCalledTimes(1);
      expect(acciones.papel).toHaveBeenCalledWith({
        documentoTipo: "COMANDA",
        documentoId: "env-1",
      });
      expect(acciones.declarar).toHaveBeenCalledWith({
        trabajoId: "trab-1",
        numero: 1,
        resultado: "IMPRESA",
      });
      // El trabajo ya lo creó el envío: no se vuelve a pedir (no se abriría otro papel).
      expect(acciones.imprimir).not.toHaveBeenCalled();
      expect(router.refresh).toHaveBeenCalledTimes(1);
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    });

    it("tras un corte, repetir el envío reutiliza el mismo id y la misma clave; con el éxito el siguiente es otro", async () => {
      const acciones = accionesFalsas();
      acciones.enviar.mockImplementationOnce(() => Promise.reject(new Error("sin red")));
      await render(pantalla(fichaParaEnviar, acciones));
      await userEvent.click(page.getByRole("button", { name: "Enviar a cocina" }));
      await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: "Enviar a cocina" }));
      await vi.waitFor(() => {
        expect(acciones.enviar).toHaveBeenCalledTimes(2);
      });
      const [a, b] = acciones.enviar.mock.calls.map((c) => c[0] as Record<string, unknown>);
      expect(b?.["envioId"]).toBe(a?.["envioId"]);
      expect(b?.["claveIdempotencia"]).toBe(a?.["claveIdempotencia"]);
    });

    it("si el envío «ya existía» (otro mozo, otra pestaña) no se abre otro diálogo de impresión", async () => {
      const acciones = accionesFalsas();
      acciones.enviar.mockImplementation(() => Promise.resolve(envioHecho({ yaExistia: true })));
      await render(pantalla(fichaParaEnviar, acciones));
      await userEvent.click(page.getByRole("button", { name: "Enviar a cocina" }));
      await vi.waitFor(() => {
        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
      expect(imprimir).not.toHaveBeenCalled();
      expect(acciones.papel).not.toHaveBeenCalled();
    });

    it("si el diálogo no se pudo abrir: «No se pudo imprimir» con «Reintentar» (el mismo trabajo) y «Ver en pantalla»; el envío quedó registrado igual", async () => {
      const acciones = accionesFalsas();
      imprimir.mockImplementationOnce(() => {
        throw new Error("sin diálogo");
      });
      acciones.imprimir.mockImplementation(() =>
        Promise.resolve(trabajo({ yaExistia: false, reintento: true, intentos: 2 })),
      );
      await render(pantalla(fichaParaEnviar, acciones));
      await userEvent.click(page.getByRole("button", { name: "Enviar a cocina" }));
      await expect.element(page.getByText("No se pudo imprimir")).toBeVisible();
      expect(acciones.declarar).toHaveBeenLastCalledWith({
        trabajoId: "trab-1",
        numero: 1,
        resultado: "FALLIDA",
      });
      await expect.element(page.getByRole("button", { name: "Ver en pantalla" })).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: "Reintentar" }));
      await expect.element(page.getByText("Impresa")).toBeVisible();
      expect(acciones.imprimir).toHaveBeenCalledTimes(1);
      expect(acciones.imprimir.mock.calls[0]?.[0]).toMatchObject({
        trabajoId: "trab-1",
        documentoTipo: "COMANDA",
        documentoId: "env-1",
      });
      expect(acciones.declarar).toHaveBeenLastCalledWith({
        trabajoId: "trab-1",
        numero: 2,
        resultado: "IMPRESA",
      });
      expect(acciones.enviar).toHaveBeenCalledTimes(1);
    });

    it("sin impresora: «No hay impresora para la comanda de cocina», «Ver en pantalla» y «Configurar impresoras» a quien puede ir; no abre ningún diálogo", async () => {
      const acciones = accionesFalsas();
      acciones.enviar.mockImplementation(() => Promise.resolve(envioHecho({ sinImpresora: true })));
      await render(pantalla(fichaParaEnviar, acciones, { rutaDeImpresoras: "/salon/impresoras" }));
      await userEvent.click(page.getByRole("button", { name: "Enviar a cocina" }));
      await expect
        .element(page.getByText("No hay impresora para la comanda de cocina"))
        .toBeVisible();
      await expect
        .element(page.getByRole("link", { name: "Configurar impresoras" }))
        .toHaveAttribute("href", "/salon/impresoras");
      await expect.element(page.getByRole("button", { name: "Ver en pantalla" })).toBeVisible();
      expect(imprimir).not.toHaveBeenCalled();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    });

    it("«Pedir que salga» en un plato que espera, y «Pedir que salga todo» en el grupo: cada uno es un envío con su id; abre su papel", async () => {
      const acciones = accionesFalsas();
      await render(pantalla(fichaParaEnviar, acciones));
      await userEvent.click(page.getByRole("button", { name: "Pedir que salga", exact: true }));
      await vi.waitFor(() => {
        expect(acciones.pedirQueSalga).toHaveBeenCalledTimes(1);
      });
      expect(acciones.pedirQueSalga.mock.calls[0]?.[0]).toMatchObject({
        cuentaId: "c1",
        lineaIds: ["b"],
      });
      await expect.element(page.getByText("Impresa")).toBeVisible();
      expect(acciones.papel).toHaveBeenLastCalledWith({
        documentoTipo: "COMANDA",
        documentoId: "env-2",
      });
      await userEvent.click(page.getByRole("button", { name: "Pedir que salga todo" }));
      await vi.waitFor(() => {
        expect(acciones.pedirQueSalga).toHaveBeenCalledTimes(2);
      });
      expect(acciones.pedirQueSalga.mock.calls[1]?.[0]).toMatchObject({
        cuentaId: "c1",
        lineaIds: "TODAS",
      });
      const ids = acciones.pedirQueSalga.mock.calls.map(
        (c) => (c[0] as { envioId: string }).envioId,
      );
      expect(new Set(ids).size).toBe(2);
    });

    it("«Anular» un plato enviado: pide cantidad y motivo; apagado sin motivo; manda la cantidad como texto y el motivo; un doble toque es un solo aviso; imprime el aviso", async () => {
      const acciones = accionesFalsas();
      await render(pantalla(fichaConPlatos, acciones));
      await userEvent.click(page.getByRole("button", { name: "Anular" }));
      const dialogo = page.getByRole("dialog");
      await expect.element(dialogo).toBeVisible();
      const confirmar = dialogo.getByRole("button", { name: "Anular", exact: true });
      await expect.element(confirmar).toBeDisabled();
      await userEvent.fill(dialogo.getByLabelText("Motivo"), "Se equivocaron de plato");
      await expect.element(confirmar).toBeEnabled();
      tocar(confirmar);
      tocar(confirmar);
      await vi.waitFor(() => {
        expect(acciones.anular).toHaveBeenCalledTimes(1);
      });
      const [pedido] = acciones.anular.mock.calls[0] as unknown as [Record<string, unknown>];
      expect(pedido).toMatchObject({
        cuentaId: "c1",
        lineaId: "c",
        cantidad: "2",
        motivo: "Se equivocaron de plato",
      });
      expect(String(pedido["avisoId"])).toMatch(/^[0-9a-f-]{36}$/);
      await expect.element(page.getByText("Ítem anulado")).toBeVisible();
      await expect.element(page.getByText("Impresa")).toBeVisible();
      expect(acciones.papel).toHaveBeenLastCalledWith({
        documentoTipo: "ANULACION",
        documentoId: "aviso-1",
      });
      expect(imprimir).toHaveBeenCalledTimes(1);
    });

    it("anular parte: la cantidad editada viaja como texto; el rechazo del servidor se ve dentro de la hoja y no recarga", async () => {
      const acciones = accionesFalsas();
      acciones.anular.mockImplementation(() => Promise.resolve(rechazada as never));
      await render(pantalla(fichaConPlatos, acciones));
      await userEvent.click(page.getByRole("button", { name: "Anular" }));
      const dialogo = page.getByRole("dialog");
      await userEvent.fill(dialogo.getByLabelText("Cantidad"), "1");
      await userEvent.fill(dialogo.getByLabelText("Motivo"), "Uno menos");
      await userEvent.click(dialogo.getByRole("button", { name: "Anular", exact: true }));
      await expect.element(dialogo.getByText("Esta acción no está permitida")).toBeVisible();
      expect(acciones.anular.mock.calls[0]?.[0]).toMatchObject({
        cantidad: "1",
        motivo: "Uno menos",
      });
      expect(router.refresh).not.toHaveBeenCalled();
      expect(await violacionesDeAccesibilidad()).toEqual([]);
    });

    it("«Reimprimir» pide confirmar («Se imprime una copia con la hora del envío original») y recién ahí pide la copia; se imprime marcada como copia y se declara contra el trabajo nuevo", async () => {
      const acciones = accionesFalsas();
      await render(pantalla(fichaConPlatos, acciones));
      await userEvent.click(page.getByRole("button", { name: "Reimprimir" }));
      await expect
        .element(page.getByText("Se imprime una copia con la hora del envío original"))
        .toBeVisible();
      expect(acciones.reimprimir).not.toHaveBeenCalled();
      const dialogo = page.getByRole("dialog");
      await userEvent.click(dialogo.getByRole("button", { name: "Reimprimir" }));
      await expect.element(page.getByText("Impresa")).toBeVisible();
      expect(acciones.reimprimir).toHaveBeenCalledTimes(1);
      const [pedido] = acciones.reimprimir.mock.calls[0] as unknown as [Record<string, unknown>];
      expect(pedido).toMatchObject({ documentoTipo: "COMANDA", documentoId: "e1" });
      expect(String(pedido["trabajoId"])).toMatch(/^[0-9a-f-]{36}$/);
      expect(acciones.papel).toHaveBeenLastCalledWith({
        documentoTipo: "COMANDA",
        documentoId: "e1",
        copia: true,
      });
      expect(acciones.declarar).toHaveBeenLastCalledWith({
        trabajoId: "copia-1",
        numero: 1,
        resultado: "IMPRESA",
      });
      expect(imprimir).toHaveBeenCalledTimes(1);
    });

    it("«Cancelar» en la confirmación de la copia no pide nada", async () => {
      const acciones = accionesFalsas();
      await render(pantalla(fichaConPlatos, acciones));
      await userEvent.click(page.getByRole("button", { name: "Reimprimir" }));
      await userEvent.click(page.getByRole("dialog").getByRole("button", { name: "Cancelar" }));
      expect(acciones.reimprimir).not.toHaveBeenCalled();
      expect(imprimir).not.toHaveBeenCalled();
    });

    it("sin permiso (la ayuda): sin «Enviar a cocina», «Pedir que salga», «Anular» ni «Reimprimir»; la ficha sigue igual", async () => {
      await render(
        pantalla(fichaParaEnviar, accionesFalsas(), {
          puede: { enviar: false, imprimir: false, reimprimir: false, cobrar: false, unir: false },
        }),
      );
      for (const nombre of ["Enviar a cocina", "Pedir que salga", "Anular", "Reimprimir"]) {
        expect(page.getByRole("button", { name: nombre }).elements()).toHaveLength(0);
      }
      await expect.element(page.getByRole("heading", { name: "Para enviar" })).toBeVisible();
    });
  });

  describe("cobrar (SAL-D)", () => {
    const todoEnviado: FichaDeLaMesaDeLaPantalla = {
      ...fichaConPlatos,
      cuentas: [
        {
          cuentaId: "c1",
          parte: null,
          total: ARS("12345.67"),
          lineas: [linea({ lineaId: "c", comanda: "ENVIADA", numeroDeEnvio: 1, envioId: "e1" })],
        },
      ],
    };

    it("«Cobrar» está APAGADO mientras haya platos para enviar o que esperan (el estado, sin texto nuevo) y se enciende con todo enviado", async () => {
      await render(pantalla(fichaConPlatos, accionesFalsas()));
      await expect.element(page.getByRole("button", { name: "Cobrar" })).toBeDisabled();
      await render(pantalla(todoEnviado, accionesFalsas()));
      await expect.element(page.getByRole("button", { name: "Cobrar" }).last()).toBeEnabled();
    });

    it("tocar «Cobrar» lleva a la hoja de cobro de ESA mesa; no cobra nada en esta pantalla", async () => {
      const acciones = accionesFalsas();
      await render(pantalla(todoEnviado, acciones));
      await userEvent.click(page.getByRole("button", { name: "Cobrar" }));
      expect(router.push).toHaveBeenCalledWith("/salon/cuenta/m1/cobrar");
      expect(acciones.enviar).not.toHaveBeenCalled();
    });

    it("sin permiso para cobrar la mesa (la ayuda) no hay «Cobrar»; una mesa sin platos tampoco se puede cobrar", async () => {
      await render(
        pantalla(todoEnviado, accionesFalsas(), {
          puede: { enviar: true, imprimir: true, reimprimir: true, cobrar: false, unir: false },
        }),
      );
      expect(page.getByRole("button", { name: "Cobrar" }).elements()).toHaveLength(0);
      await render(pantalla(fichaSinPlatos, accionesFalsas()));
      await expect.element(page.getByRole("button", { name: "Cobrar" }).last()).toBeDisabled();
    });
  });
});
