import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { PantallaDeVentaRapida } from "./PantallaDeVentaRapida.cliente";
import { textosDeLaVenta, type ProductoDeLaVenta } from "./modelo-de-venta-rapida";
import { type CotizacionDeLaVenta } from "./modelo-de-la-cuenta";

const base = {
  codigo: null,
  codigoDeBarras: null,
  seccionId: "comer",
  unidadDeVentaId: "UNIDAD",
  pasoMinimo: "1.0000",
  porcionesOfrecidas: [],
  variante: null,
  grupos: [],
} as const;

const productos: readonly ProductoDeLaVenta[] = [
  { ...base, id: "medialuna", nombre: "Medialuna", precio: { tipo: "BASE", importe: "800.00" } },
  {
    ...base,
    id: "latte",
    nombre: "Latte",
    seccionId: "cafes",
    precio: { tipo: "SEGUN_MEDIDA" },
    variante: {
      grupoId: "tam",
      nombre: "Tamaño",
      esTamano: true,
      opciones: [
        { id: "chico", nombre: "Chico", precio: "3200.00" },
        { id: "mediano", nombre: "Mediano", precio: "3800.00" },
      ],
    },
    grupos: [
      {
        id: "extras",
        clase: "ADICIONAL",
        nombre: "Adicionales",
        obligatorio: false,
        admiteVarias: true,
        opciones: [{ id: "almendras", nombre: "Leche de almendras", recargo: "700.00" }],
      },
    ],
  },
  {
    ...base,
    id: "milanesa",
    nombre: "Milanesa",
    precio: { tipo: "BASE", importe: "9500.00" },
    grupos: [
      {
        id: "carne",
        clase: "INCLUIDA",
        nombre: "Carne",
        obligatorio: true,
        admiteVarias: false,
        opciones: [
          { id: "pollo", nombre: "Pollo", recargo: "0.00" },
          { id: "vaca", nombre: "Vaca", recargo: "500.00" },
        ],
      },
    ],
  },
  {
    ...base,
    id: "muzza",
    nombre: "Muzzarella",
    seccionId: "pizzas",
    pasoMinimo: "0.2500",
    porcionesOfrecidas: [2, 4],
    precio: { tipo: "BASE", importe: "9000.00" },
  },
  {
    ...base,
    id: "queso",
    nombre: "Queso cremoso",
    codigo: "Q-77",
    codigoDeBarras: "7790001234567",
    unidadDeVentaId: "KILOGRAMO",
    pasoMinimo: "0.0010",
    precio: { tipo: "BASE", importe: "14000.00" },
  },
  {
    ...base,
    id: "abierto",
    nombre: "Agua de la casa",
    seccionId: null,
    precio: { tipo: "SIN_PRECIO" },
  },
];
const secciones = [
  { id: "cafes", nombre: "Cafés" },
  { id: "comer", nombre: "Para comer" },
  { id: "pizzas", nombre: "Pizzas" },
] as const;

const textos = textosDeLaVenta();

/** Lo que devuelve el «servidor» de la prueba: el total es un número cualquiera que la pantalla no puede adivinar. */
const cotizacion = (monto: string, importes: readonly string[] = []): CotizacionDeLaVenta => ({
  total: { moneda: "ARS", monto },
  lineas: importes.map((i) => ({
    precioUnitario: { moneda: "ARS", monto: "1.00" },
    importe: { moneda: "ARS", monto: i },
  })),
});
const ok = (c: CotizacionDeLaVenta): Respuesta<CotizacionDeLaVenta> => ({ ok: true, dato: c });

function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promesa, resolver };
}

const pedidoDe = (llamada: number, cotizar: ReturnType<typeof vi.fn>) =>
  cotizar.mock.calls[llamada]?.[0] as { lineas: readonly Record<string, unknown>[] };

async function pantalla(
  cotizar = vi.fn(() => Promise.resolve(ok(cotizacion("7777.00", ["7777.00"])))),
) {
  await render(
    <PantallaDeVentaRapida
      secciones={secciones}
      productos={productos}
      textos={textos}
      cotizar={cotizar}
    />,
  );
  return cotizar;
}

const agregarEnLaHoja = () => userEvent.click(page.getByRole("button", { name: "Agregar" }));
const total = () => page.getByRole("paragraph").filter({ hasText: "Total" });
const textoDelTotal = () => document.querySelector("[data-total]")?.textContent ?? null;

