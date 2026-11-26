import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { precioDeBase, productoDeBase } from "../integracion/catalogo-apoyo";
import { crearAsignacionDeBase } from "../integracion/fixtures-identidad";
import { cuitUnico } from "../integracion/unicos";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * CUENTA CORRIENTE ABIERTA, de punta a punta en la app REAL con un navegador real (CC-5): SIN el atajo de «módulos en desarrollo» (el módulo es `disponible` y la empresa lo activa como cualquier otra).
 * El gerente habilita el crédito de un cliente desde la pantalla y lo ve en el listado; vende a cuenta en la venta rápida con DOBLE TOQUE en «Confirmar venta a cuenta» (un ticket, un cargo, ningún cobro en
 * caja) y cierra una mesa a cuenta (un ticket, un cargo, la mesa libre); con un cliente al que la venta le pasa el límite la hoja avisa, «Confirmar» queda apagado y no se escribe nada; el operador
 * (sin `cuenta_corriente.ver`) no ve la entrada ni la lista y, con el límite pasado, ve que no puede aprobar. Lo que ven las pruebas de componentes y de integración y no esta: la página en el servidor
 * (permiso y módulo activo), las acciones de servidor, la CSP y que ningún componente rompa en el navegador.
 */
const base = inject("baseDePruebas");
const DESDE = "2026-01-01T00:00:00.000Z";

