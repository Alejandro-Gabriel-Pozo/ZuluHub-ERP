import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «CONECTÁ TU CUENTA DE FOTOS» de punta a punta en la app REAL construida y con un navegador real: la persona abre la pantalla, escribe su cuenta y toca «Guardar» (con un DOBLE toque): queda UNA cuenta con UNA
 * auditoría y se ve en la lista; una cuenta con forma inválida sale con el aviso genérico y no escribe; «Quitar» con motivo la saca de la lista y la deja retirada en la base. Lo que esta prueba ve y las de componentes
 * no: la página en el servidor (permisos, empresa, lectura de la base), la acción de servidor con el formulario real, las cabeceras de la app (CSP) y que ningún componente rompa en el navegador (React #441).
 *
 * El módulo `vidriera` puede estar «en desarrollo» en la app real: SOLO en el proceso de esta prueba se lee como «disponible» (`apoyo/activar-modulos-en-desarrollo.mjs`).
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("recorrido de Conectá tu cuenta de fotos", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;

  const cuentas = async () =>
    (
      await mundo.mundo.dueno.query<Record<string, unknown>>(
        "select * from cuenta_de_imagen_declarada where empresa_id = $1 order by declarada_en",
        [mundo.empresa],
      )
    ).rows;
  const auditorias = async (accion: string) =>
    Number(
      (
        await mundo.mundo.dueno.query<{ n: string }>(
          "select count(*)::text as n from auditoria_empresa where empresa_id = $1 and accion = $2",
          [mundo.empresa, accion],
        )
      ).rows[0]?.n,
    );
  const boton = (nombre: string) => pagina.getByRole("button", { name: nombre, exact: true });
  const abrir = async () => {
    const r = await pagina.goto(`${mundo.url}/catalogo/carta-en-linea/cuentas-de-fotos`);
    await pagina.waitForLoadState("networkidle");
    expect(r?.status()).toBe(200);
  };

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["catalogo", "vidriera"],
      activarModulosEnDesarrollo: true,
    });
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("la pantalla abre con el campo y «Guardar», sin cuentas; ningún componente rompe", async () => {
    await abrir();
    await pagina.getByLabel("Pegá el nombre de tu cuenta").waitFor();
    await boton("Guardar").waitFor();
    expect(await cuentas()).toHaveLength(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("una cuenta con forma inválida avisa con el genérico y no escribe", async () => {
    await pagina.getByLabel("Pegá el nombre de tu cuenta").fill("con espacios");
    await boton("Guardar").click();
    await pagina.getByText("Esta acción no está permitida").waitFor();
    expect(await cuentas()).toHaveLength(0);
  });

  it("escribir la cuenta y «Guardar» con DOBLE TOQUE: UNA cuenta activa y UNA auditoría; se ve en la lista", async () => {
    await abrir();
    await pagina.getByLabel("Pegá el nombre de tu cuenta").fill("mi-hotel");
    await boton("Guardar").dblclick();
    await pagina.getByText("mi-hotel", { exact: true }).waitFor();
    const filas = await cuentas();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      proveedor: "CLOUDINARY",
      cuenta: "mi-hotel",
      estado: "ACTIVA",
    });
    expect(await auditorias("CUENTA_DE_IMAGEN_DECLARADA")).toBe(1);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("«Quitar» con motivo la saca de la lista y la deja retirada, con UNA auditoría", async () => {
    await abrir();
    await pagina.getByLabel("Motivo").fill("Cerramos la cuenta");
    await boton("Quitar").dblclick();
    await expect
      .poll(async () => (await cuentas())[0]?.["estado"], { timeout: 15_000 })
      .toBe("RETIRADA");
    await pagina.getByText("mi-hotel", { exact: true }).waitFor({ state: "detached" });
    expect(await cuentas()).toHaveLength(1);
    expect(await auditorias("CUENTA_DE_IMAGEN_RETIRADA")).toBe(1);
    expect(vigilante.tomar()).toEqual([]);
  });
});
