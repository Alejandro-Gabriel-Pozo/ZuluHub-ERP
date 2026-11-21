import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { BotonDeImprimir, type TrabajoDeImpresion } from "./BotonDeImprimir.cliente";
import type { PapelParaImprimir } from "./hoja-del-papel";
import { armarLosTextosDeImprimir } from "./textos-de-imprimir";

/**
 * El botón «Imprimir» en Chromium real, contra un servidor falso que se comporta como el verdadero (`solicitarImpresion`: un solo trabajo original por documento, «Reintentar» = el mismo trabajo con un intento más;
 * `declararResultadoDeImpresion`: idempotente por intento). Cubre: el botón se APAGA mientras corre («Imprimiendo») y el doble toque no saca dos papeles, «Impresa» solo después de declarar, «No se pudo imprimir» con
 * «Reintentar» (mismo trabajo, intentos + 1, clave nueva) y «Ver en pantalla», que lo ya pedido no abre otro diálogo, que una red cortada reusa la clave y que lo que no se pudo declarar no se pierde.
 * `window.print` es un espía: no se abre un diálogo real.
 */
const PAPEL: PapelParaImprimir = {
  ancho: 80,
  lineas: [
    { texto: "COMANDA", estilo: "NEGRITA" },
    { texto: "1 x Milanesa", estilo: "NORMAL" },
  ],
};

type Trabajo = { id: string; estado: string; intentos: number; resultados: Map<number, string> };
const servidor = {
  trabajo: null as Trabajo | null,
  sinImpresora: false,
  pedidos: [] as string[],
  declaraciones: [] as string[],
  fallaElPedido: 0,
  fallaLaDeclaracion: 0,
  liberarPapel: null as null | (() => void),
  papelEnEspera: false,
};
const ok = <T,>(dato: T): Respuesta<T> => ({ ok: true, dato });

const pedirImpresion = (clave: string): Promise<Respuesta<TrabajoDeImpresion>> => {
  servidor.pedidos.push(clave);
  if (servidor.fallaElPedido > 0) {
    servidor.fallaElPedido -= 1;
    // La red se cortó DESPUÉS de que el servidor registró el pedido: no volvió la respuesta.
    servidor.trabajo ??= { id: "t1", estado: "PENDIENTE", intentos: 1, resultados: new Map() };
    return Promise.reject(new Error("red cortada"));
  }
  const t = servidor.trabajo;
  const base = { sinImpresora: servidor.sinImpresora };
  if (t === null) {
    servidor.trabajo = { id: "t1", estado: "PENDIENTE", intentos: 1, resultados: new Map() };
    return Promise.resolve(
      ok({
        trabajoId: "t1",
        estado: "PENDIENTE",
        intentos: 1,
        yaExistia: false,
        reintento: false,
        ...base,
      }),
    );
  }
  if (t.estado === "FALLIDA") {
    t.estado = "PENDIENTE";
    t.intentos += 1;
    return Promise.resolve(
      ok({
        trabajoId: t.id,
        estado: "PENDIENTE",
        intentos: t.intentos,
        yaExistia: false,
        reintento: true,
        ...base,
      }),
    );
  }
  return Promise.resolve(
    ok({
      trabajoId: t.id,
      estado: t.estado,
      intentos: t.intentos,
      yaExistia: true,
      reintento: false,
      ...base,
    }),
  );
};
const cargarPapel = async (): Promise<Respuesta<PapelParaImprimir>> => {
  if (servidor.papelEnEspera) {
    await new Promise<void>((r) => {
      servidor.liberarPapel = r;
    });
  }
  return ok(PAPEL);
};
const declarar = (
  numero: number,
  resultado: "IMPRESA" | "FALLIDA",
): Promise<Respuesta<unknown>> => {
  servidor.declaraciones.push(`${String(numero)}:${resultado}`);
  if (servidor.fallaLaDeclaracion > 0) {
    servidor.fallaLaDeclaracion -= 1;
    return Promise.reject(new Error("red cortada"));
  }
  const t = servidor.trabajo;
  if (t !== null) {
    t.resultados.set(numero, resultado);
    if (numero === t.intentos) t.estado = resultado;
  }
  return Promise.resolve(ok({}));
};

