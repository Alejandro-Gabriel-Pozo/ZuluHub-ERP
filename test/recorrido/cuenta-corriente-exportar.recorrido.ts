import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { leerZipComoTextos } from "../../src/adaptadores/xlsx/leer-zip-de-prueba";
import { direccionDeExportarCuentaCorriente } from "../../apps/web/ui/plantillas/cuenta-corriente/rutas-de-cuenta-corriente";
import { HUELLA, claveNueva } from "../integracion/caja-apoyo";
import { crearAsignacionDeBase } from "../integracion/fixtures-identidad";
import { cuitUnico } from "../integracion/unicos";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, type Vigilante } from "./apoyo/vigilante";

/**
 * «EXPORTAR LA CUENTA CORRIENTE» de punta a punta en la app REAL con un navegador real (CC-5 D, dueño 26/11/2026): el gerente pide la dirección de descarga y baja un archivo de Excel con el
 * importe exacto de cada movimiento; el operador, sin `cuenta_corriente.ver`, no recibe ningún archivo. El botón «Exportar» lo pone CC-1 (la ficha): este recorrido prueba la ruta que ese botón
 * usa. Lo que no ven las pruebas de servidor: la ruta con sus cabeceras en el navegador, la descarga que baja de verdad, la guarda de `Sec-Fetch-Site` con un navegador real (la dirección
 * tipeada es `none`) y que `write-excel-file` corre en el servidor de Next.
 */
const base = inject("baseDePruebas");
const RUTA = direccionDeExportarCuentaCorriente();

describe.skipIf(base === null)("recorrido de cuenta corriente: exportar a Excel", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let persona = "";
  let sucursalDeLaPersona = "";

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["clientes", "cuenta_corriente"],
      activarModulosEnDesarrollo: true,
    });
    const c = mundo.mundo.dueno;
    sucursalDeLaPersona = (
      await c.query<{ id: string }>("select id from sucursal where empresa_id = $1 limit 1", [
        mundo.empresa,
      ])
    ).rows[0]?.id as string;
    persona = (
      await c.query<{ persona_id: string }>(
        "select persona_id from membresia where empresa_id = $1 limit 1",
        [mundo.empresa],
      )
    ).rows[0]?.persona_id as string;
    // Un cliente con ficha y un cargo a cuenta de $1.234,50.
    const cliente = (
      await c.query<{ id: string }>(
        `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
         values (gen_random_uuid(), $1, gen_random_uuid(), 'JURIDICA', 'Cliente del recorrido', 'CUIT', $2, $3) returning id`,
        [mundo.empresa, cuitUnico(), persona],
      )
    ).rows[0]?.id as string;
    await c.query(
      "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
      [mundo.empresa, cliente],
    );
    await c.query(
      `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
       values ($1, $2, 30, '100000.00', $3, $4, $5)`,
      [mundo.empresa, cliente, claveNueva(), HUELLA, persona],
    );
    // El asiento y su distribución por sucursal entran en UNA sentencia: la distribución tiene que sumar el importe al confirmar.
    await c.query(
      `with a as (
         insert into asiento_de_saldo (empresa_id, parte_id, sentido, clase, importe, origen_tipo, origen_id, clave_idempotencia, huella, hecho_en, registrado_por)
         values ($1, $2, 'A_COBRAR', 'CARGO_DE_VENTA_A_CUENTA', '1234.50', 'ventas.cargo', gen_random_uuid(), $3, $4, now(), $5) returning id
       )
       insert into distribucion_de_asiento (empresa_id, asiento_id, sucursal_id, importe) select $1, id, $6, '1234.50' from a`,
      [mundo.empresa, cliente, claveNueva(), HUELLA, persona, sucursalDeLaPersona],
    );
    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("el gerente pide la dirección y baja el archivo con el importe exacto, sin fórmulas, y la descarga deja su registro sin datos", async () => {
    // Una descarga hace abortar la navegación: se espera el evento de descarga, no la página.
    const [descarga] = await Promise.all([
      pagina.waitForEvent("download"),
      pagina.goto(`${mundo.url}${RUTA}`).catch(() => null),
    ]);
    expect(descarga.suggestedFilename()).toMatch(/^cuenta_corriente_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const flujo = await descarga.createReadStream();
    const trozos: Buffer[] = [];
    for await (const trozo of flujo) trozos.push(Buffer.from(trozo as Uint8Array));
    const zip = leerZipComoTextos(new Uint8Array(Buffer.concat(trozos)));
    expect(zip.get("xl/workbook.xml")).toContain('name="Cuenta corriente"');
    expect(zip.get("xl/worksheets/sheet1.xml")).toContain("<v>1234.5</v>");
    expect(zip.get("xl/sharedStrings.xml")).toContain("Cliente del recorrido");
    for (const [nombre, xml] of zip) {
      if (nombre.startsWith("xl/worksheets/")) expect(xml).not.toContain("<f");
    }
    const registros = (
      await mundo.mundo.dueno.query<{ despues: unknown }>(
        "select despues from auditoria_empresa where empresa_id = $1 and accion = 'CUENTA_CORRIENTE_EXPORTADA'",
        [mundo.empresa],
      )
    ).rows;
    expect(registros).toHaveLength(1);
    expect(JSON.stringify(registros[0]?.despues)).not.toMatch(/1234|Cliente del recorrido/);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("el operador, sin permiso, pide la dirección a mano y no recibe ningún archivo", async () => {
    const c = mundo.mundo.dueno;
    // Un disparador impide cambiar el rol fuera de un traspaso de gerencia: acá lo hace el dueño de la base, sin disparadores y solo en esta transacción.
    await c.query("begin");
    try {
      await c.query("set local session_replication_role = replica");
      await c.query(
        "update membresia set rol = 'OPERADOR' where empresa_id = $1 and persona_id = $2",
        [mundo.empresa, persona],
      );
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
    await crearAsignacionDeBase(c, mundo.empresa, persona, sucursalDeLaPersona);
    const respuesta = await pagina.goto(`${mundo.url}${RUTA}`);
    await pagina.waitForLoadState("networkidle");
    expect(respuesta).not.toBeNull();
    expect(respuesta?.status()).toBeGreaterThanOrEqual(400);
    expect(respuesta?.headers()["content-disposition"]).toBeUndefined();
    expect(respuesta?.headers()["cache-control"]).toBe("private, no-store");
    expect(Object.keys((await respuesta?.json()) as object)).toEqual(["codigo"]);
    const registros = (
      await c.query<{ n: string }>(
        "select count(*)::text as n from auditoria_empresa where empresa_id = $1 and accion = 'CUENTA_CORRIENTE_EXPORTADA'",
        [mundo.empresa],
      )
    ).rows;
    expect(registros[0]?.n).toBe("1");
  });
});
