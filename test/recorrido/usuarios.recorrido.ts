import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearMundoDeMarca } from "../integracion/marcas-apoyo";
import { ingresarEn, personaVinculada } from "../integracion/web-apoyo";
import {
  crearAsignacionDeBase,
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
  sucursalDe,
} from "../integracion/fixtures-identidad";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Usuarios» de Cuenta (tramos U1 y U3 parte A) de punta a punta en la app REAL construida, con un navegador real y una base real: el gerente entra desde Cuenta → «Usuarios» y ve a la gente de su empresa
 * con su rol («Gerente», «Administrador», «Empleado»), a la desactivada con su texto y las invitaciones con «Vence el …», «Vencida» o «Pendiente»; abre la ficha de una persona; nunca ve a nadie de otra empresa (la
 * ficha de una ajena dice lo mismo que una inexistente). Después la misma persona pasa a ser empleada: la entrada «Usuarios» desaparece de Cuenta y, abriendo la dirección a mano, el servidor responde con el
 * mensaje genérico, sin filas. Tramo U3 (desactivar): R1 el gerente desactiva a una persona CON confirmación («Cancelar» no hace nada) y la ficha pasa a «Desactivado», con sus sucursales apagadas y su invitación revocada; R2 confirmar en dos pestañas
 * deja una sola desactivación; R3 un administrador no ve «Desactivar» en la ficha del gerente ni en la propia (sí en la de otro administrador). Lo que esta prueba ve y las de componentes no: la página en el servidor (el permiso y la lectura de la base), la fila del menú y que los componentes no rompan en el navegador.
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;
const GENERICO = "Esta acción no está permitida";
const DIA = 86_400_000;