describe.skipIf(base === null)("recorrido de cuenta corriente: abrir y vender a cuenta", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let persona = "";
  let sucursal = "";
  let agencia = "";
  let constructora = "";

  const ir = async (ruta: string) => {
    const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
    return respuesta;
  };
  const consulta = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await mundo.mundo.dueno.query<T>(texto, p)).rows;
  const contar = async (tabla: string, donde = "", p: unknown[] = []) =>
    Number(
      (
        await consulta<{ n: string }>(
          `select count(*)::text as n from ${tabla} where empresa_id = $1 ${donde}`,
          [mundo.empresa, ...p],
        )
      )[0]?.n,
    );
  const cargosDe = (cliente: string) =>
    contar("asiento_de_saldo", "and parte_id = $2 and sentido = 'A_COBRAR'", [cliente]);
  /** Cambia el rol de la persona del recorrido: un disparador solo lo deja con un traspaso o una asignación del gerente, así que la siembra el dueño de la base sin disparadores (solo esta transacción, como la sesión de caja). */
  const ponerRol = async (rol: "GERENTE" | "OPERADOR") => {
    const c = mundo.mundo.dueno;
    try {
      await c.query("begin");
      await c.query("set local session_replication_role = replica");
      await c.query("update membresia set rol = $3 where empresa_id = $1 and persona_id = $2", [
        mundo.empresa,
        persona,
        rol,
      ]);
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
  };
  const clienteDeBase = async (nombre: string) => {
    const id = (
      await consulta<{ id: string }>(
        `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
         values (gen_random_uuid(), $1, gen_random_uuid(), 'JURIDICA', $2, 'CUIT', $3, $4) returning id`,
        [mundo.empresa, nombre, cuitUnico(), persona],
      )
    )[0]?.id as string;
    await consulta(
      "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
      [mundo.empresa, id],
    );
    return id;
  };
  const elegirCliente = async (id: string) => {
    await pagina.getByRole("combobox", { name: "Cliente" }).selectOption(id);
  };
  const abrirLaHojaDesdeLaVentaRapida = async () => {
    await ir("/ventas/venta-rapida");
    await pagina.getByRole("button", { name: /^Medialuna/ }).click();
    await pagina.getByRole("button", { name: "Agregar" }).click();
    await expect.poll(() => pagina.locator("[data-total]").innerText()).toBe("$ 800,00");
    await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
    await pagina.getByRole("heading", { name: "Cobro", level: 2 }).waitFor();
    await pagina.getByRole("button", { name: "Vender a cuenta corriente", exact: true }).click();
    await pagina.getByRole("heading", { name: "Vender a cuenta corriente", level: 2 }).waitFor();
  };

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulos: ["facturacion", "catalogo", "caja", "ventas", "comandas", "salon"],
      modulosAdicionales: ["clientes", "cuenta_corriente"],
      perillas: { salon: { tipo: "INTERRUPTOR", encendida: true } },
    });
    const c = mundo.mundo.dueno;
    const medialuna = await productoDeBase(c, mundo.empresa, { nombre: "Medialuna" });
    await precioDeBase(c, {
      empresa: mundo.empresa,
      producto: medialuna,
      precio: "800.00",
      desde: DESDE,
    });
    sucursal = (
      await consulta<{ id: string }>("select id from sucursal where empresa_id = $1 limit 1", [
        mundo.empresa,
      ])
    )[0]?.id as string;
    persona = (
      await consulta<{ persona_id: string }>(
        "select persona_id from membresia where empresa_id = $1 limit 1",
        [mundo.empresa],
      )
    )[0]?.persona_id as string;
    // La caja con su sesión abierta de hoy (abrirla es otra pantalla): vender a cuenta no la usa, pero la vista de cobro la pide.
    const caja = (
      await consulta<{ id: string }>(
        "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Caja 1') returning id",
        [mundo.empresa, sucursal],
      )
    )[0]?.id;
    await c.query(
      "insert into medio_de_pago (empresa_id, tipo) values ($1, 'EFECTIVO') on conflict do nothing",
      [mundo.empresa],
    );
    try {
      await c.query("begin");
      await c.query("set local session_replication_role = replica");
      await c.query(
        `insert into sesion_caja (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por, clave_idempotencia, huella)
         values ($1, $2, (now() at time zone 'America/Argentina/Buenos_Aires')::date, '00:00', 'America/Argentina/Buenos_Aires', now(), $3, $4, $5)`,
        [mundo.empresa, caja, persona, `recorrido-${"a".repeat(20)}`, "0".repeat(64)],
      );
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
    // Dos clientes: uno se habilita desde la pantalla; el otro ya tiene la cuenta con un límite chico (la venta de $ 800 se lo pasa).
    agencia = await clienteDeBase("Agencia Cóndor Viajes");
    constructora = await clienteDeBase("Constructora Patagonia");
    await consulta(
      `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
       values ($1, $2, 60, '500.00', $3, $4, $5)`,
      [mundo.empresa, constructora, `recorrido-${"b".repeat(20)}`, "1".repeat(64), persona],
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

  it("el gerente habilita el crédito de un cliente desde la pantalla y lo ve en el listado", async () => {
    await ir("/caja/cuenta-corriente/habilitar");
    await pagina.getByRole("combobox", { name: "Cliente" }).selectOption(agencia);
    await pagina.getByLabel("Plazo", { exact: true }).fill("30");
    await pagina.getByLabel("Límite", { exact: true }).fill("100000");
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    await pagina.getByRole("button", { name: "Habilitar", exact: true }).click();
    await expect.poll(() => contar("cuenta_del_cliente", "and parte_id = $2", [agencia])).toBe(1);
    // El envío redirige: se espera a que la página termine de cargar antes de pedir otra, o la navegación se aborta.
    await pagina.waitForLoadState("networkidle");
    await ir("/caja/cuenta-corriente");
    await pagina.getByText("Agencia Cóndor Viajes").first().waitFor();
    await pagina.getByText("Constructora Patagonia").first().waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("venta rápida a cuenta: DOBLE TOQUE en «Confirmar venta a cuenta» deja UN ticket, UN cargo y ningún cobro en caja", async () => {
    await abrirLaHojaDesdeLaVentaRapida();
    await elegirCliente(agencia);
    await pagina.getByText("Saldo después").waitFor();
    await pagina.getByText("$ 800,00", { exact: true }).last().waitFor();
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    await pagina.waitForTimeout(700);
    await pagina.getByRole("button", { name: "Confirmar venta a cuenta", exact: true }).dblclick();
    await pagina.getByText("Ticket N.º 1").waitFor();
    expect(await pagina.getByText("Cobrado", { exact: true }).count()).toBe(0);
    expect(await contar("ticket")).toBe(1);
    expect(await cargosDe(agencia)).toBe(1);
    expect(await contar("cobro")).toBe(0);
    expect(await contar("cobranza_de_ticket")).toBe(0);
    expect(await pagina.getByRole("button", { name: "Anular", exact: true }).count()).toBe(1);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("un cliente al que la venta le pasa el límite: la hoja avisa, «Confirmar» queda apagado y no se escribe nada; el gerente no ve la frase de permiso", async () => {
    await abrirLaHojaDesdeLaVentaRapida();
    await elegirCliente(constructora);
    await pagina.getByText("Esta venta supera el límite de crédito del cliente.").waitFor();
    expect(await pagina.getByText(/No tenés permiso para aprobar este exceso/).count()).toBe(0);
    expect(
      await pagina
        .getByRole("button", { name: "Confirmar venta a cuenta", exact: true })
        .isDisabled(),
    ).toBe(true);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(await contar("ticket")).toBe(1);
    expect(await cargosDe(constructora)).toBe(0);
  });

  it("cierra una mesa a cuenta: UN ticket, UN cargo y la mesa libre", async () => {
    await ir("/salon/mesas/nueva");
    await pagina.getByLabel("Número", { exact: true }).fill("1");
    await pagina.getByLabel("Columna", { exact: true }).fill("1");
    await pagina.getByLabel("Fila", { exact: true }).fill("2");
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await pagina.waitForURL("**/salon/mesas");
    await ir("/salon");
    await pagina.getByRole("link", { name: "Mesa 1" }).click();
    await pagina.waitForURL(/\/salon\/cuenta\/[0-9a-f-]{36}$/);
    await pagina.getByRole("button", { name: "Tomar pedido" }).click();
    await pagina.getByText("La mesa no tiene pedido").waitFor();
    await pagina.getByRole("button", { name: /^Medialuna/ }).click();
    await pagina.getByRole("button", { name: /^Agregar( ·|$)/ }).click();
    await pagina.getByRole("heading", { name: "Para enviar" }).waitFor();
    await pagina.getByRole("button", { name: "Enviar a cocina" }).click();
    await pagina.getByText("No hay impresora para la comanda de cocina").waitFor();
    await pagina.reload();
    await pagina.getByRole("heading", { name: "Enviadas" }).waitFor();
    await pagina.getByRole("button", { name: "Cobrar", exact: true }).click();
    await pagina.waitForURL(/\/salon\/cuenta\/[0-9a-f-]{36}\/cobrar$/);
    await pagina.getByRole("button", { name: "Vender a cuenta corriente", exact: true }).click();
    await elegirCliente(agencia);
    await pagina.getByText("Saldo después").waitFor();
    await pagina.getByRole("button", { name: "Confirmar venta a cuenta", exact: true }).dblclick();
    await pagina.getByText("Ticket N.º 2").waitFor();
    expect(await contar("ticket")).toBe(2);
    expect(await cargosDe(agencia)).toBe(2);
    expect(await contar("cuenta_consumo", "and estado = 'ABIERTA'")).toBe(0);
    expect(await contar("cobro")).toBe(0);
    expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
    expect(vigilante.tomar()).toEqual([]);
  });

  it("el operador (sin `cuenta_corriente.ver`) no ve la entrada ni la lista y, con el límite pasado, ve que no puede aprobar", async () => {
    // La misma persona pasa a ser operador de la sucursal: el servidor lee el rol en cada pedido.
    await ponerRol("OPERADOR");
    await crearAsignacionDeBase(mundo.mundo.dueno, mundo.empresa, persona, sucursal);
    try {
      await ir("/caja/cuenta-corriente");
      expect(await pagina.getByText("Agencia Cóndor Viajes").count()).toBe(0);
      await ir("/ventas/venta-rapida");
      expect(
        await pagina.getByRole("link", { name: "Cuenta corriente", exact: true }).count(),
      ).toBe(0);
      await abrirLaHojaDesdeLaVentaRapida();
      await elegirCliente(constructora);
      await pagina.getByText("Esta venta supera el límite de crédito del cliente.").waitFor();
      await pagina
        .getByText(
          /No tenés permiso para aprobar este exceso\. Pedile a un gerente o administrador que lo apruebe\./,
        )
        .waitFor();
      expect(
        await pagina
          .getByRole("button", { name: "Confirmar venta a cuenta", exact: true })
          .isDisabled(),
      ).toBe(true);
      expect(await cargosDe(constructora)).toBe(0);
    } finally {
      await ponerRol("GERENTE");
    }
  });
});
