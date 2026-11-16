import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { grupoDeBase, opcionDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * Las OPCIONES de un producto (A13), de punta a punta en la app REAL construida y con un navegador real: la persona abre la ficha, entra a «Opciones», agrega un grupo con dos opciones y un
 * recargo (con un doble toque en «Guardar»: se escribe una sola vez), edita el grupo y quita una opción, y copia las opciones de otro producto. Lo que esta prueba ve y las de componentes no: las
 * páginas en el servidor (el permiso, la lectura de la base), las acciones de servidor (formularios con `.bind`, `redirect`), las cabeceras de la app (CSP) y que ningún componente rompa en el
 * navegador (un `Boton` sin `"use client"`, React #441: las filas se agregan y se quitan con botones). La base se mira por separado: el grupo, las versiones y la auditoría.
 *
 * El módulo `catalogo` está «en desarrollo» en la app real: SOLO en el proceso de esta prueba se lee como «disponible» (`apoyo/activar-modulos-en-desarrollo.mjs`); la empresa lo tiene activo
 * por su plan, como pide el guard. La persona es gerente (tiene `opciones.editar`).
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "recorrido de las opciones de un producto: de la ficha a copiar",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;
    let milanesa = "";
    let hamburguesa = "";
    let latte = "";

    const ir = async (ruta: string) => {
      const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
      await pagina.waitForLoadState("networkidle");
      return respuesta;
    };
    /**
     * Después de guardar o copiar la acción vuelve a las opciones del producto. HALLAZGO (a informar, no se arregla acá): en este arnés (la app real detrás de la fachada https) la redirección
     * de CUALQUIER acción de servidor del catálogo termina en «No encontrado» (también la de la ficha, que ya existía); la dirección sí es la correcta y volver a pedirla muestra la pantalla.
     * Por eso se espera la dirección y se la vuelve a pedir: lo que se verifica es lo que la acción escribió.
     */
    const alTerminar = async () => {
      await pagina.waitForURL(`**/catalogo/productos/${milanesa}/opciones`);
      await ir(`/catalogo/productos/${milanesa}/opciones`);
    };
    const sinViolacionesDeAxe = async () =>
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);
    const consultar = async <T extends Record<string, unknown>>(sql: string, args: unknown[]) =>
      (await mundo.mundo.dueno.query<T>(sql, args)).rows;
    const gruposDe = (producto: string) =>
      consultar<{ nombre: string; clase: string; activo: boolean }>(
        "select nombre, clase, activo from grupo_de_elecciones where producto_id = $1 order by orden, nombre",
        [producto],
      );
    const versionesDe = (producto: string) =>
      consultar<{ nombre: string; numero: number; recargo: string }>(
        "select v.nombre, v.numero, v.recargo from opcion o join version_de_opcion v on v.opcion_id = o.id where o.producto_id = $1 order by v.nombre, v.numero",
        [producto],
      );
    const auditorias = async (producto: string) =>
      Number(
        (
          await consultar<{ n: string }>(
            "select count(*)::text as n from auditoria_empresa where accion = 'OPCIONES_EDITADAS' and entidad_id = $1",
            [producto],
          )
        )[0]?.n,
      );

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base, {
        modulosAdicionales: ["catalogo"],
        activarModulosEnDesarrollo: true,
      });
      const c = mundo.mundo.dueno;
      milanesa = await productoDeBase(c, mundo.empresa, { nombre: "Milanesa" });
      latte = await productoDeBase(c, mundo.empresa, { nombre: "Latte" });
      hamburguesa = await productoDeBase(c, mundo.empresa, { nombre: "Hamburguesa" });
      const salsas = await grupoDeBase(c, mundo.empresa, hamburguesa, {
        clase: "ADICIONAL",
        nombre: "Salsas",
        admiteVarias: true,
        orden: 1,
      });
      await opcionDeBase(c, mundo.empresa, hamburguesa, salsas, {
        nombre: "Mayonesa",
        recargo: "400.00",
      });
      await opcionDeBase(c, mundo.empresa, hamburguesa, salsas, { nombre: "Ketchup" });

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

    it("desde la ficha, el enlace «Opciones» lleva a las opciones del producto (vacías al principio) y ningún componente rompe", async () => {
      const r = await ir(`/catalogo/productos/${milanesa}`);
      expect(r?.status()).toBe(200);
      await pagina.getByRole("link", { name: "Opciones" }).click();
      await pagina.waitForURL(`**/catalogo/productos/${milanesa}/opciones`);
      await pagina.getByRole("heading", { name: "Grupos de opciones" }).waitFor();
      expect(await pagina.getByRole("link", { name: "Agregar grupo" }).count()).toBe(1);
      expect(await pagina.getByRole("link", { name: "Copiar de otro producto" }).count()).toBe(1);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("agrega un grupo adicional con dos opciones (una con recargo): con DOBLE TOQUE en «Guardar» se escribe una sola vez", async () => {
      await pagina.getByRole("link", { name: "Agregar grupo" }).click();
      await pagina.waitForURL("**/opciones/nuevo");
      await pagina.getByLabel("Nombre", { exact: true }).first().fill("Agregados");
      await pagina.getByRole("checkbox", { name: "Adicional" }).check();
      await pagina.getByRole("checkbox", { name: "Se puede elegir más de una" }).check();
      await pagina.getByLabel("Nombre", { exact: true }).nth(1).fill("Queso extra");
      await pagina.getByLabel("Recargo", { exact: true }).first().fill("500");
      await pagina.getByRole("button", { name: "Agregar opción" }).click();
      await pagina.getByLabel("Nombre", { exact: true }).nth(2).fill("Huevo");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Guardar" }).dblclick();
      await alTerminar();
      await pagina.getByText("Queso extra + $ 500,00 · Huevo").waitFor();
      expect(await gruposDe(milanesa)).toEqual([
        { nombre: "Agregados", clase: "ADICIONAL", activo: true },
      ]);
      expect(await versionesDe(milanesa)).toEqual([
        { nombre: "Huevo", numero: 1, recargo: "0.000000" },
        { nombre: "Queso extra", numero: 1, recargo: "500.000000" },
      ]);
      expect(await auditorias(milanesa)).toBe(1);
      pantallaLimpia();
    });

    it("edita el grupo: cambia el recargo de una opción y quita la otra; nada se borra (la quitada queda desactivada, la cambiada tiene versión 2)", async () => {
      await pagina.getByRole("link", { name: "Editar" }).click();
      await pagina.getByRole("heading", { name: "Editar" }).waitFor();
      await pagina.getByLabel("Recargo", { exact: true }).first().fill("650");
      await pagina.getByRole("button", { name: "Quitar" }).nth(1).click();
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await alTerminar();
      await pagina.getByText("Queso extra + $ 650,00").waitFor();
      expect(await pagina.getByText("Huevo").count()).toBe(0);
      expect(await versionesDe(milanesa)).toEqual([
        { nombre: "Huevo", numero: 1, recargo: "0.000000" },
        { nombre: "Queso extra", numero: 1, recargo: "500.000000" },
        { nombre: "Queso extra", numero: 2, recargo: "650.000000" },
      ]);
      expect(
        (
          await consultar<{ activa: boolean }>(
            "select o.activa from opcion o join version_de_opcion v on v.opcion_id = o.id where o.producto_id = $1 and v.nombre = 'Huevo'",
            [milanesa],
          )
        ).map((f) => f.activa),
      ).toEqual([false]);
      expect(await auditorias(milanesa)).toBe(2);
      pantallaLimpia();
    });

    it("un nombre vacío no se guarda: «Falta el nombre» queda en su campo y no se escribe nada", async () => {
      await pagina.getByRole("link", { name: "Agregar grupo" }).click();
      await pagina.waitForURL("**/opciones/nuevo");
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await pagina.getByText("Falta el nombre").first().waitFor();
      expect(await gruposDe(milanesa)).toHaveLength(1);
      expect(await auditorias(milanesa)).toBe(2);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("la medida: agrega la variante «Tamaño» (es la medida) con dos opciones sin recargo y, desde «Precios» → «Según medida», carga el precio de cada una; con DOBLE TOQUE se escribe una sola vez", async () => {
      await ir(`/catalogo/productos/${latte}/opciones`);
      await pagina.getByRole("link", { name: "Agregar variante" }).click();
      await pagina.waitForURL("**/opciones/variante");
      expect(await pagina.getByLabel("Recargo", { exact: true }).count()).toBe(0);
      await pagina.getByLabel("Nombre", { exact: true }).first().fill("Tamaño");
      await pagina.getByRole("checkbox", { name: "Es la medida" }).check();
      await pagina.getByLabel("Nombre", { exact: true }).nth(1).fill("Chico");
      await pagina.getByRole("button", { name: "Agregar opción" }).click();
      await pagina.getByLabel("Nombre", { exact: true }).nth(2).fill("Grande");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Guardar" }).dblclick();
      await pagina.waitForURL(`**/catalogo/productos/${latte}/opciones`);
      await ir(`/catalogo/productos/${latte}/opciones`);
      await pagina.getByText("Es la medida").waitFor();
      await pagina.getByText("Chico · Grande").waitFor();
      expect(await gruposDe(latte)).toEqual([
        { nombre: "Tamaño", clase: "VARIANTE", activo: true },
      ]);
      expect(await auditorias(latte)).toBe(1);

      await ir(`/catalogo/productos/${latte}/precios`);
      await pagina.getByRole("link", { name: "Según medida" }).click();
      await pagina.waitForURL("**/precios/medidas");
      await pagina.getByLabel("Chico", { exact: true }).fill("3200");
      await pagina.getByLabel("Grande", { exact: true }).fill("3800");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Guardar" }).dblclick();
      // La acción vuelve a la misma dirección: se espera lo que escribió, no la dirección.
      const filas = async () =>
        (
          await consultar<{ n: string }>(
            "select count(*)::text as n from precio_de_venta where producto_id = $1 and opcion_id is not null and sucursal_id is null",
            [latte],
          )
        )[0]?.n;
      await expect.poll(filas).toBe("2");
      await ir(`/catalogo/productos/${latte}/precios/medidas`);
      expect(await pagina.getByLabel("Chico", { exact: true }).inputValue()).toBe("3.200,00");
      expect(await pagina.getByLabel("Grande", { exact: true }).inputValue()).toBe("3.800,00");
      expect(await filas()).toBe("2");
      pantallaLimpia();
    });

    it("copia las opciones de otro producto: llegan sus grupos, el origen no cambia y copiar dos veces no duplica", async () => {
      await ir(`/catalogo/productos/${milanesa}/opciones/copiar`);
      await pagina.getByLabel("Producto", { exact: true }).selectOption({ label: "Hamburguesa" });
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Copiar" }).dblclick();
      await alTerminar();
      await pagina
        .getByText(/Mayonesa \+ \$ 400,00/)
        .first()
        .waitFor();
      expect((await gruposDe(milanesa)).map((g) => g.nombre).sort()).toEqual([
        "Agregados",
        "Salsas",
      ]);
      expect((await gruposDe(hamburguesa)).map((g) => g.nombre)).toEqual(["Salsas"]);
      pantallaLimpia();
    });
  },
);
