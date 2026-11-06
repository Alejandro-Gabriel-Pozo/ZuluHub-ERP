import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * Lo que hace el dueño, de punta a punta, en la app REAL construida y con un navegador real: cargar los Datos fiscales (con Ingresos
 * Brutos), tener un punto de venta, emitir una Factura B de consumidor final, verla en el listado y en su detalle e imprimirla. ARCA es
 * la simulada (`apoyo/arca-simulada.ts`). Los pasos son SECUENCIALES a propósito: cada uno parte de lo que dejó el anterior, como la
 * persona real. Cada paso responde por lo que el vigilante vio en SU pantalla (consola, 5xx, CSP, pedidos a otros hosts) y por axe.
 *
 * FALLAS CONOCIDAS (`it.fails`): hechos reales que esta prueba encuentra y que todavía no se arreglan. Cada una lleva su motivo; cuando alguien la
 * arregla la prueba se pone roja y obliga a pasarla a `it` común (como pasó con la CSP de la impresión y con el error de campo de «Emitir»).
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)(
  "recorrido de facturación: de los datos fiscales a la factura impresa",
  () => {
    let mundo: MundoDelRecorrido;
    let navegador: Browser;
    let contexto: BrowserContext;
    let pagina: Page;
    let vigilante: Vigilante;
    /** Lo que el vigilante anotó en las pantallas de impresión (ver la falla conocida de CSP). */
    const deLaImpresion: string[] = [];

    const ir = async (ruta: string) => {
      const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
      await pagina.waitForLoadState("networkidle");
      return respuesta;
    };
    const sinViolacionesDeAxe = async () =>
      expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);
    const idDelComprobante = () => /\/comprobantes\/([0-9a-f-]{36})/.exec(pagina.url())?.[1] ?? "";

    beforeAll(async () => {
      if (base === null) return;
      mundo = await armarMundoDelRecorrido(base);
      const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
      navegador = await chromium.launch({
        ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
        // Sin proxy del entorno: la app es de loopback y nada de la prueba tiene que salir a internet.
        args: ["--no-proxy-server"],
      });
      // El certificado de la fachada es autofirmado y de esta corrida: solo por eso se aceptan los errores de TLS.
      contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
      await contexto.addCookies([...mundo.cookies]);
      pagina = await contexto.newPage();
      vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
    });
    afterAll(async () => {
      await navegador?.close();
      await mundo?.cerrar();
    });

    it("Datos fiscales: se cargan con Ingresos Brutos y se confirman", async () => {
      const r = await ir("/configuracion-fiscal/datos-fiscales");
      expect(r?.status()).toBe(200);
      await pagina.getByLabel("Razón social").fill("Panadería Zulú SA");
      await pagina
        .getByLabel("Condición frente al IVA")
        .selectOption({ label: "IVA Responsable Inscripto" });
      await pagina.getByLabel("Calle").fill("Avenida Siempre Viva");
      await pagina.getByLabel("Número", { exact: true }).fill("742");
      await pagina.getByLabel("Localidad").fill("Rosario");
      await pagina.getByLabel("Provincia").selectOption({ label: "Santa Fe" });
      await pagina.getByLabel("Código postal").fill("2000");
      await pagina.getByLabel("Ingresos Brutos").selectOption({ label: "Número de inscripción" });
      await pagina.getByLabel("Número de inscripción").fill("901-123456-7");
      await pagina.getByLabel("Inicio de actividades").fill("2020-01-01");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Confirmar" }).click();
      await pagina.waitForURL(/\/configuracion-fiscal$/);
      const { rows } = await mundo.mundo.dueno.query<{ iibb_numero: string; estado: string }>(
        "select iibb_numero, estado from datos_fiscales where empresa_id = $1",
        [mundo.empresa],
      );
      expect(rows).toEqual([{ iibb_numero: "901-123456-7", estado: "CONFIRMADA" }]);
      pantallaLimpia();
    });

    it("Puntos de venta: se crea el primero y se activa", async () => {
      await ir("/configuracion-fiscal/puntos-de-venta/nuevo");
      await pagina.getByLabel("Número de punto de venta").fill("1");
      await pagina.getByLabel("Calle").fill("Avenida Siempre Viva");
      await pagina.getByLabel("Número", { exact: true }).fill("742");
      await pagina.getByLabel("Localidad").fill("Rosario");
      await pagina.getByLabel("Provincia").selectOption({ label: "Santa Fe" });
      await pagina.getByLabel("Código postal").fill("2000");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Guardar" }).click();
      await pagina.waitForURL(/\/configuracion-fiscal\/puntos-de-venta$/);
      await pagina.getByRole("link", { name: /^00001/ }).click();
      await pagina.getByRole("button", { name: "Activar" }).click();
      await pagina.getByRole("button", { name: "Desactivar" }).waitFor();
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    // Era una falla conocida (2026-11-05, verificada en la app real): «Emitir» dejaba avanzar con un DNI no numérico y un nombre numérico, y el
    // único aviso era genérico y llegaba al final. Lo arregla el marcado de campos (dueño, 2026-11-06, Q21): con el cliente mal escrito
    // la persona no pasa al paso 2 y los campos inválidos se marcan.
    it("Emitir: un documento no numérico y un nombre numérico dan error de campo", async () => {
      await ir("/facturacion/comprobantes/emitir");
      await pagina.getByLabel("Documento").selectOption({ label: "DNI" });
      await pagina.getByRole("textbox", { name: "DNI" }).fill("abc");
      await pagina.getByRole("textbox", { name: "Nombre o razón social" }).fill("12345");
      await pagina
        .getByLabel("Condición frente al IVA")
        .selectOption({ label: "Consumidor Final" });
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      // Con error de campo la persona sigue en el paso 1 (Cliente), con el documento y el nombre marcados.
      await pagina.getByText("Revisá los datos marcados.").first().waitFor();
      expect(await pagina.getByRole("region", { name: "Renglones" }).count()).toBe(0);
      expect(await pagina.getByRole("textbox", { name: "DNI" }).getAttribute("aria-invalid")).toBe(
        "true",
      );
      expect(
        await pagina
          .getByRole("textbox", { name: "Nombre o razón social" })
          .getAttribute("aria-invalid"),
      ).toBe("true");
      await sinViolacionesDeAxe();
      vigilante.tomar();
    });

    it("Emitir: una Factura B de consumidor final termina AUTORIZADA con el CAE de ARCA", async () => {
      await ir("/facturacion/comprobantes/emitir");
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByLabel("Descripción").fill("Medialunas x12");
      await pagina.getByLabel("Precio con IVA").fill("121,00");
      await pagina.getByLabel("IVA", { exact: true }).selectOption({ label: "IVA 21 %" });
      await sinViolacionesDeAxe();
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByRole("button", { name: "Emitir factura" }).click();
      await pagina.waitForURL(/\/facturacion\/comprobantes\/[0-9a-f-]{36}$/);
      // La emisión sale a ARCA después de responder; la pantalla se actualiza al recargar.
      const limite = Date.now() + 30_000;
      while ((await pagina.getByText("Autorizada", { exact: true }).count()) === 0) {
        if (Date.now() > limite) throw new Error("la factura no llegó a Autorizada en 30 s");
        await pagina.waitForTimeout(1000);
        await pagina.reload();
        await pagina.waitForLoadState("networkidle");
      }
      expect(await pagina.locator("main").innerText()).toMatch(/CAE\s+86410995\d{6}/);
      // ARCA simulada vio una Factura B (tipo 6) de 121,00 con el número siguiente.
      const solicitud = mundo.arca.pedidos.find((p) => p.operacion === "FECAESolicitar");
      expect(solicitud?.cuerpo).toContain("<ar:CbteTipo>6</ar:CbteTipo>");
      expect(solicitud?.cuerpo).toContain("<ar:ImpTotal>121.00</ar:ImpTotal>");
      const { rows } = await mundo.mundo.dueno.query<{ estado: string }>(
        "select estado from comprobante where empresa_id = $1",
        [mundo.empresa],
      );
      expect(rows).toEqual([{ estado: "AUTORIZADO" }]);
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("Listado: la factura aparece", async () => {
      await ir("/facturacion/comprobantes");
      const fila = pagina.getByRole("row", {
        name: /Factura B 00001-00000001.*\$ 121,00.*Autorizada/,
      });
      await fila.waitFor();
      await sinViolacionesDeAxe();
      await fila.getByRole("link", { name: "Factura B 00001-00000001" }).click();
      await pagina.waitForURL(/\/facturacion\/comprobantes\/[0-9a-f-]{36}$/);
      pantallaLimpia();
    });

    it("Detalle: muestra el CAE y el total", async () => {
      await pagina.getByText("Autorizada", { exact: true }).waitFor();
      const texto = await pagina.locator("article").innerText();
      expect(texto).toMatch(/CAE\s+86410995\d{6} · vence/);
      expect(texto).toContain("$ 121,00");
      await sinViolacionesDeAxe();
      pantallaLimpia();
    });

    it("Imprimir A4: una hoja con paginador, sin desborde y con el QR cargado", async () => {
      const respuesta = await ir(`/facturacion/comprobantes/${idDelComprobante()}/imprimir`);
      // La CSP real tiene que llegar con la respuesta y admitir el QR (`data:`); sin la cabecera, el navegador no bloquea nada y el
      // resto de las pruebas de esta pantalla pasaría por la razón equivocada. Solo se afirma que existe y lo contiene (la regla vive
      // en `src/capacidades/experiencia/cabeceras.ts`).
      expect((await respuesta?.headerValue("content-security-policy")) ?? "").toContain(
        "img-src 'self' data:",
      );
      expect(await pagina.getByRole("radio", { name: "A4" }).isChecked()).toBe(true);
      // Hay una copia oculta (el medidor de la hoja): se espera la visible.
      await pagina.getByText("Hoja 1 de 1").locator("visible=true").first().waitFor();
      // El QR de la factura carga de verdad (no solo está en el HTML): lo bloquearía `img-src` si faltara `data:`.
      const imagenes = await pagina.locator("img").evaluateAll((els) =>
        els.map((e) => {
          const imagen = e as unknown as {
            getAttribute(nombre: string): string | null;
            naturalWidth: number;
          };
          return { src: imagen.getAttribute("src") ?? "", ancho: imagen.naturalWidth };
        }),
      );
      expect(imagenes.length).toBeGreaterThan(0);
      for (const imagen of imagenes) {
        expect(imagen.src.startsWith("data:image/svg+xml")).toBe(true);
        expect(imagen.ancho).toBeGreaterThan(0);
      }
      const desborde = await pagina.evaluate(() => {
        const g = globalThis as unknown as {
          document: { documentElement: { scrollWidth: number; clientWidth: number } };
        };
        return g.document.documentElement.scrollWidth - g.document.documentElement.clientWidth;
      });
      expect(desborde).toBeLessThanOrEqual(0);
      await sinViolacionesDeAxe();
      deLaImpresion.push(...vigilante.tomar());
    });

    it("Imprimir ticket: se arma sin desborde", async () => {
      await pagina.getByRole("radio", { name: "Ticket" }).check();
      const ticket = pagina.locator("[data-ticket]");
      await ticket.waitFor();
      const desborde = await ticket.evaluate(
        (e) =>
          (e as unknown as { scrollWidth: number }).scrollWidth -
          (e as unknown as { clientWidth: number }).clientWidth,
      );
      expect(desborde).toBeLessThanOrEqual(0);
      await sinViolacionesDeAxe();
      deLaImpresion.push(...vigilante.tomar());
    });

    it("Imprimir: nada de lo que se ve ni se carga rompe consola, 5xx ni hosts (la CSP se mira aparte)", () => {
      expect(deLaImpresion.filter((h) => !/CSP|Content Security Policy/.test(h))).toEqual([]);
    });

    // Antes de #193 la vista de impresión usaba estilos en línea que la CSP real bloqueaba (hallazgo de este recorrido, 2026-11-05); #193 lo
    // arregló y esto pasó de falla conocida a prueba común.
    it("Imprimir: la política de contenido no bloquea ningún estilo ni imagen", () => {
      expect(deLaImpresion.filter((h) => /CSP|Content Security Policy/.test(h))).toEqual([]);
    });

    it("Emitir: una Factura A a un responsable inscripto sin domicilio marca el domicilio y con domicilio termina AUTORIZADA", async () => {
      await ir("/facturacion/comprobantes/emitir");
      await pagina.getByLabel("Documento").selectOption({ label: "CUIT" });
      await pagina.getByRole("textbox", { name: "CUIT" }).fill("30-71234567-1");
      await pagina
        .getByRole("textbox", { name: "Nombre o razón social" })
        .fill("Distribuidora Sur SA");
      await pagina
        .getByLabel("Condición frente al IVA")
        .selectOption({ label: "IVA Responsable Inscripto" });
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByLabel("Descripción").fill("Harina x50");
      await pagina.getByLabel("Precio con IVA").fill("121,00");
      await pagina.getByLabel("IVA", { exact: true }).selectOption({ label: "IVA 21 %" });
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByRole("button", { name: "Emitir factura" }).click();
      // El servidor exige el domicilio (RG 1415 Anexo II A.II): vuelve al paso del cliente con ese campo marcado.
      await pagina.getByText("Revisá los datos marcados.").first().waitFor();
      expect(
        await pagina.getByRole("textbox", { name: "Domicilio" }).getAttribute("aria-invalid"),
      ).toBe("true");
      await sinViolacionesDeAxe();
      await pagina.getByRole("textbox", { name: "Domicilio" }).fill("Av. Siempreviva 742, Rosario");
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByRole("button", { name: "Siguiente" }).click();
      await pagina.getByRole("button", { name: "Emitir factura" }).click();
      await pagina.waitForURL(/\/facturacion\/comprobantes\/[0-9a-f-]{36}$/);
      const limite = Date.now() + 30_000;
      while ((await pagina.getByText("Autorizada", { exact: true }).count()) === 0) {
        if (Date.now() > limite) throw new Error("la factura A no llegó a Autorizada en 30 s");
        await pagina.waitForTimeout(1000);
        await pagina.reload();
        await pagina.waitForLoadState("networkidle");
      }
      // ARCA simulada vio una Factura A (tipo 1) al CUIT del cliente.
      const solicitud = mundo.arca.pedidos.filter((p) => p.operacion === "FECAESolicitar").at(-1);
      expect(solicitud?.cuerpo).toContain("<ar:CbteTipo>1</ar:CbteTipo>");
      expect(solicitud?.cuerpo).toContain("<ar:DocNro>30712345671</ar:DocNro>");
      pantallaLimpia();
    });

    it("el enlace del mail de invitación apunta a una pantalla que existe", async () => {
      const r = await ir("/invitacion?t=token-que-no-existe");
      expect(r?.status()).not.toBe(404);
      vigilante.tomar();
    });
  },
);