let imprimir: MockInstance<() => void>;
beforeEach(() => {
  Object.assign(servidor, {
    trabajo: null,
    sinImpresora: false,
    pedidos: [],
    declaraciones: [],
    fallaElPedido: 0,
    fallaLaDeclaracion: 0,
    liberarPapel: null,
    papelEnEspera: false,
  });
  imprimir = vi.spyOn(window, "print").mockImplementation(() => undefined);
});
afterEach(() => {
  servidor.liberarPapel?.();
  imprimir.mockRestore();
});

let claves = 0;
const dibujar = (deshabilitado = false) =>
  render(
    <BotonDeImprimir
      textos={armarLosTextosDeImprimir()}
      pedirImpresion={pedirImpresion}
      cargarPapel={cargarPapel}
      declarar={declarar}
      deshabilitado={deshabilitado}
      nuevaClave={() => `clave-${String(++claves)}`}
    />,
  );
const imprimirBoton = () => page.getByRole("button", { name: "Imprimir", exact: true });
const reintentar = () => page.getByRole("button", { name: "Reintentar" });
const verEnPantalla = () => page.getByRole("button", { name: "Ver en pantalla" });

describe("BotonDeImprimir", () => {
  it("imprime: pide el trabajo, abre el diálogo UNA vez con el papel, declara «Impresa» y recién ahí lo dice", async () => {
    await dibujar();
    tocar(imprimirBoton());
    await expect.element(page.getByText("Impresa")).toBeVisible();
    expect(servidor.pedidos).toHaveLength(1);
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(servidor.declaraciones).toEqual(["1:IMPRESA"]);
    expect(servidor.trabajo?.estado).toBe("IMPRESA");
    expect(document.querySelector("[data-papel]")).toBeNull();
    expect(page.getByRole("button", { name: "Imprimir", exact: true }).elements()).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("DOBLE TOQUE: el botón se apaga («Imprimiendo», aria-busy) y tocar de nuevo no saca otro papel", async () => {
    servidor.papelEnEspera = true;
    await dibujar();
    tocar(imprimirBoton());
    const apagado = page.getByRole("button", { name: "Imprimiendo" });
    await expect.element(apagado).toHaveAttribute("aria-busy", "true");
    tocar(apagado);
    tocar(apagado);
    await vi.waitFor(() => expect(servidor.liberarPapel).not.toBeNull());
    servidor.liberarPapel?.();
    await expect.element(page.getByText("Impresa")).toBeVisible();
    expect(servidor.pedidos).toHaveLength(1);
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(servidor.declaraciones).toEqual(["1:IMPRESA"]);
  });

  it("si el diálogo no se pudo abrir: declara «No se pudo imprimir» y deja «Reintentar» y «Ver en pantalla»", async () => {
    imprimir.mockImplementationOnce(() => {
      throw new Error("sin diálogo");
    });
    await dibujar();
    tocar(imprimirBoton());
    await expect.element(page.getByText("No se pudo imprimir")).toBeVisible();
    expect(servidor.declaraciones).toEqual(["1:FALLIDA"]);
    await expect.element(reintentar()).toBeVisible();
    await expect.element(verEnPantalla()).toBeVisible();
    expect(await violacionesDeAccesibilidad()).toEqual([]);
  });

  it("REINTENTAR: el MISMO trabajo con un intento más y una clave nueva; sale un papel y queda «Impresa»", async () => {
    imprimir.mockImplementationOnce(() => {
      throw new Error("sin diálogo");
    });
    await dibujar();
    tocar(imprimirBoton());
    await expect.element(reintentar()).toBeVisible();
    tocar(reintentar());
    await expect.element(page.getByText("Impresa")).toBeVisible();
    expect(new Set(servidor.pedidos).size).toBe(2);
    expect(servidor.trabajo).toMatchObject({ id: "t1", intentos: 2, estado: "IMPRESA" });
    expect(servidor.declaraciones).toEqual(["1:FALLIDA", "2:IMPRESA"]);
    expect(imprimir).toHaveBeenCalledTimes(2);
  });

  it("un trabajo que ya estaba impreso (otro toque, otra pestaña) NO abre otro diálogo", async () => {
    servidor.trabajo = {
      id: "t1",
      estado: "IMPRESA",
      intentos: 1,
      resultados: new Map([[1, "IMPRESA"]]),
    };
    await dibujar();
    tocar(imprimirBoton());
    await expect.element(page.getByText("Impresa")).toBeVisible();
    expect(imprimir).not.toHaveBeenCalled();
    expect(servidor.declaraciones).toEqual([]);
  });

  it("un trabajo pendiente de otro lado no saca un papel de más: «No se pudo imprimir» y «Reintentar» lo declara fallido y recién ahí reintenta", async () => {
    servidor.trabajo = { id: "t1", estado: "PENDIENTE", intentos: 1, resultados: new Map() };
    await dibujar();
    tocar(imprimirBoton());
    await expect.element(page.getByText("No se pudo imprimir")).toBeVisible();
    expect(imprimir).not.toHaveBeenCalled();
    tocar(reintentar());
    await expect.element(page.getByText("Impresa")).toBeVisible();
    expect(servidor.declaraciones).toEqual(["1:FALLIDA", "2:IMPRESA"]);
    expect(imprimir).toHaveBeenCalledTimes(1);
  });

  it("sin impresora para el uso: lo dice y ofrece «Ver en pantalla»; no abre el diálogo", async () => {
    servidor.sinImpresora = true;
    await dibujar();
    tocar(imprimirBoton());
    await expect
      .element(page.getByText("No hay impresora para la comanda de cocina"))
      .toBeVisible();
    await expect.element(verEnPantalla()).toBeVisible();
    expect(imprimir).not.toHaveBeenCalled();
    tocar(verEnPantalla());
    await expect.element(page.getByText("1 x Milanesa")).toBeVisible();
    expect(imprimir).not.toHaveBeenCalled();
  });

  it("RED CORTADA al pedir: «Reintentar» reusa la MISMA clave, el servidor devuelve el mismo trabajo y sale UN solo papel", async () => {
    servidor.fallaElPedido = 1;
    await dibujar();
    tocar(imprimirBoton());
    await expect.element(page.getByText("No se pudo imprimir")).toBeVisible();
    expect(imprimir).not.toHaveBeenCalled();
    tocar(reintentar());
    await expect.element(page.getByText("Impresa")).toBeVisible();
    expect(servidor.pedidos).toHaveLength(2);
    expect(servidor.pedidos[0]).toBe(servidor.pedidos[1]);
    expect(servidor.trabajo).toMatchObject({ id: "t1", intentos: 1, estado: "IMPRESA" });
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(servidor.declaraciones).toEqual(["1:IMPRESA"]);
  });

  it("si el papel salió y NO se pudo declarar «Impresa», no se pierde: «Reintentar» lo declara y termina en «Impresa» SIN abrir otro diálogo", async () => {
    servidor.fallaLaDeclaracion = 1;
    await dibujar();
    tocar(imprimirBoton());
    await expect.element(page.getByText("No se pudo imprimir")).toBeVisible();
    expect(imprimir).toHaveBeenCalledTimes(1);
    tocar(reintentar());
    await expect.element(page.getByText("Impresa")).toBeVisible();
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(servidor.declaraciones).toEqual(["1:IMPRESA", "1:IMPRESA"]);
    expect(servidor.trabajo?.estado).toBe("IMPRESA");
  });

  it("«Ver en pantalla» muestra el papel sin imprimir ni declarar nada", async () => {
    imprimir.mockImplementationOnce(() => {
      throw new Error("sin diálogo");
    });
    await dibujar();
    tocar(imprimirBoton());
    await expect.element(verEnPantalla()).toBeVisible();
    servidor.declaraciones.length = 0;
    tocar(verEnPantalla());
    await expect.element(page.getByText("1 x Milanesa")).toBeVisible();
    expect(imprimir).toHaveBeenCalledTimes(1);
    expect(servidor.declaraciones).toEqual([]);
  });

  it("un rechazo del servidor (sin permiso) sale como el mensaje genérico y no abre el diálogo", async () => {
    const rechazo = vi.fn(() =>
      Promise.resolve<Respuesta<TrabajoDeImpresion>>({
        ok: false,
        error: {
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        },
      }),
    );
    await render(
      <BotonDeImprimir
        textos={armarLosTextosDeImprimir()}
        pedirImpresion={rechazo}
        cargarPapel={cargarPapel}
        declarar={declarar}
      />,
    );
    tocar(imprimirBoton());
    await expect.element(page.getByText("Esta acción no está permitida")).toBeVisible();
    expect(imprimir).not.toHaveBeenCalled();
  });

  it("sin permiso el botón sale apagado", async () => {
    await dibujar(true);
    await expect.element(imprimirBoton()).toBeDisabled();
  });
});
