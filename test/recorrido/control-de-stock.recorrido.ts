import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * El tilde «Se controla el stock» de la ficha del producto, de punta a punta en la app REAL construida y con un navegador real (PR-3 de Catálogo): el gerente abre un insumo, marca la casilla, guarda
 * (con un DOBLE toque), recarga y sigue marcada; la desmarca, guarda, recarga y sigue desmarcada. Un producto vendible no la muestra. Lo que esta prueba ve y las de componentes no: la página en el
 * servidor (permisos, lectura de la base), la acción de servidor con sus dos transacciones, las cabeceras de la app (CSP) y que ningún componente rompa en el navegador (React #441). Lo que queda
 * escrito (un artículo, una sola auditoría) lo comprueba contra la base.
 */
const base = inject("baseDePruebas");
const stockAbierto = (CATALOGO_DE_MODULOS.stock.estado as string) === "disponible";

describe.skipIf(base === null || !stockAbierto)(
  "recorrido del tilde «Se controla el stock»",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;
    let insumo = "";
    let plato = "";

    const contar = async (sql: string, producto: string) =>
      Number(
        (await mundo.mundo.dueno.query<{ n: string }>(sql, [mundo.empresa, producto])).rows[0]?.n,
      );
    const articulosActivos = (producto: string) =>
      contar(
        "select count(*)::text as n from articulo_de_stock where empresa_id = $1 and producto_id = $2 and activo",
        producto,
      );
    const auditorias = (accion: string, producto: string) =>
      contar(
        `select count(*)::text as n from auditoria_empresa a join articulo_de_stock s on s.id::text = a.entidad_id::text where a.empresa_id = $1 and s.producto_id = $2 and a.accion = '${accion}'`,
        producto,
      );
    const casilla = () => pagina.getByRole("checkbox", { name: "Se controla el stock" });
    const abrir = async (producto: string) => {
      const r = await pagina.goto(`${mundo.url}/catalogo/productos/${producto}`);
      await pagina.waitForLoadState("networkidle");
      expect(r?.status()).toBe(200);
    };
    const guardarDosVeces = async () => {
      // Se espera la respuesta de la acción antes de seguir: si no, recargar la página corta el envío en curso y la prueba lee la base antes de que se escriba.
      const respuesta = pagina.waitForResponse((r) => r.request().method() === "POST");
      await pagina.getByRole("button", { name: "Guardar", exact: true }).dblclick();
      await respuesta;
      // Y que la página termine de volver a pintarse (el botón deja de estar ocupado): recargar en medio de esa navegación la aborta.
      await pagina.locator('button[aria-busy="true"]').waitFor({ state: "detached" });
      await pagina.waitForLoadState("networkidle");
    };

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base, {
        modulos: ["facturacion", "catalogo", "stock"],
        activarModulosEnDesarrollo: true,
      });
      insumo = await productoDeBase(mundo.mundo.dueno, mundo.empresa, {
        nombre: "Harina",
        clase: "INSUMO",
      });
      plato = await productoDeBase(mundo.mundo.dueno, mundo.empresa, { nombre: "Milanesa" });
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

    it("la ficha de un insumo muestra la casilla sin tildar; ningún componente rompe", async () => {
      await abrir(insumo);
      await casilla().waitFor();
      expect(await casilla().isChecked()).toBe(false);
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
      expect(vigilante.tomar()).toEqual([]);
    });

    it("marcar y guardar con DOBLE TOQUE: queda UN artículo y UNA auditoría, y al recargar sigue marcada", async () => {
      await casilla().check();
      await guardarDosVeces();
      await abrir(insumo);
      expect(await casilla().isChecked()).toBe(true);
      expect(await articulosActivos(insumo)).toBe(1);
      expect(await auditorias("ARTICULO_CONTROLADO", insumo)).toBe(1);
      expect(vigilante.tomar()).toEqual([]);
    });

    it("desmarcar y guardar: al recargar sigue desmarcada y el artículo queda inactivo", async () => {
      await casilla().uncheck();
      await guardarDosVeces();
      await abrir(insumo);
      expect(await casilla().isChecked()).toBe(false);
      expect(await articulosActivos(insumo)).toBe(0);
      expect(await auditorias("ARTICULO_DEJADO_DE_CONTROLAR", insumo)).toBe(1);
      expect(vigilante.tomar()).toEqual([]);
    });

    it("un producto vendible (un plato) no ofrece la casilla", async () => {
      await abrir(plato);
      await pagina.getByRole("button", { name: "Guardar", exact: true }).waitFor();
      expect(await pagina.getByRole("checkbox", { name: "Se controla el stock" }).count()).toBe(0);
      expect(await articulosActivos(plato)).toBe(0);
    });
  },
);
