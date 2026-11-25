import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * Las PRESENTACIONES de compra de un producto (T0), de punta a punta en la app REAL construida y con un navegador real: la persona abre la ficha de una materia prima, entra a «Cómo se compra»
 * (vacío al principio), agrega una presentación de cantidad fija con un doble toque en «Agregar presentación» (se escribe una sola vez), repite el mismo alta (no duplica) y prueba un nombre
 * repetido con otra cantidad (el genérico) y una cantidad en cero (su texto, en su campo); agrega otra de peso variable (el rótulo de la cantidad pasa a «Peso aproximado» y la lista la muestra con
 * «≈»); renombra una, la desactiva y la reactiva. Lo que esta prueba ve y las de componentes no: las páginas en el servidor (el permiso, la lectura de la base), las acciones de servidor (formularios
 * con `.bind`, `redirect`), las cabeceras de la app (CSP) y que ningún componente rompa en el navegador (un `Boton` sin `"use client"`, React #441). La base se mira por separado: las filas, las
 * versiones y la auditoría.
 *
 * El módulo `catalogo` está «en desarrollo» en la app real: SOLO en el proceso de esta prueba se lee como «disponible» (`apoyo/activar-modulos-en-desarrollo.mjs`); la empresa lo tiene activo por su
 * plan, como pide el guard. La persona es gerente (tiene `productos.editar`).
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "recorrido de las presentaciones de un producto: de la ficha a desactivar y reactivar",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;
    let queso = "";
    let milanesa = "";

    const ruta = () => `/catalogo/productos/${queso}/compra`;
    const ir = async (destino: string) => {
      const respuesta = await pagina.goto(`${mundo.url}${destino}`);
      await pagina.waitForLoadState("networkidle");
      return respuesta;
    };
    /**
     * Después de guardar la acción vuelve a la lista del producto. HALLAZGO ya conocido (ver `opciones.recorrido.ts`): en este arnés (la app real detrás de la fachada https) la redirección de
     * CUALQUIER acción de servidor del catálogo termina en «No encontrado»; la dirección sí es la correcta y volver a pedirla muestra la pantalla. Por eso se espera la dirección y se la vuelve a
     * pedir: lo que se verifica es lo que la acción escribió.
     */
    const alTerminar = async () => {
      await pagina.waitForURL(`**${ruta()}`);
      await ir(ruta());
    };
    const sinViolacionesDeAxe = async () =>
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);
    const consultar = async <T extends Record<string, unknown>>(sql: string, args: unknown[]) =>
      (await mundo.mundo.dueno.query<T>(sql, args)).rows;
    const presentaciones = (producto: string) =>
      consultar<{ nombre: string; cantidad: string; de_peso_variable: boolean; activa: boolean }>(
        "select nombre, cantidad::text, de_peso_variable, activa from presentacion_de_producto where producto_id = $1 order by nombre_clave",
        [producto],
      );
    const auditorias = async (accion: string) =>
      Number(
        (
          await consultar<{ n: string }>(
            "select count(*)::text as n from auditoria_empresa a join presentacion_de_producto p on p.id::text = a.entidad_id where a.accion = $1 and p.producto_id = $2",
            [accion, queso],
          )
        )[0]?.n,
      );
    const agregar = async (nombre: string, cantidad: string) => {
      await ir(`${ruta()}/nueva`);
      await pagina.getByRole("heading", { name: "Agregar presentación" }).waitFor();
      await pagina.getByLabel("Presentación", { exact: true }).fill(nombre);
      await pagina
        .getByLabel(/^(Cantidad en la unidad base|Peso aproximado) \(kg\)$/)
        .fill(cantidad);
    };

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base, {
        modulosAdicionales: ["catalogo"],
        activarModulosEnDesarrollo: true,
      });
      const c = mundo.mundo.dueno;
      queso = await productoDeBase(c, mundo.empresa, {
        nombre: "Queso cremoso",
        clase: "MATERIA_PRIMA",
        unidadBase: "KILOGRAMO",
        dimension: "MASA",
      });
      milanesa = await productoDeBase(c, mundo.empresa, { nombre: "Milanesa" });

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

    it("la ficha de lo que se compra enlaza a «Cómo se compra» (vacío al principio) y la de lo que solo se vende no; ningún componente rompe", async () => {
      const vendible = await ir(`/catalogo/productos/${milanesa}`);
      expect(vendible?.status()).toBe(200);
      expect(await pagina.getByRole("link", { name: "Cómo se compra" }).count()).toBe(0);
      const r = await ir(`/catalogo/productos/${queso}`);
      expect(r?.status()).toBe(200);
      await pagina.getByRole("link", { name: "Cómo se compra" }).click();
      await pagina.waitForURL(`**${ruta()}`);
      await pagina.getByRole("heading", { name: "Cómo se compra" }).waitFor();
      await pagina.getByText("Sin presentaciones").waitFor();
      expect(await pagina.getByRole("link", { name: "Agregar presentación" }).count()).toBe(1);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("agrega una presentación de cantidad fija: con DOBLE TOQUE en «Agregar presentación» se escribe una sola vez y queda en la lista con su cantidad", async () => {
      await agregar("Caja de 5 kg", "5");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Agregar presentación" }).dblclick();
      await alTerminar();
      await pagina.getByText("Caja de 5 kg").waitFor();
      await pagina.getByText("5 kg", { exact: true }).waitFor();
      expect(await presentaciones(queso)).toEqual([
        { nombre: "Caja de 5 kg", cantidad: "5.0000", de_peso_variable: false, activa: true },
      ]);
      expect(await auditorias("PRESENTACION_CREADA")).toBe(1);
      pantallaLimpia();
    });

    it("repetir el mismo alta no duplica; el mismo nombre con otra cantidad sale como el genérico y no escribe", async () => {
      await agregar("caja de 5 KG", "5");
      await pagina.getByRole("button", { name: "Agregar presentación" }).click();
      await alTerminar();
      expect(await presentaciones(queso)).toHaveLength(1);
      expect(await auditorias("PRESENTACION_CREADA")).toBe(1);
      await agregar("Caja de 5 kg", "6");
      await pagina.getByRole("button", { name: "Agregar presentación" }).click();
      await pagina.getByText("Esta acción no está permitida").waitFor();
      await sinViolacionesDeAxe();
      expect(await presentaciones(queso)).toHaveLength(1);
      pantallaLimpia();
    });

    it("una cantidad en cero no se guarda: «La cantidad tiene que ser mayor que cero» queda en su campo y lo escrito se conserva", async () => {
      await agregar("Bolsa de 10 kg", "0");
      await pagina.getByRole("button", { name: "Agregar presentación" }).click();
      await pagina.getByText("La cantidad tiene que ser mayor que cero").waitFor();
      expect(await pagina.getByLabel("Presentación", { exact: true }).inputValue()).toBe(
        "Bolsa de 10 kg",
      );
      expect(
        await pagina.getByLabel("Cantidad en la unidad base (kg)").getAttribute("aria-invalid"),
      ).toBe("true");
      await sinViolacionesDeAxe();
      expect(await presentaciones(queso)).toHaveLength(1);
      pantallaLimpia();
    });

    it("agrega una de peso variable: el rótulo de la cantidad pasa a «Peso aproximado» y la lista la muestra con «≈» y «De peso variable»", async () => {
      await agregar("Horma", "4,5");
      await pagina.getByRole("checkbox", { name: "De peso variable" }).check();
      await pagina.getByLabel("Peso aproximado (kg)").waitFor();
      expect(await pagina.getByLabel("Peso aproximado (kg)").inputValue()).toBe("4,5");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Agregar presentación" }).click();
      await alTerminar();
      await pagina.getByText("≈ 4,5 kg").waitFor();
      await pagina.getByText("De peso variable").waitFor();
      expect(await presentaciones(queso)).toEqual([
        { nombre: "Caja de 5 kg", cantidad: "5.0000", de_peso_variable: false, activa: true },
        { nombre: "Horma", cantidad: "4.5000", de_peso_variable: true, activa: true },
      ]);
      pantallaLimpia();
    });

    it("renombra una presentación: la cantidad se ve y no se cambia; el mismo nombre otra vez no escribe", async () => {
      await ir(ruta());
      await pagina.getByRole("link", { name: "Editar" }).first().click();
      await pagina.getByRole("heading", { name: "Caja de 5 kg" }).waitFor();
      expect(await pagina.locator('[name="cantidad"]').count()).toBe(0);
      await pagina.getByText("Cantidad en la unidad base (kg)").waitFor();
      await sinViolacionesDeAxe();
      await pagina.getByLabel("Presentación", { exact: true }).fill("Caja grande");
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await alTerminar();
      await pagina.getByText("Caja grande").waitFor();
      expect(await presentaciones(queso)).toEqual([
        { nombre: "Caja grande", cantidad: "5.0000", de_peso_variable: false, activa: true },
        { nombre: "Horma", cantidad: "4.5000", de_peso_variable: true, activa: true },
      ]);
      expect(await auditorias("PRESENTACION_EDITADA")).toBe(1);
      await pagina.getByRole("link", { name: "Editar" }).first().click();
      await pagina.getByRole("heading", { name: "Caja grande" }).waitFor();
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await alTerminar();
      expect(await auditorias("PRESENTACION_EDITADA")).toBe(1);
      pantallaLimpia();
    });

    it("desactiva una presentación (se ve «Desactivado», nada se borra) y la reactiva", async () => {
      await ir(ruta());
      await pagina.getByRole("link", { name: "Editar" }).nth(1).click();
      await pagina.getByRole("heading", { name: "Horma" }).waitFor();
      await pagina.getByText("Peso aproximado (kg)").waitFor();
      await pagina.getByRole("button", { name: "Desactivar" }).click();
      await alTerminar();
      await pagina.getByText("Desactivado").waitFor();
      expect((await presentaciones(queso)).map((p) => [p.nombre, p.activa])).toEqual([
        ["Caja grande", true],
        ["Horma", false],
      ]);
      await sinViolacionesDeAxe();
      await pagina.getByRole("link", { name: "Editar" }).nth(1).click();
      await pagina.getByRole("button", { name: "Reactivar" }).click();
      await alTerminar();
      expect(await pagina.getByText("Desactivado").count()).toBe(0);
      expect((await presentaciones(queso)).map((p) => [p.nombre, p.activa])).toEqual([
        ["Caja grande", true],
        ["Horma", true],
      ]);
      expect(await auditorias("PRESENTACION_EDITADA")).toBe(3);
      pantallaLimpia();
    });

    it("un producto que no se compra, o un id que no existe, sale como el genérico y no dice cuál de los casos es", async () => {
      for (const destino of [
        `/catalogo/productos/${milanesa}/compra`,
        "/catalogo/productos/00000000-0000-4000-8000-000000000000/compra",
        `${ruta()}/00000000-0000-4000-8000-000000000000`,
      ]) {
        await ir(destino);
        await pagina.getByText("Esta acción no está permitida").waitFor();
      }
    });
  },
);
