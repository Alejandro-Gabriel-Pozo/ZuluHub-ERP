import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { sembrarJornadaParaElCierre, type JornadaSembrada } from "./apoyo/jornada-de-caja";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * El CIERRE DEL DÍA, de punta a punta en la app REAL construida y con un navegador real: la persona abre la jornada, empieza el cierre (con un doble toque), corrige el medio de un cobro, declara el total de
 * un medio, pasa por la conciliación, prueba cerrar sin reconocer lo que hay que reconocer (el servidor responde el genérico), reconoce y cierra (con un doble toque) y ve «Cerrada» con quién y cuándo. Lo
 * que esta prueba ve y las de componentes no: la página en el servidor (el permiso, la sucursal, la lectura de la base con el correo de quien hizo cada cosa), las acciones de servidor, las cabeceras de la app
 * (CSP) y que ningún componente rompa en el navegador (un `Boton` sin `"use client"`, React #441). Los módulos «en desarrollo» se leen como «disponibles» SOLO en el proceso de esta prueba
 * (`apoyo/activar-modulos-en-desarrollo.mjs`); la empresa los tiene activos por su plan, como pide el guard. Cada escritura se comprueba contra la base.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "recorrido del cierre del día: de la jornada abierta a «Cerrada»",
  () => {
    let mundo: MundoDelRecorrido;
    let dia: JornadaSembrada;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;

    const ir = async (ruta: string) => {
      const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
      await pagina.waitForLoadState("networkidle");
      return respuesta;
    };
    const sinViolacionesDeAxe = async () =>
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);
    const filas = async <T extends object>(texto: string, parametros: unknown[] = []) =>
      (await mundo.mundo.dueno.query<T>(texto, parametros)).rows;
    const contar = async (texto: string, parametros: unknown[] = []) =>
      Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
    const boton = (nombre: string | RegExp) => pagina.getByRole("button", { name: nombre });
    const fechaEnPantalla = () => dia.fechaDeNegocio.split("-").reverse().join("/");
    const titulo = (nombre: string) => pagina.getByRole("heading", { name: nombre });

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base, {
        modulosAdicionales: ["catalogo", "caja", "cierre", "ventas"],
        activarModulosEnDesarrollo: true,
      });
      dia = await sembrarJornadaParaElCierre(mundo);
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

    it("la jornada abierta muestra su fecha y UNA sola acción, «Empezar el cierre»; ningún componente rompe", async () => {
      const r = await ir("/caja/cierre-del-dia");
      expect(r?.status()).toBe(200);
      await pagina.getByText(`Jornada ${fechaEnPantalla()}`).waitFor();
      await pagina.getByText("Abierta", { exact: true }).waitFor();
      expect(await boton("Empezar el cierre").count()).toBe(1);
      expect(await pagina.getByRole("button").count()).toBeGreaterThanOrEqual(1);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("«Empezar el cierre» con DOBLE TOQUE: la jornada pasa a «En cierre» una sola vez (una sola auditoría)", async () => {
      await boton("Empezar el cierre").dblclick();
      await titulo("Cobros").waitFor();
      await pagina.getByText("En cierre", { exact: true }).waitFor();
      expect(
        (
          await filas<{ estado: string }>(
            "select estado from jornada_de_sucursal where empresa_id = $1",
            [mundo.empresa],
          )
        )[0]?.estado,
      ).toBe("EN_AUDITORIA");
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'JORNADA_EN_AUDITORIA'",
          [mundo.empresa],
        ),
      ).toBe(1);
      pantallaLimpia();
    });

    it("paso 1, «Cobros»: cada cobro con su importe, quién lo registró (el correo) y su medio", async () => {
      const cobroDeTarjeta = pagina.getByRole("group", { name: "$ 600,00" });
      await cobroDeTarjeta.waitFor();
      expect(await cobroDeTarjeta.innerText()).toContain(dia.correo);
      expect(await cobroDeTarjeta.innerText()).toContain("Tarjeta de crédito · Posnet 1");
      const cobroEnEfectivo = pagina.getByRole("group", { name: "$ 400,00" });
      expect(await cobroEnEfectivo.innerText()).toContain("Efectivo");
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("«Corregir medio» con DOBLE TOQUE en «Guardar»: una sola corrección; el cobro queda con su medio nuevo, quién y por qué", async () => {
      await pagina
        .getByRole("group", { name: "$ 600,00" })
        .getByRole("button", { name: "Corregir medio" })
        .click();
      const dialogo = pagina.getByRole("dialog", { name: "Corregir medio" });
      await dialogo.waitFor();
      await sinViolacionesDeAxe();
      await dialogo.getByLabel("Medio correcto").selectOption({ label: "Tarjeta de débito" });
      await dialogo.getByLabel("Cuenta de cobro").selectOption({ label: "Posnet 1" });
      await dialogo.getByLabel("Motivo").fill("Se cobró con crédito y era débito");
      await dialogo.getByRole("button", { name: "Guardar" }).dblclick();
      await dialogo.waitFor({ state: "detached" });
      await pagina.getByText(`Corregido por ${dia.correo}`, { exact: false }).waitFor();
      await pagina.getByText("Se cobró con crédito y era débito").waitFor();
      expect(await pagina.getByRole("group", { name: "$ 600,00" }).innerText()).toContain(
        "Tarjeta de débito · Posnet 1",
      );
      expect(
        await contar("select count(*) as n from correccion_de_medio where empresa_id = $1", [
          mundo.empresa,
        ]),
      ).toBe(1);
      pantallaLimpia();
    });

    it("paso 2, «Conciliación por medio»: lo registrado, lo corregido y lo declarado; declarar el total del débito se guarda una vez", async () => {
      await boton("Conciliación por medio").click();
      await titulo("Conciliación por medio").waitFor();
      await sinViolacionesDeAxe();
      expect(await pagina.getByText("Sin declarar").count()).toBe(1);
      const debito = pagina.getByRole("listitem").filter({ hasText: "Tarjeta de débito" });
      await debito.getByLabel("Declarado").fill("600");
      await debito.getByRole("button", { name: "Guardar" }).dblclick();
      await pagina.getByText("Sin declarar").waitFor({ state: "detached" });
      expect(
        await contar("select count(*) as n from declaracion_de_total where empresa_id = $1", [
          mundo.empresa,
        ]),
      ).toBe(1);
      // El crédito quedó con lo registrado (600) menos lo corregido (600) contra lo que dijo la terminal al cerrar la caja (600): una diferencia que hay que reconocer.
      expect(
        await pagina.getByRole("listitem").filter({ hasText: "Tarjeta de crédito" }).innerText(),
      ).toContain("-$ 600,00");
      pantallaLimpia();
    });

    it("paso 3: cerrar SIN reconocer lo que hay que reconocer es el genérico del servidor y no cierra nada", async () => {
      await boton("Hay que reconocer").click();
      await titulo("Hay que reconocer").waitFor();
      await pagina.getByRole("group", { name: "Conciliación por medio · 1" }).waitFor();
      await sinViolacionesDeAxe();
      await boton("Cerrar el día").click();
      await pagina.getByText("Esta acción no está permitida").waitFor();
      expect(
        (
          await filas<{ estado: string }>(
            "select estado from jornada_de_sucursal where empresa_id = $1",
            [mundo.empresa],
          )
        )[0]?.estado,
      ).toBe("EN_AUDITORIA");
      pantallaLimpia();
    });

    it("«Reconocer» solo marca (nada se manda); «Cerrar el día» con DOBLE TOQUE cierra UNA vez y deja quién y cuándo", async () => {
      const antes = await contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1",
        [mundo.empresa],
      );
      await pagina
        .getByRole("group", { name: "Conciliación por medio · 1" })
        .getByRole("button", { name: "Reconocer" })
        .click();
      const dialogo = pagina.getByRole("dialog", { name: "Reconocer · Conciliación por medio" });
      await dialogo.getByLabel("Observación (opcional)").fill("Se corrigió el medio del cobro");
      await dialogo.getByRole("button", { name: "Reconocer" }).click();
      await boton("✓ Reconocer").waitFor();
      expect(
        await contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
          mundo.empresa,
        ]),
      ).toBe(antes);

      await boton("Cerrar el día").dblclick();
      await pagina.getByText("Cerrada", { exact: true }).waitFor();
      expect(
        (
          await filas<{ estado: string }>(
            "select estado from jornada_de_sucursal where empresa_id = $1",
            [mundo.empresa],
          )
        )[0]?.estado,
      ).toBe("CERRADA");
      expect(
        await contar(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'JORNADA_CERRADA'",
          [mundo.empresa],
        ),
      ).toBe(1);
      pantallaLimpia();
    });

    it("«Cerrada»: quién y cuándo, lo reconocido con quién lo reconoció, y solo se mira (sin acciones)", async () => {
      await pagina.getByText(dia.correo, { exact: false }).first().waitFor();
      await pagina.getByText(`Reconocido por ${dia.correo}`, { exact: false }).waitFor();
      await pagina.getByText("Se corrigió el medio del cobro").waitFor();
      expect(await pagina.getByRole("button").count()).toBe(0);
      expect(await pagina.getByLabel("Declarado").count()).toBe(0);
      // La conciliación y los cobros siguen ahí, plegados, para mirarlos.
      await pagina.getByText("Cobros", { exact: true }).click();
      await pagina.getByRole("group", { name: "$ 600,00" }).waitFor();
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("recargar la pantalla muestra lo mismo: la jornada cerrada es la de hoy y ya no hay otra abierta", async () => {
      await ir("/caja/cierre-del-dia");
      await pagina.getByText(`Jornada ${fechaEnPantalla()}`).waitFor();
      await pagina.getByText("Cerrada", { exact: true }).waitFor();
      expect(await pagina.getByRole("button").count()).toBe(0);
      pantallaLimpia();
    });
  },
);