describe("VentaRapida: lo que se ve", () => {
  it("los productos por sección, en el orden del servidor, y los sin sección al final sin título", async () => {
    await pantalla();
    const titulos = page
      .getByRole("heading")
      .elements()
      .map((h) => h.textContent);
    expect(titulos).toEqual(["Cafés", "Para comer", "Pizzas"]);
    await expect.element(page.getByRole("button", { name: /Medialuna/ })).toBeVisible();
    await expect.element(page.getByRole("button", { name: /Agua de la casa/ })).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("cada tarjeta dice su precio de lista, «Según medida» o «Sin precio», y «Con opciones»", async () => {
    await pantalla();
    await expect.element(page.getByRole("button", { name: "Medialuna $ 800,00" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Latte Con opciones Según medida" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Milanesa Con opciones $ 9.500,00" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: /Agua de la casa Sin precio/ }))
      .toBeDisabled();
  });

  it("buscar filtra por nombre sin importar tildes ni mayúsculas y una sección elegida deja solo esa", async () => {
    await pantalla();
    await userEvent.fill(
      page.getByRole("searchbox", { name: "Buscar por nombre o código" }),
      "MUZA",
    );
    expect(page.getByRole("button", { name: /Muzzarella/ }).elements()).toHaveLength(0);
    await userEvent.fill(
      page.getByRole("searchbox", { name: "Buscar por nombre o código" }),
      "muzza",
    );
    await expect.element(page.getByRole("button", { name: /Muzzarella/ })).toBeVisible();
    expect(page.getByRole("button", { name: /Medialuna/ }).elements()).toHaveLength(0);
    await userEvent.fill(page.getByRole("searchbox", { name: "Buscar por nombre o código" }), "");
    await userEvent.click(page.getByRole("button", { name: "Cafés", exact: true }));
    expect(page.getByRole("button", { name: /Medialuna/ }).elements()).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: /Latte/ })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Cafés", exact: true }));
    await expect.element(page.getByRole("button", { name: /Medialuna/ })).toBeVisible();
  });

  it("también busca por código y por código de barras", async () => {
    await pantalla();
    const buscar = page.getByRole("searchbox", { name: "Buscar por nombre o código" });
    for (const codigo of ["q-77", "7790001234567"]) {
      await userEvent.fill(buscar, codigo);
      await expect.element(page.getByRole("button", { name: /Queso cremoso/ })).toBeVisible();
      expect(page.getByRole("button", { name: /Medialuna/ }).elements()).toHaveLength(0);
    }
  });

  it("sin coincidencias lo dice con el texto buscado como texto, ayuda y «Borrar la búsqueda»", async () => {
    await pantalla();
    const buscar = page.getByRole("searchbox", { name: "Buscar por nombre o código" });
    await userEvent.fill(buscar, "<b>zzz</b>");
    await expect.element(page.getByText("No encontré productos con «<b>zzz</b>»")).toBeVisible();
    expect(document.querySelector("b")).toBeNull();
    await expect.element(page.getByText("Revisá el nombre o probá con el código.")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Borrar la búsqueda" }));
    await expect.element(buscar).toHaveValue("");
    await expect.element(page.getByRole("button", { name: /Medialuna/ })).toBeVisible();
    expect(page.getByText("No encontré productos").elements()).toHaveLength(0);
  });

  it("lo que se escribe en el buscador se muestra como texto, nunca como código", async () => {
    await pantalla();
    await userEvent.fill(
      page.getByRole("searchbox", { name: "Buscar por nombre o código" }),
      "<img src=x onerror=alert(1)>",
    );
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

describe("VentaRapida: la hoja y la cuenta", () => {
  it("un producto simple: toca, «Agregar» ya vale con 1 y la cuenta se cotiza en el servidor", async () => {
    const cotizar = await pantalla();
    await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
    const hoja = page.getByRole("dialog", { name: "Medialuna" });
    await expect.element(hoja).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Agregar" })).toBeEnabled();
    await agregarEnLaHoja();
    await expect.element(page.getByText("Agregado · Medialuna")).toBeVisible();
    await expect.poll(textoDelTotal).toBe("$ 7.777,00");
    expect(cotizar).toHaveBeenCalledTimes(1);
    expect(pedidoDe(0, cotizar)).toEqual({
      lineas: [{ productoId: "medialuna", opcionIds: [], cantidad: "1" }],
    });
  });

  it("el total NUNCA es una cuenta del navegador: sin respuesta del servidor no hay total", async () => {
    const pendiente = diferida<Respuesta<CotizacionDeLaVenta>>();
    await pantalla(vi.fn(() => pendiente.promesa));
    await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
    await agregarEnLaHoja();
    expect(textoDelTotal()).toBe("");
    await expect.element(total()).toHaveAttribute("aria-busy", "true");
    pendiente.resolver(ok(cotizacion("123456.00", ["123456.00"])));
    await expect.poll(textoDelTotal).toBe("$ 123.456,00");
  });

  it("una respuesta vieja que llega tarde se descarta: solo vale la de la cuenta actual", async () => {
    const primera = diferida<Respuesta<CotizacionDeLaVenta>>();
    const segunda = diferida<Respuesta<CotizacionDeLaVenta>>();
    const respuestas = [primera, segunda];
    const cotizar = vi.fn(() => (respuestas.shift() ?? segunda).promesa);
    await pantalla(cotizar);
    await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
    await agregarEnLaHoja();
    await expect.poll(() => cotizar.mock.calls.length).toBe(1);
    await new Promise((r) => setTimeout(r, 600)); // pasa la espera tras cerrar la hoja
    await userEvent.click(page.getByRole("button", { name: /Milanesa/ }));
    await userEvent.click(page.getByRole("radio", { name: "Pollo" }));
    await agregarEnLaHoja();
    await expect.poll(() => cotizar.mock.calls.length).toBe(2);
    segunda.resolver(ok(cotizacion("2000.00", ["1.00", "1999.00"])));
    await expect.poll(textoDelTotal).toBe("$ 2.000,00");
    primera.resolver(ok(cotizacion("1.00", ["1.00"])));
    await new Promise((r) => setTimeout(r, 100));
    expect(textoDelTotal()).toBe("$ 2.000,00");
  });

  it("con medidas y opciones: «Agregar» espera lo obligatorio y manda los ids elegidos", async () => {
    const cotizar = await pantalla();
    await userEvent.click(page.getByRole("button", { name: /Latte/ }));
    await expect.element(page.getByRole("button", { name: "Agregar" })).toBeDisabled();
    await userEvent.click(page.getByRole("radio", { name: /Mediano/ }));
    await userEvent.click(page.getByRole("checkbox", { name: /Leche de almendras/ }));
    await expect.element(page.getByRole("button", { name: "Agregar" })).toBeEnabled();
    await agregarEnLaHoja();
    await expect.poll(() => cotizar.mock.calls.length).toBe(1);
    expect(pedidoDe(0, cotizar)).toEqual({
      lineas: [
        { productoId: "latte", varianteId: "mediano", opcionIds: ["almendras"], cantidad: "1" },
      ],
    });
  });

  it("un grupo obligatorio sin elegir deja «Agregar» apagado", async () => {
    await pantalla();
    await userEvent.click(page.getByRole("button", { name: /Milanesa/ }));
    await expect.element(page.getByRole("button", { name: "Agregar" })).toBeDisabled();
    await userEvent.click(page.getByRole("radio", { name: /Vaca/ }));
    await expect.element(page.getByRole("button", { name: "Agregar" })).toBeEnabled();
  });

  it("por fracciones: el entero se escribe, cada fracción suma y se arma «4 ½»", async () => {
    const cotizar = await pantalla();
    await userEvent.click(page.getByRole("button", { name: /Muzzarella/ }));
    await userEvent.fill(page.getByRole("textbox", { name: "Cantidad" }), "4");
    await userEvent.click(page.getByRole("button", { name: "½" }));
    await expect.element(page.getByText("4 ½", { exact: true })).toBeVisible();
    await agregarEnLaHoja();
    await expect.poll(() => cotizar.mock.calls.length).toBe(1);
    expect(pedidoDe(0, cotizar).lineas[0]).toMatchObject({ productoId: "muzza", cantidad: "4.5" });
  });

  it("por fracciones: «Borrar» vacía la cantidad y apaga «Agregar»", async () => {
    await pantalla();
    await userEvent.click(page.getByRole("button", { name: /Muzzarella/ }));
    await expect.element(page.getByRole("button", { name: "Agregar" })).toBeDisabled();
    await userEvent.click(page.getByRole("button", { name: "¼" }));
    await expect.element(page.getByRole("button", { name: "Agregar" })).toBeEnabled();
    await userEvent.click(page.getByRole("button", { name: "Borrar" }));
    await expect.element(page.getByRole("button", { name: "Agregar" })).toBeDisabled();
  });

  it("por peso: se escribe con coma en la unidad del producto; lo que no es múltiplo del paso es «Cantidad no válida»", async () => {
    const cotizar = await pantalla();
    await userEvent.click(page.getByRole("button", { name: /Queso cremoso/ }));
    await expect.element(page.getByText("Kilogramo")).toBeVisible();
    const campo = page.getByRole("textbox", { name: "Cantidad" });
    await userEvent.fill(campo, "0,00005");
    await expect.element(page.getByText("Cantidad no válida")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Agregar" })).toBeDisabled();
    await userEvent.fill(campo, "0,25");
    await expect.element(page.getByText("Cantidad no válida")).not.toBeInTheDocument();
    await agregarEnLaHoja();
    await expect.poll(() => cotizar.mock.calls.length).toBe(1);
    expect(pedidoDe(0, cotizar).lineas[0]).toMatchObject({ productoId: "queso", cantidad: "0.25" });
  });

  it("un número del 1 al 6 elige la cantidad de un producto por unidad", async () => {
    const cotizar = await pantalla();
    await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
    await userEvent.click(page.getByRole("button", { name: "3", exact: true }));
    await agregarEnLaHoja();
    await expect.poll(() => cotizar.mock.calls.length).toBe(1);
    expect(pedidoDe(0, cotizar).lineas[0]).toMatchObject({ cantidad: "3" });
  });

  it("DOBLE TOQUE en «Agregar»: la línea se agrega una sola vez", async () => {
    const cotizar = await pantalla();
    await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
    const agregar = page.getByRole("button", { name: "Agregar" });
    tocar(agregar);
    tocar(agregar);
    await expect.poll(() => cotizar.mock.calls.length).toBe(1);
    await new Promise((r) => setTimeout(r, 200));
    expect(cotizar).toHaveBeenCalledTimes(1);
    expect(pedidoDe(0, cotizar).lineas).toEqual([
      { productoId: "medialuna", opcionIds: [], cantidad: "1" },
    ]);
  });

  it("DOBLE TOQUE en un producto: la hoja se abre una vez y un segundo toque tras cerrar se ignora", async () => {
    await pantalla();
    const tarjeta = page.getByRole("button", { name: /Medialuna/ });
    tocar(tarjeta);
    await expect.element(page.getByRole("dialog", { name: "Medialuna" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Cancelar" }));
    tocar(tarjeta); // cae dentro de los 500 ms de espera
    await new Promise((r) => setTimeout(r, 100));
    expect(
      page
        .getByRole("dialog")
        .elements()
        .filter((d) => (d as HTMLDialogElement).open),
    ).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 550));
    tocar(tarjeta);
    await expect.element(page.getByRole("dialog", { name: "Medialuna" })).toBeVisible();
  });

  it("agregar lo mismo dos veces suma la cantidad en una sola línea", async () => {
    const cotizar = await pantalla();
    await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
    await agregarEnLaHoja();
    await new Promise((r) => setTimeout(r, 600));
    await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
    await userEvent.click(page.getByRole("button", { name: "2", exact: true }));
    await agregarEnLaHoja();
    await expect.poll(() => cotizar.mock.calls.length).toBe(2);
    expect(pedidoDe(1, cotizar).lineas).toEqual([
      { productoId: "medialuna", opcionIds: [], cantidad: "3" },
    ]);
    await expect.element(page.getByRole("button", { name: "Ver cuenta 1" })).toBeVisible();
  });

  it("la cuenta: importes del servidor, cantidad que se corrige escribiendo y «Quitar»", async () => {
    const cotizar = vi.fn((pedido: { lineas: readonly { cantidad: string }[] }) =>
      Promise.resolve(
        ok(
          cotizacion(
            "5000.00",
            pedido.lineas.map((_, i) => `${1000 * (i + 1)}.00`),
          ),
        ),
      ),
    );
    await pantalla(cotizar as never);
    await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
    await agregarEnLaHoja();
    await new Promise((r) => setTimeout(r, 600));
    await userEvent.click(page.getByRole("button", { name: /Queso cremoso/ }));
    await userEvent.fill(page.getByRole("textbox", { name: "Cantidad" }), "0,5");
    await agregarEnLaHoja();
    await userEvent.click(page.getByRole("button", { name: /Ver cuenta/ }));
    await expect.element(page.getByText("$ 1.000,00", { exact: true })).toBeVisible();
    await expect.element(page.getByText("$ 2.000,00", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Los precios incluyen IVA.")).toBeVisible();
    const campos = page.getByRole("textbox", { name: "Cantidad" });
    await userEvent.fill(campos.first(), "4");
    await expect.poll(() => cotizar.mock.calls.length).toBe(3);
    expect(pedidoDe(2, cotizar as never).lineas[0]).toMatchObject({
      productoId: "medialuna",
      cantidad: "4",
    });
    await userEvent.fill(campos.first(), "0");
    await expect.element(page.getByText("Cantidad no válida")).toBeVisible();
    expect(cotizar).toHaveBeenCalledTimes(3); // lo no válido no se manda
    await userEvent.click(page.getByRole("button", { name: "Quitar" }).first());
    await expect.poll(() => cotizar.mock.calls.length).toBe(4);
    expect(pedidoDe(3, cotizar as never).lineas).toHaveLength(1);
    await userEvent.click(page.getByRole("button", { name: "Quitar" }));
    await expect.element(page.getByText("La cuenta está vacía")).toBeVisible();
    await expect.element(page.getByText("Agregá productos desde la venta.")).toBeVisible();
    await expect.poll(textoDelTotal).toBe("");
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("la cuenta vacía lo dice con los textos aprobados y el total queda sin importe", async () => {
    await pantalla();
    await userEvent.click(page.getByRole("button", { name: "Ver cuenta" }));
    await expect.element(page.getByText("La cuenta está vacía")).toBeVisible();
    expect(textoDelTotal()).toBe("");
  });

  it("un error del servidor al cotizar se muestra y no deja ningún total a la vista", async () => {
    const error = errorDeCodigo("VENTAS_ACCION_NO_PERMITIDA");
    await pantalla(
      vi.fn(() => Promise.resolve({ ok: false, error } as Respuesta<CotizacionDeLaVenta>)),
    );
    await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
    await agregarEnLaHoja();
    await userEvent.click(page.getByRole("button", { name: /Ver cuenta/ }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(textoDelTotal()).toBe("");
  });

  it("un corte de red al cotizar sale como el genérico y no deja un total viejo", async () => {
    const respuestas = [
      () => Promise.resolve(ok(cotizacion("800.00", ["800.00"]))),
      () => Promise.reject(new Error("red")),
    ];
    const cotizar = vi.fn(() =>
      (respuestas.shift() as () => Promise<Respuesta<CotizacionDeLaVenta>>)(),
    );
    await pantalla(cotizar);
    await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
    await agregarEnLaHoja();
    await expect.poll(textoDelTotal).toBe("$ 800,00");
    await new Promise((r) => setTimeout(r, 600));
    await userEvent.click(page.getByRole("button", { name: /Medialuna/ }));
    await agregarEnLaHoja();
    await userEvent.click(page.getByRole("button", { name: /Ver cuenta/ }));
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(textoDelTotal()).toBe("");
  });

  it("la tarjeta del producto en la cuenta se marca con cuánto hay", async () => {
    await pantalla();
    await userEvent.click(page.getByRole("button", { name: /Muzzarella/ }));
    await userEvent.click(page.getByRole("button", { name: "½" }));
    await agregarEnLaHoja();
    await expect.element(page.getByRole("button", { name: /Muzzarella.*½/ })).toBeVisible();
  });

  it("la hoja se cierra con Escape y devuelve el foco a la tarjeta", async () => {
    await pantalla();
    const tarjeta = page.getByRole("button", { name: /Medialuna/ });
    await userEvent.click(tarjeta);
    await expect.element(page.getByRole("dialog", { name: "Medialuna" })).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.activeElement).toBe(tarjeta.element());
  });
});
