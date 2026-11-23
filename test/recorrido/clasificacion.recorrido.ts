import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * La CLASIFICACIÓN COMERCIAL, de punta a punta en la app REAL construida y con un navegador real: la persona (gerente) arma el árbol (crea un departamento y una categoría, renombra, mueve,
 * desactiva) y clasifica un producto desde su ficha con la hoja «Cambiar». Lo que esta prueba ve y las de componentes no: la página y las acciones de servidor, el permiso, la base, las cabeceras de la
 * app (CSP) y que ningún componente rompa en el navegador (un `Boton` sin `"use client"`, React #441).
 *
 * `catalogo` está «en desarrollo» en la app real: SOLO en el proceso de esta prueba se lee como «disponible» (`apoyo/activar-modulos-en-desarrollo.mjs`); la empresa lo tiene activo por su plan,
 * como pide el guard. Los pasos son SECUENCIALES a propósito: cada uno parte de lo que dejó el anterior.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "recorrido de la clasificación: del árbol a la ficha del producto",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;
    let producto = "";

    const ir = async (ruta: string) => {
      const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
      await pagina.waitForLoadState("networkidle");
      return respuesta;
    };
    const sinViolacionesDeAxe = async () =>
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);
    const nodos = async () =>
      (
        await mundo.mundo.dueno.query<{ nombre: string; activo: boolean; padre: string | null }>(
          `select n.nombre, n.activo, p.nombre as padre
           from nodo_de_clasificacion n left join nodo_de_clasificacion p on p.id = n.padre_id
          where n.empresa_id = $1 order by n.nombre`,
          [mundo.empresa],
        )
      ).rows;
    const vinculos = async () =>
      Number(
        (
          await mundo.mundo.dueno.query<{ n: string }>(
            "select count(*)::text as n from clasificacion_de_producto where empresa_id = $1",
            [mundo.empresa],
          )
        ).rows[0]?.n,
      );
    const hoja = () => pagina.getByRole("dialog");
    // Cada fila con hijos tiene dos botones con el nombre del nodo: el que pliega (primero) y el que abre sus acciones (el último).
    const fila = (nombre: string) =>
      pagina.getByRole("button", { name: new RegExp(`^${nombre}`) }).last();
    const crear = async (nombre: string) => {
      await hoja().getByRole("textbox", { name: "Nombre" }).fill(nombre);
      await hoja().getByRole("button", { name: "Guardar" }).click();
      await hoja().waitFor({ state: "detached" });
    };

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base, {
        modulosAdicionales: ["catalogo"],
        activarModulosEnDesarrollo: true,
      });
      producto = await productoDeBase(mundo.mundo.dueno, mundo.empresa, { nombre: "Hamburguesa" });
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

    it("sin departamentos la pantalla solo ofrece «Crear», y en la ficha «Cambiar» sale apagado y el producto «Sin elegir»", async () => {
      const r = await ir("/catalogo/clasificacion");
      expect(r?.status()).toBe(200);
      await pagina.getByRole("button", { name: "Crear" }).waitFor();
      expect(await pagina.locator("button[aria-haspopup=dialog]").count()).toBe(0);
      await sinViolacionesDeAxe();
      pantallaLimpia();
      await ir(`/catalogo/productos/${producto}`);
      expect(await pagina.getByRole("button", { name: "Cambiar" }).isDisabled()).toBe(true);
      await pagina.locator("dd", { hasText: "Sin elegir" }).waitFor();
      pantallaLimpia();
    });

    it("crear un departamento y una categoría adentro: quedan en la base, con su padre", async () => {
      await ir("/catalogo/clasificacion");
      await pagina.getByRole("button", { name: "Crear" }).click();
      await hoja().waitFor();
      await sinViolacionesDeAxe();
      await crear("Restaurante");
      await fila("Restaurante").click();
      await hoja().getByRole("button", { name: "Crear" }).click();
      await crear("Comidas");
      expect(await nodos()).toEqual([
        { nombre: "Comidas", activo: true, padre: "Restaurante" },
        { nombre: "Restaurante", activo: true, padre: null },
      ]);
      pantallaLimpia();
    });

    it("el departamento no se desactiva con una categoría activa adentro: sale el aviso aprobado y no cambia nada", async () => {
      await fila("Restaurante").click();
      await hoja().getByRole("button", { name: "Desactivar" }).click();
      await hoja().getByText("Primero desactivá lo que tiene adentro.").waitFor();
      await sinViolacionesDeAxe();
      expect((await nodos()).every((n) => n.activo)).toBe(true);
      await hoja().getByRole("button", { name: "Cancelar" }).click();
      await hoja().waitFor({ state: "detached" });
      pantallaLimpia();
    });

    it("renombrar con el nombre nuevo y mover bajo otro departamento (la lista apaga lo que no se puede)", async () => {
      await fila("Restaurante").click();
      await hoja().getByRole("button", { name: "Crear" }).click();
      await crear("Bebidas");
      await fila("Restaurante").click();
      await hoja().getByRole("button", { name: "Renombrar" }).click();
      await hoja().getByRole("textbox", { name: "Nombre" }).fill("Gastronomía");
      await hoja().getByRole("button", { name: "Guardar" }).click();
      await hoja().waitFor({ state: "detached" });
      await pagina.getByRole("button", { name: "Crear", exact: true }).first().click();
      await crear("Alojamiento");
      await fila("Bebidas").click();
      await hoja().getByRole("button", { name: "Mover" }).click();
      const lista = hoja().getByRole("combobox");
      expect(await lista.locator("option:disabled").allTextContents()).toEqual([
        "Gastronomía › Bebidas",
      ]);
      await lista.selectOption({ label: "Alojamiento" });
      await hoja().getByRole("button", { name: "Guardar" }).click();
      await hoja().waitFor({ state: "detached" });
      const lo = await nodos();
      expect(lo.find((n) => n.nombre === "Bebidas")?.padre).toBe("Alojamiento");
      expect(lo.some((n) => n.nombre === "Restaurante")).toBe(false);
      pantallaLimpia();
    });

    it("la ficha del producto: «Cambiar» con selectores encadenados, rige desde ahora y un doble toque guarda una sola vez", async () => {
      await ir(`/catalogo/productos/${producto}`);
      await pagina.getByRole("button", { name: "Cambiar" }).click();
      await hoja().waitFor();
      await hoja()
        .getByRole("combobox", { name: "Departamento" })
        .selectOption({ label: "Gastronomía" });
      await hoja().getByRole("combobox", { name: "Categoría" }).selectOption({ label: "Comidas" });
      await sinViolacionesDeAxe();
      await hoja().getByRole("button", { name: "Guardar" }).dblclick();
      await hoja().waitFor({ state: "detached" });
      await pagina.getByText("Vigente desde").waitFor();
      expect(await vinculos()).toBe(1);
      expect(await pagina.getByText("Gastronomía").count()).toBeGreaterThan(0);
      expect(await pagina.getByText("Comidas").count()).toBeGreaterThan(0);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });
  },
);
