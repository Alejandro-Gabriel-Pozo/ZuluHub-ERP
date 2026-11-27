import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Sucursales» de punta a punta en la app REAL construida, con un navegador real y una base real. El gerente entra a Cuenta → «Sucursales» y:
 *  S1 ve la lista de las sucursales activas y toca «Nueva sucursal»;
 *  S2 escribe el nombre y toca «Guardar» dos veces seguidas: queda UNA sucursal (con su «Caja 1») y vuelve a la lista, donde figura;
 *  S3 repetir el alta con el mismo nombre no crea otra y vuelve a la lista sin error;
 *  S4 un nombre igual al de una sucursal desactivada muestra el mensaje genérico, no crea nada y la desactivada no figura en la lista.
 * Además: la entrada «Sucursales» figura en el menú de Cuenta del gerente y no hay violaciones graves de accesibilidad.
 * Lo que esta prueba ve y las de componentes y las de integración no: la acción de servidor en el navegador (la navegación tras crear) y la lista que se vuelve a leer.
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;
const GENERICO = "Esta acción no está permitida";

describe.skipIf(base === null)("recorrido de sucursales", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;

  const consulta = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[],
  ) => (await mundo.mundo.dueno.query<T>(texto, parametros)).rows;
  const sucursalesLlamadas = (nombre: string) =>
    consulta<{ id: string; activa: boolean }>(
      "select id, activa from sucursal where empresa_id = $1 and lower(nombre) = lower($2)",
      [mundo.empresa, nombre],
    );
  const ir = async (ruta: string) => {
    const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
    return respuesta;
  };
  const sinViolacionesDeAxe = async () => expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base);
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("S1 y S2: «Nueva sucursal», el nombre y dos toques seguidos en «Guardar» dejan UNA sucursal con su «Caja 1» y vuelven a la lista, donde figura", async () => {
    await ir("/cuenta/sucursales");
    await pagina.getByRole("heading", { name: "Sucursales" }).waitFor();
    await sinViolacionesDeAxe();
    await pagina.getByRole("link", { name: "Nueva sucursal" }).click();
    await pagina.waitForURL(/\/cuenta\/sucursales\/nueva$/);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByLabel("Nombre").fill("Terminal");
    await sinViolacionesDeAxe();

    await pagina.getByRole("button", { name: "Guardar" }).dblclick();
    await pagina.waitForURL(/\/cuenta\/sucursales$/, { timeout: 30_000 });
    await pagina.waitForLoadState("networkidle");

    const creadas = await sucursalesLlamadas("Terminal");
    expect(creadas).toHaveLength(1);
    const cajas = await consulta<{ n: string }>(
      "select count(*) as n from caja where empresa_id = $1 and sucursal_id = $2",
      [mundo.empresa, creadas[0]?.id],
    );
    expect(Number(cajas[0]?.n)).toBe(1);
    await pagina.getByText("Terminal", { exact: true }).waitFor();
    expect(vigilante.tomar()).toEqual([]);
  });

  it("S3: repetir el alta con el mismo nombre no crea otra y vuelve a la lista sin error", async () => {
    await ir("/cuenta/sucursales/nueva");
    await pagina.getByLabel("Nombre").fill("terminal");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.waitForURL(/\/cuenta\/sucursales$/, { timeout: 30_000 });
    expect(await sucursalesLlamadas("Terminal")).toHaveLength(1);
    expect(await pagina.getByText(GENERICO).count()).toBe(0);
  });

  it("S4: un nombre igual al de una sucursal desactivada muestra el mensaje genérico y no crea nada; la desactivada no figura en la lista", async () => {
    await consulta(
      "insert into sucursal (empresa_id, nombre, activa) values ($1, 'Cerrada', false)",
      [mundo.empresa],
    );
    await ir("/cuenta/sucursales");
    await pagina.getByText("Terminal", { exact: true }).waitFor();
    expect(await pagina.getByText("Cerrada").count()).toBe(0);

    await ir("/cuenta/sucursales/nueva");
    await pagina.getByLabel("Nombre").fill("cerrada");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.getByText(GENERICO).waitFor();
    await sinViolacionesDeAxe();
    expect(await sucursalesLlamadas("Cerrada")).toHaveLength(1);
  });

  it("la entrada «Sucursales» figura en el menú de Cuenta del gerente", async () => {
    await ir("/cuenta");
    await pagina.getByRole("link", { name: "Sucursales" }).first().waitFor();
  });
});
