import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";
import { cuentaDeImagenDeBase } from "../integracion/carta-publica-apoyo";

/**
 * «CARTA EN LÍNEA» con su identidad (V1), de punta a punta en la app REAL construida y con un navegador real: la persona abre la pantalla, elige la cara, un color propio y la dirección de su logo, toca «Guardar» (con
 * un doble toque) y la carta queda guardada UNA vez, fuera de línea, con lo elegido; al volver a abrir la pantalla lo ve; un color mal escrito no deja guardar; «Quitar» vacía el logo. Lo que esta prueba ve y las de
 * componentes no: la página en el servidor (permisos, sucursal, lectura de la base), la acción de servidor con el formulario real, las cabeceras de la app (CSP) y que ningún componente rompa en el navegador (un
 * `Boton` sin `"use client"`, React #441).
 *
 * El módulo `vidriera` puede estar «en desarrollo» en la app real: SOLO en el proceso de esta prueba se lee como «disponible» (`apoyo/activar-modulos-en-desarrollo.mjs`); la empresa lo tiene activo por su plan,
 * como pide el guard. Lo que queda escrito lo comprueba la prueba contra la base. NO ve la carta pública con la cara nueva: la plantilla pública todavía no dibuja la identidad (hallazgo del PR V1).
 */
const base = inject("baseDePruebas");
const LOGO = "https://res.cloudinary.com/demo/image/upload/v1700000000/logos/parador.png";

describe.skipIf(base === null)(
  "recorrido de Carta en línea: de la pantalla a la identidad guardada",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;

    const cartas = async () =>
      (
        await mundo.mundo.dueno.query<Record<string, unknown>>(
          "select * from carta_publica where empresa_id = $1",
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
      const r = await pagina.goto(`${mundo.url}/catalogo/carta-en-linea`);
      await pagina.waitForLoadState("networkidle");
      expect(r?.status()).toBe(200);
    };

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base, {
        modulosAdicionales: ["catalogo", "vidriera"],
        activarModulosEnDesarrollo: true,
      });
      // La cuenta del logo («demo») la declara la empresa ANTES de guardar el logo (0102).
      const miembro = await mundo.mundo.dueno.query<{ persona_id: string }>(
        "select persona_id from membresia where empresa_id = $1 limit 1",
        [mundo.empresa],
      );
      await cuentaDeImagenDeBase(
        mundo.mundo.dueno,
        mundo.empresa,
        miembro.rows[0]?.persona_id as string,
        "demo",
      );
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

    it("la pantalla muestra los textos, la cara de siempre, «Usar lo de la empresa» y el logo vacío; ningún componente rompe", async () => {
      await abrir();
      await pagina.getByLabel("Nombre", { exact: true }).waitFor();
      expect(await pagina.getByRole("radio", { name: "Día" }).isChecked()).toBe(true);
      expect(await pagina.getByLabel("Colores").inputValue()).toBe("");
      expect(await pagina.getByLabel("Dirección de la imagen").inputValue()).toBe("");
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
      expect(vigilante.tomar()).toEqual([]);
    });

    it("un color mal escrito avisa y no deja guardar", async () => {
      await pagina.getByLabel("Colores").selectOption("otro");
      await pagina.getByLabel("Otro color", { exact: true }).fill("#12345");
      await pagina.getByText("Escribí el color como #0e7490").waitFor();
      expect(await boton("Guardar").isDisabled()).toBe(true);
    });

    it("elegir cara, color y logo y «Guardar» con DOBLE TOQUE: UNA carta fuera de línea con lo elegido y UNA auditoría", async () => {
      await pagina.getByLabel("Nombre", { exact: true }).fill("Parador El Ensayo");
      await pagina.getByRole("radio", { name: "Noche" }).check();
      await pagina.getByLabel("Otro color", { exact: true }).fill("#0e7490");
      await pagina.getByLabel("Dirección de la imagen").fill(LOGO);
      await boton("Guardar").dblclick();
      await pagina.getByText("Fuera de línea", { exact: true }).waitFor();
      const filas = await cartas();
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        nombre: "Parador El Ensayo",
        estado: "FUERA_DE_LINEA",
        cara: "NOCHE",
        color_propio: "#0e7490",
        logo_proveedor: "CLOUDINARY",
        logo_cuenta: "demo",
        logo_id_publico: "logos/parador",
        version: 1,
      });
      expect(await auditorias("CARTA_PUBLICA_CREADA")).toBe(1);
      expect(vigilante.tomar()).toEqual([]);
    });

    it("al volver a abrir la pantalla se ve lo guardado", async () => {
      await abrir();
      expect(await pagina.getByRole("radio", { name: "Noche" }).isChecked()).toBe(true);
      expect(await pagina.getByLabel("Colores").inputValue()).toBe("otro");
      expect(await pagina.getByLabel("Otro color", { exact: true }).inputValue()).toBe("#0e7490");
      expect(await pagina.getByLabel("Dirección de la imagen").inputValue()).toBe(LOGO);
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    });

    it("«Quitar» vacía el logo y «Guardar» lo deja sin logo, conservando la cara y el color", async () => {
      await boton("Quitar").click();
      await boton("Guardar").click();
      await pagina.waitForLoadState("networkidle");
      await expect
        .poll(async () => (await cartas())[0]?.["logo_proveedor"], { timeout: 15_000 })
        .toBeNull();
      expect((await cartas())[0]).toMatchObject({
        cara: "NOCHE",
        color_propio: "#0e7490",
        version: 2,
      });
      expect(await auditorias("CARTA_PUBLICA_EDITADA")).toBe(1);
      expect(vigilante.tomar()).toEqual([]);
    });
  },
);
