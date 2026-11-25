import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { legibleYTocable } from "../../pruebas/ayudas-de-emision";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
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
  compartida: false,
  comanda: "PARA_ENVIAR",
  numeroDeEnvio: null,
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
        linea({ lineaId: "c", comanda: "ENVIADA", numeroDeEnvio: 1, descripcion: "Café" }),
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
const accionesFalsas = () => ({
  tomarPedido: accionFalsa(),
  agregar: accionFalsa(),
  cambiarSalida: accionFalsa(),
  quitar: accionFalsa(),
  liberar: accionFalsa(),
  cambiarDeMesa: accionFalsa(),
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
      await expect.element(page.getByText("Envío 1")).toBeVisible();
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
});