describe.skipIf(base === null)("recorrido de la lista de usuarios", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let sofia = "";
  let deOtraEmpresa = "";

  const ir = async (ruta: string) => {
    const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
    return respuesta;
  };
  const sinViolacionesDeAxe = async () => expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
  const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base);
    const c = mundo.mundo.dueno;
    const tenant = (
      await c.query<{ tenant_id: string }>("select tenant_id from empresa where id = $1", [
        mundo.empresa,
      ])
    ).rows[0]?.tenant_id as string;
    const sumar = async (email: string, rol: "ADMINISTRADOR" | "OPERADOR", activo = true) => {
      const persona = await crearPersonaDeBase(c, email);
      await crearMembresiaDeBase(c, mundo.empresa, persona.id, rol, activo);
      return persona.id;
    };
    await sumar("diego@lacteos.test", "ADMINISTRADOR");
    sofia = await sumar("sofia@lacteos.test", "OPERADOR");
    await sumar("ana@lacteos.test", "OPERADOR", false);
    const ahora = Date.now();
    for (const [email, rol, vence] of [
      ["julia@lacteos.test", "OPERADOR", ahora + 5 * DIA],
      ["pablo@lacteos.test", "ADMINISTRADOR", ahora - 2 * DIA],
    ] as const) {
      const inv = await crearInvitacionDeBase(c, { tenant, email, venceEn: new Date(vence) });
      await incluirEmpresa(c, inv, mundo.empresa, rol);
    }
    // Otra empresa (otro tenant) con su gente y su invitación: nada de esto tiene que verse.
    const otra = await crearMundoDeMarca(c, { marca: mundo.mundo.marcaA });
    const ajena = await crearPersonaDeBase(c, "ajena@otra-empresa.test");
    await crearMembresiaDeBase(c, otra.empresa, ajena.id, "OPERADOR");
    deOtraEmpresa = ajena.id;
    const invAjena = await crearInvitacionDeBase(c, {
      tenant: otra.tenant,
      email: "invitada@otra-empresa.test",
      venceEn: new Date(ahora + 3 * DIA),
    });
    await incluirEmpresa(c, invAjena, otra.empresa, "OPERADOR");

    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("el gerente entra desde Cuenta → «Usuarios» y ve a su gente y sus invitaciones, sin nada de otra empresa", async () => {
    await ir("/cuenta");
    await pagina.getByRole("link", { name: "Usuarios" }).click();
    await pagina.waitForURL(/\/cuenta\/usuarios$/);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("heading", { name: "Invitaciones" }).waitFor();

    const fila = (nombre: string) => pagina.getByRole("link", { name: nombre, exact: true });
    expect(await fila("diego@lacteos.test Administrador").count()).toBe(1);
    expect(await fila("sofia@lacteos.test Empleado").count()).toBe(1);
    expect(await fila("ana@lacteos.test Empleado Desactivado").count()).toBe(1);
    expect(await pagina.getByText("Gerente", { exact: false }).count()).toBeGreaterThan(0);
    await pagina.getByText("Empleado · Vence el", { exact: false }).first().waitFor();
    expect(await pagina.getByText("Vencida").count()).toBe(1);
    expect(await pagina.getByText("Pendiente").count()).toBe(1);
    expect(await pagina.getByText("ajena@otra-empresa.test").count()).toBe(0);
    expect(await pagina.getByText("invitada@otra-empresa.test").count()).toBe(0);
    expect(
      await pagina.getByRole("button", { name: /Invitar|Desactivar|Reactivar|Guardar/ }).count(),
    ).toBe(0);
    await sinViolacionesDeAxe();
    pantallaLimpia();
  });

  it("la ficha de una persona de la empresa muestra su rol y su estado; la de una de otra empresa dice lo mismo que una que no existe", async () => {
    await ir(`/cuenta/usuarios/${sofia}`);
    await pagina.getByRole("heading", { name: "sofia@lacteos.test" }).waitFor();
    await pagina.getByText("Empleado").first().waitFor();
    await pagina.getByText("Activo").first().waitFor();
    // El gerente puede desactivar a un empleado activo: el único botón de la ficha es «Desactivar» (aún sin confirmar nada).
    expect(await pagina.getByRole("button").count()).toBe(1);
    expect(await pagina.getByRole("button", { name: "Desactivar" }).count()).toBe(1);
    await sinViolacionesDeAxe();

    await ir(`/cuenta/usuarios/${deOtraEmpresa}`);
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("ajena@otra-empresa.test").count()).toBe(0);
    await ir("/cuenta/usuarios/0b0b0b0b-1111-4222-8333-4444444444ee");
    await pagina.getByText(GENERICO).first().waitFor();
    await ir("/cuenta/usuarios/no-es-un-id");
    await pagina.getByText(GENERICO).first().waitFor();
    pantallaLimpia();
  });

  it("un empleado no tiene la entrada «Usuarios» y, abriendo la dirección a mano, recibe el genérico y ninguna fila", async () => {
    // Otra persona que entra de verdad (misma app y misma base) y es EMPLEADA de la empresa.
    const otra = await ingresarEn(mundo.mundo, HOST_DEL_RECORRIDO);
    const empleada = await personaVinculada(mundo.mundo, otra.sesion);
    await crearMembresiaDeBase(mundo.mundo.dueno, mundo.empresa, empleada, "OPERADOR");
    const suContexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await suContexto.addCookies(
      otra.navegador.cookiesDe(HOST_DEL_RECORRIDO).map((c) => ({
        name: c.nombre,
        value: c.valor,
        domain: HOST_DEL_RECORRIDO,
        path: "/" as const,
        httpOnly: true as const,
        secure: true as const,
      })),
    );
    pagina = await suContexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);

    await ir("/cuenta");
    await pagina.getByRole("button", { name: "Cerrar sesión" }).waitFor();
    expect(await pagina.getByRole("link", { name: "Usuarios" }).count()).toBe(0);

    await ir("/cuenta/usuarios");
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("@lacteos.test", { exact: false }).count()).toBe(0);
    expect(await pagina.getByRole("heading", { name: "Invitaciones" }).count()).toBe(0);

    await ir(`/cuenta/usuarios/${sofia}`);
    await pagina.getByText(GENERICO).first().waitFor();
    expect(await pagina.getByText("sofia@lacteos.test").count()).toBe(0);
    await sinViolacionesDeAxe();
    pantallaLimpia();
    await suContexto.close();
  });
  /** Un contexto de navegador del gerente (la sesión del mundo) con su página. */
  async function comoElGerente() {
    const ctx = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await ctx.addCookies([...mundo.cookies]);
    const pag = await ctx.newPage();
    return { ctx, pag, vig: await vigilar(pag, HOST_DEL_RECORRIDO) };
  }
  const aDeLaBase = async (sql: string, args: unknown[] = []) =>
    (await mundo.mundo.dueno.query(sql, args)).rows as Record<string, unknown>[];

  it("R1: el gerente desactiva a una persona CON confirmación: «Cancelar» no hace nada y al confirmar queda «Desactivado»", async () => {
    const c = mundo.mundo.dueno;
    const marta = await crearPersonaDeBase(c, "marta@lacteos.test");
    await crearMembresiaDeBase(c, mundo.empresa, marta.id, "OPERADOR");
    await crearAsignacionDeBase(c, mundo.empresa, marta.id, await sucursalDe(c, mundo.empresa));
    const tenant = (
      await aDeLaBase("select tenant_id from empresa where id = $1", [mundo.empresa])
    )[0]?.["tenant_id"] as string;
    const inv = await crearInvitacionDeBase(c, {
      tenant,
      email: "marta@lacteos.test",
      venceEn: new Date(Date.now() + 5 * DIA),
    });
    await incluirEmpresa(c, inv, mundo.empresa, "OPERADOR");

    const { ctx, pag, vig } = await comoElGerente();
    const abrir = async () => {
      await pag.goto(`${mundo.url}/cuenta/usuarios/${marta.id}`);
      await pag.waitForLoadState("networkidle");
    };
    await abrir();
    await pag.getByRole("heading", { name: "marta@lacteos.test" }).waitFor();

    // Pide confirmar; «Cancelar» cierra y no cambia nada.
    await pag.getByRole("button", { name: "Desactivar" }).click();
    const dialogo = pag.getByRole("dialog");
    await dialogo.getByRole("heading", { name: "¿Desactivar a marta@lacteos.test?" }).waitFor();
    await dialogo.getByText("Se corta su acceso ahora.").waitFor();
    expect(await violacionesGravesDeAxe(pag)).toEqual([]);
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await pag.getByRole("dialog").waitFor({ state: "hidden" });
    expect(await pag.getByText("Activo").count()).toBe(1);
    expect(
      (await aDeLaBase("select activo from membresia where persona_id = $1", [marta.id]))[0],
    ).toEqual({ activo: true });

    // Confirmar: queda «Desactivado», sin el botón, y todo lo que debía apagarse está apagado (sin borrar nada).
    await pag.getByRole("button", { name: "Desactivar" }).click();
    await pag.getByRole("dialog").getByRole("button", { name: "Desactivar" }).click();
    await pag.getByText("Desactivado").first().waitFor();
    await pag.getByRole("button", { name: "Desactivar" }).waitFor({ state: "detached" });
    expect(await pag.getByRole("button").count()).toBe(0);
    expect(
      (await aDeLaBase("select activo from membresia where persona_id = $1", [marta.id]))[0],
    ).toEqual({ activo: false });
    expect(
      await aDeLaBase("select activa from asignacion_sucursal where persona_id = $1", [marta.id]),
    ).toEqual([{ activa: false }]);
    expect((await aDeLaBase("select estado from invitacion where id = $1", [inv.id]))[0]).toEqual({
      estado: "REVOCADA",
    });
    expect(await aDeLaBase("select id from persona where id = $1", [marta.id])).toHaveLength(1);
    expect(await violacionesGravesDeAxe(pag)).toEqual([]);

    // La lista la muestra «Desactivado» y la invitación ya no figura.
    await pag.goto(`${mundo.url}/cuenta/usuarios`);
    await pag.waitForLoadState("networkidle");
    await pag
      .getByRole("link", { name: "marta@lacteos.test Empleado Desactivado", exact: true })
      .waitFor();
    expect(await pag.getByText("marta@lacteos.test").count()).toBe(1);
    expect(vig.tomar()).toEqual([]);
    await ctx.close();
  });

  it("R2: confirmar en dos pestañas desactiva una sola vez, sin error, y las dos terminan en «Desactivado»", async () => {
    const c = mundo.mundo.dueno;
    const luis = await crearPersonaDeBase(c, "luis@lacteos.test");
    await crearMembresiaDeBase(c, mundo.empresa, luis.id, "OPERADOR");
    const uno = await comoElGerente();
    const dos = await comoElGerente();
    for (const { pag } of [uno, dos]) {
      await pag.goto(`${mundo.url}/cuenta/usuarios/${luis.id}`);
      await pag.waitForLoadState("networkidle");
      await pag.getByRole("button", { name: "Desactivar" }).click();
      await pag.getByRole("dialog").getByText("Se corta su acceso ahora.").waitFor();
    }
    for (const { pag } of [uno, dos]) {
      await pag.getByRole("dialog").getByRole("button", { name: "Desactivar" }).click();
      await pag.getByText("Desactivado").first().waitFor();
      expect(await pag.getByText("Esta acción no está permitida").count()).toBe(0);
    }
    expect(
      await aDeLaBase(
        "select id from auditoria_empresa where empresa_id = $1 and accion = 'MEMBRESIA_APAGADA' and entidad_id = $2",
        [mundo.empresa, luis.id],
      ),
    ).toHaveLength(1);
    await uno.ctx.close();
    await dos.ctx.close();
  });

  it("R3: un administrador no ve «Desactivar» en la ficha del gerente ni en la suya, pero sí en la de otro administrador", async () => {
    const c = mundo.mundo.dueno;
    const gerente = (
      await aDeLaBase(
        "select persona_id from membresia where empresa_id = $1 and rol = 'GERENTE'",
        [mundo.empresa],
      )
    )[0]?.["persona_id"] as string;
    const diego = (
      await aDeLaBase("select id from persona where email = 'diego@lacteos.test'")
    )[0]?.["id"] as string;
    // Un administrador que entra de verdad.
    const otra = await ingresarEn(mundo.mundo, HOST_DEL_RECORRIDO);
    const yo = await personaVinculada(mundo.mundo, otra.sesion);
    await crearMembresiaDeBase(c, mundo.empresa, yo, "ADMINISTRADOR");
    const ctx = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await ctx.addCookies(
      otra.navegador.cookiesDe(HOST_DEL_RECORRIDO).map((k) => ({
        name: k.nombre,
        value: k.valor,
        domain: HOST_DEL_RECORRIDO,
        path: "/" as const,
        httpOnly: true as const,
        secure: true as const,
      })),
    );
    const pag = await ctx.newPage();
    const vig = await vigilar(pag, HOST_DEL_RECORRIDO);
    const ver = async (id: string) => {
      await pag.goto(`${mundo.url}/cuenta/usuarios/${id}`);
      await pag.waitForLoadState("networkidle");
      await pag.getByText("Rol").first().waitFor();
    };

    await ver(gerente);
    expect(await pag.getByText("Gerente").count()).toBeGreaterThan(0);
    expect(await pag.getByRole("button", { name: "Desactivar" }).count()).toBe(0);
    await ver(yo);
    expect(await pag.getByText("Administrador").count()).toBeGreaterThan(0);
    expect(await pag.getByRole("button", { name: "Desactivar" }).count()).toBe(0);
    await ver(diego);
    expect(await pag.getByRole("button", { name: "Desactivar" }).count()).toBe(1);
    expect(vig.tomar()).toEqual([]);
    await ctx.close();
  });
});
