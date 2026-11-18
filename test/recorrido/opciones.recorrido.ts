import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { grupoDeBase, opcionDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * Las OPCIONES de un producto (A13), de punta a punta en la app REAL construida y con un navegador real: la persona abre la ficha, entra a «Opciones», agrega un grupo «Adicional» con dos
 * opciones y un recargo (con un doble toque en «Guardar»: se escribe una sola vez), edita el grupo y saca una opción vaciando su nombre, y copia las opciones de otro producto desde la hoja,
 * viendo antes qué se va a traer. Lo que esta prueba ve y las de componentes no: las páginas en el servidor (el permiso, la lectura de la base, la hoja que se abre por `?copiar=`), las
 * acciones de servidor (formularios con `.bind`, `redirect`), las cabeceras de la app (CSP) y que ningún componente rompa en el navegador (un `Boton` sin `"use client"`, React #441: las filas
 * se agregan con un botón y la hoja es un componente de cliente). La base se mira por separado: el grupo, las versiones y la auditoría.
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
        orden: 1,
      });
      // Con `orden` distinto: con el mismo, las opciones salen en el orden de su id (al azar) y la vista previa («Mayonesa … · Ketchup») no sería siempre la misma.
      await opcionDeBase(c, mundo.empresa, hamburguesa, salsas, { nombre: "Ketchup", orden: 2 });

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

    it("agrega un grupo adicional con dos opciones (una con recargo): con DOBLE TOQUE en «Guardar» se escribe una sola vez; la fila que queda vacía no se guarda", async () => {
      await pagina.getByRole("link", { name: "Agregar grupo" }).click();
      await pagina.waitForURL("**/opciones/nuevo");
      await pagina.getByRole("heading", { name: "Agregar grupo" }).waitFor();
      // Un grupo nuevo nace «Incluida», obligatorio y con dos filas vacías.
      expect(await pagina.getByRole("radio", { name: "Incluida" }).isChecked()).toBe(true);
      expect(await pagina.getByRole("checkbox", { name: "Obligatorio" }).isChecked()).toBe(true);
      await pagina.getByLabel("Nombre", { exact: true }).first().fill("Agregados");
      await pagina.getByRole("radio", { name: "Adicional" }).check();
      await pagina.getByRole("checkbox", { name: "Se puede elegir más de una" }).check();
      await pagina.getByLabel("Nombre", { exact: true }).nth(1).fill("Queso extra");
      await pagina.getByLabel("Recargo", { exact: true }).first().fill("500");
      await pagina.getByLabel("Nombre", { exact: true }).nth(2).fill("Huevo");
      // Una tercera fila que queda vacía: no es una opción y no se guarda.
      await pagina.getByRole("button", { name: "Agregar opción" }).click();
      expect(await pagina.getByLabel("Nombre", { exact: true }).count()).toBe(4);
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

    it("edita el grupo: «Incluida / Adicional» se ve apagado; cambia el recargo de una opción y saca la otra vaciando su nombre; nada se borra (la sacada queda desactivada, la cambiada tiene versión 2)", async () => {
      await pagina.getByRole("link", { name: "Editar" }).click();
      await pagina.getByRole("heading", { name: "Editar" }).waitFor();
      const adicional = pagina.getByRole("radio", { name: "Adicional" });
      expect(await adicional.isChecked()).toBe(true);
      expect(await adicional.isDisabled()).toBe(true);
      expect(await pagina.getByRole("radio", { name: "Incluida" }).isDisabled()).toBe(true);
      expect(await pagina.getByRole("button", { name: "Quitar" }).count()).toBe(0);
      await pagina.getByLabel("Recargo", { exact: true }).first().fill("650");
      await pagina.getByLabel("Nombre", { exact: true }).nth(2).fill("");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await alTerminar();
      await pagina.getByText("Queso extra + $ 650,00").waitFor();
      expect(await pagina.getByText("Huevo").count()).toBe(0);
      expect(await gruposDe(milanesa)).toEqual([
        { nombre: "Agregados", clase: "ADICIONAL", activo: true },
      ]);
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

    it("un nombre de grupo vacío no se guarda: «Falta el nombre» queda en su campo; un grupo con nombre y todas las filas vacías sale como el genérico; no se escribe nada", async () => {
      await pagina.getByRole("link", { name: "Agregar grupo" }).click();
      await pagina.waitForURL("**/opciones/nuevo");
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await pagina.getByText("Falta el nombre").first().waitFor();
      await sinViolacionesDeAxe();
      await pagina.getByLabel("Nombre", { exact: true }).first().fill("Sin opciones");
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await pagina.getByText("Esta acción no está permitida").waitFor();
      expect(await gruposDe(milanesa)).toHaveLength(1);
      expect(await auditorias(milanesa)).toBe(2);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("copia las opciones de otro producto desde la hoja: se ve QUÉ se va a traer antes de copiar, cancelar no copia, el origen no cambia y copiar dos veces no duplica", async () => {
      await ir(`/catalogo/productos/${milanesa}/opciones`);
      await pagina.getByRole("link", { name: "Copiar de otro producto" }).click();
      await pagina.waitForURL("**/opciones?copiar=1");
      const hoja = pagina.getByRole("dialog", { name: "Copiar de otro producto" });
      await hoja.waitFor();
      // La vista previa de lo que trae el origen elegido (la arma el servidor).
      await hoja.getByText("Salsas: Mayonesa + $ 400,00 · Ketchup").waitFor();
      await hoja.getByText("Grupos de opciones").waitFor();
      await sinViolacionesDeAxe();
      // Cancelar vuelve a la solapa, sin la hoja y sin copiar nada.
      await hoja.getByRole("button", { name: "Cancelar" }).click();
      await pagina.waitForURL(`**/catalogo/productos/${milanesa}/opciones`);
      await hoja.waitFor({ state: "detached" });
      expect((await gruposDe(milanesa)).map((g) => g.nombre)).toEqual(["Agregados"]);
      // Se vuelve a abrir y se copia con doble toque.
      await pagina.getByRole("link", { name: "Copiar de otro producto" }).click();
      await hoja.getByText("Salsas: Mayonesa + $ 400,00 · Ketchup").waitFor();
      await hoja.getByRole("button", { name: "Copiar", exact: true }).dblclick();
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
      expect(await pagina.getByRole("dialog").count()).toBe(0);
      pantallaLimpia();
    });

    it("sin nada para traer, la hoja se abre con «Copiar» apagado", async () => {
      await pagina.getByRole("link", { name: "Copiar de otro producto" }).click();
      const hoja = pagina.getByRole("dialog", { name: "Copiar de otro producto" });
      await hoja.waitFor();
      expect(await hoja.getByRole("button", { name: "Copiar", exact: true }).isDisabled()).toBe(
        true,
      );
      expect(await hoja.getByText("Grupos de opciones").count()).toBe(0);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });
  },
);
