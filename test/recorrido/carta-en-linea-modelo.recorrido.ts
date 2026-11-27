import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";

/**
 * EL SELECTOR DE MODELO DE «CARTA EN LÍNEA» (DEC-CAT-004), de punta a punta en la app REAL construida: el gerente elige «Libro» y guarda; con la función del plan
 * «vidriera_modelo_libro» encendida la carta queda con modelo LIBRO, y sin ella no se guarda nada (error genérico) y la carta no se crea con ese modelo.
 */
const base = inject("baseDePruebas");
const interruptor = { tipo: "INTERRUPTOR", encendida: true };

describe.skipIf(base === null)("recorrido del selector de modelo de la carta", () => {
  let navegador: Browser;

  beforeAll(async () => {
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
  });
  afterAll(async () => {
    await navegador?.close();
  });

  const abrir = async (mundo: MundoDelRecorrido): Promise<Page> => {
    const contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
    await contexto.addCookies([...mundo.cookies]);
    const pagina = await contexto.newPage();
    await pagina.goto(`${mundo.url}/catalogo/carta-en-linea`);
    await pagina.getByLabel("Nombre", { exact: true }).waitFor();
    return pagina;
  };
  const modelos = async (mundo: MundoDelRecorrido) =>
    (
      await mundo.mundo.dueno.query<{ modelo: string }>(
        "select modelo from carta_publica where empresa_id = $1",
        [mundo.empresa],
      )
    ).rows.map((f) => f.modelo);

  it("con la función del plan encendida, elegir «Libro» y guardar deja la carta con modelo LIBRO (y se ve al volver a abrir)", async () => {
    if (base === null) return;
    const mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "vidriera"],
      perillas: { vidriera_por_qr: interruptor, vidriera_modelo_libro: interruptor },
      activarModulosEnDesarrollo: true,
    });
    try {
      const pagina = await abrir(mundo);
      expect(await pagina.getByRole("radio", { name: "Lista" }).isChecked()).toBe(true);
      await pagina.getByLabel("Nombre", { exact: true }).fill("Parador del Lago");
      await pagina.getByRole("radio", { name: "Libro" }).check();
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await pagina.getByText("Fuera de línea", { exact: true }).waitFor();
      expect(await modelos(mundo)).toEqual(["LIBRO"]);
      await pagina.reload();
      await pagina.getByLabel("Nombre", { exact: true }).waitFor();
      expect(await pagina.getByRole("radio", { name: "Libro" }).isChecked()).toBe(true);
      // Volver a Lista se guarda y no pide nada.
      await pagina.getByRole("radio", { name: "Lista" }).check();
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await pagina.waitForLoadState("networkidle");
      await pagina.reload();
      await pagina.getByLabel("Nombre", { exact: true }).waitFor();
      expect(await modelos(mundo)).toEqual(["LISTA"]);
    } finally {
      await mundo.cerrar();
    }
  });

  it("sin la función del plan, elegir «Libro» no guarda nada: error genérico y no se crea la carta", async () => {
    if (base === null) return;
    const mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "vidriera"],
      perillas: { vidriera_por_qr: interruptor },
      activarModulosEnDesarrollo: true,
    });
    try {
      const pagina = await abrir(mundo);
      await pagina.getByLabel("Nombre", { exact: true }).fill("Parador del Lago");
      await pagina.getByRole("radio", { name: "Libro" }).check();
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await pagina.getByText("Esta acción no está permitida").first().waitFor();
      expect(await modelos(mundo)).toEqual([]);
    } finally {
      await mundo.cerrar();
    }
  });
});
