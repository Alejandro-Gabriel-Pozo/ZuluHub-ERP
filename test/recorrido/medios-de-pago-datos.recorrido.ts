import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * Los DATOS QUE SE PIDEN AL COBRAR de un medio de pago (T4a), de punta a punta en la app REAL construida y con un navegador real: la persona abre la ficha de un medio de
 * crédito, ve una casilla por cada dato que el tipo admite (ninguna tildada: el medio nace sin datos), tilda dos, guarda y vuelve a la lista; al reabrir las casillas
 * siguen tildadas y la base tiene lo mismo. Lo que esta prueba ve y las de componentes no: la página en el servidor (el permiso y la lectura de la base), la acción de
 * servidor con su versión, las cabeceras de la app (CSP) y que `Casilla` (campo de formulario cliente) no rompa en el navegador (React #441).
 *
 * El módulo `caja` está «en desarrollo» en la app real: SOLO en el proceso de esta prueba se lee como «disponible» (`apoyo/activar-modulos-en-desarrollo.mjs`); la empresa lo
 * tiene activo por su plan, como pide el guard.
 */
const base = inject("baseDePruebas");

describe.skipIf(base === null)("recorrido de los datos del cobro de un medio de pago", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let credito = "";
  let qr = "";

  const ir = async (ruta: string) => {
    const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
    return respuesta;
  };
  const sinViolacionesDeAxe = async () => expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
  const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);
  const medio = async (id: string) =>
    (
      await mundo.mundo.dueno.query<{
        pide_cupon: boolean;
        pide_ultimos4: boolean;
        pide_marca: boolean;
        pide_cuotas: boolean;
        pide_dni: boolean;
        version: number;
      }>("select * from medio_de_pago where id = $1", [id])
    ).rows[0];

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base, {
      modulosAdicionales: ["caja"],
      activarModulosEnDesarrollo: true,
    });
    const c = mundo.mundo.dueno;
    const alta = async (tipo: string, nombre: string) =>
      (
        await c.query<{ id: string }>(
          "insert into medio_de_pago (empresa_id, tipo, nombre) values ($1, $2, $3) returning id",
          [mundo.empresa, tipo, nombre],
        )
      ).rows[0]?.id ?? "";
    credito = await alta("TARJETA_CREDITO", "Posnet del salón");
    qr = await alta("QR", "Mercado Pago");

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

  it("la ficha de un crédito ofrece sus cuatro datos, todos sin tildar, y ningún componente rompe", async () => {
    const r = await ir(`/caja/medios-de-pago/${credito}`);
    expect(r?.status()).toBe(200);
    const grupo = pagina.getByRole("group", { name: "Datos que se piden al cobrar" });
    await grupo.waitFor();
    const casillas = grupo.getByRole("checkbox");
    expect(await casillas.count()).toBe(4);
    for (const nombre of ["Cupón", "Últimos 4 dígitos", "Marca de la tarjeta", "Cuotas"]) {
      expect(await grupo.getByRole("checkbox", { name: nombre }).isChecked()).toBe(false);
    }
    expect(await pagina.getByRole("checkbox", { name: "DNI" }).count()).toBe(0);
    await sinViolacionesDeAxe();
    pantallaLimpia();
  });

  it("un QR no lleva datos: no hay panel", async () => {
    await ir(`/caja/medios-de-pago/${qr}`);
    expect(await pagina.getByRole("group", { name: "Datos que se piden al cobrar" }).count()).toBe(
      0,
    );
    pantallaLimpia();
  });

  it("tilda dos y guarda con DOBLE TOQUE: queda uno solo en la base, vuelve a la lista y al reabrir siguen tildados", async () => {
    await ir(`/caja/medios-de-pago/${credito}`);
    const grupo = pagina.getByRole("group", { name: "Datos que se piden al cobrar" });
    await grupo.getByRole("checkbox", { name: "Cupón" }).check();
    await grupo.getByRole("checkbox", { name: "Cuotas" }).check();
    const antes = (await medio(credito))?.version ?? 0;
    await pagina.getByRole("button", { name: "Guardar" }).last().dblclick();
    await pagina.waitForURL(/\/caja\/medios-de-pago$/);
    const guardado = await medio(credito);
    expect(guardado).toMatchObject({
      pide_cupon: true,
      pide_ultimos4: false,
      pide_marca: false,
      pide_cuotas: true,
      pide_dni: false,
    });
    expect(guardado?.version).toBe(antes + 1);
    const auditorias = await mundo.mundo.dueno.query<{ n: string }>(
      "select count(*)::text as n from auditoria_empresa where accion = 'MEDIO_DE_PAGO_EDITADO' and entidad_id = $1",
      [credito],
    );
    expect(auditorias.rows[0]?.n).toBe("1");

    await ir(`/caja/medios-de-pago/${credito}`);
    const reabierto = pagina.getByRole("group", { name: "Datos que se piden al cobrar" });
    expect(await reabierto.getByRole("checkbox", { name: "Cupón" }).isChecked()).toBe(true);
    expect(await reabierto.getByRole("checkbox", { name: "Cuotas" }).isChecked()).toBe(true);
    expect(await reabierto.getByRole("checkbox", { name: "Marca de la tarjeta" }).isChecked()).toBe(
      false,
    );
    pantallaLimpia();
  });
});
